import { FastifyInstance } from 'fastify';
import { afterAll, describe, expect, it } from 'vitest';
import { getApiKeyCookieName } from '../src/lib/auth-cookie.js';
import { prisma } from '../src/lib/db.js';
import { buildApp } from '../src/index.js';
import { createSignedRelayState } from '../src/lib/saml-relaystate.js';
import { redis } from '../src/lib/redis.js';

function uniqueAssertionId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

describe('SAML skeleton routes', () => {
  let app: FastifyInstance | null = null;
  const createdUserIds: string[] = [];
  const createdTeamIds: string[] = [];

  afterAll(async () => {
    if (app) {
      await app.close();
      app = null;
    }
    if (createdTeamIds.length > 0) {
      await prisma.teamMember.deleteMany({ where: { teamId: { in: createdTeamIds } } });
      await prisma.team.deleteMany({ where: { id: { in: createdTeamIds } } });
    }
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    delete process.env.FEATURE_SAML_SSO;
    delete process.env.FEATURE_SAML_STRICT_SIGNATURE;
    delete process.env.SAML_TEAM_ATTRIBUTE;
    delete process.env.FEATURE_SAML_REQUIRE_SIGNED_RELAYSTATE;
    delete process.env.SAML_RELAYSTATE_SECRET;
  });

  it('does not expose saml routes when feature flag is disabled', async () => {
    delete process.env.FEATURE_SAML_SSO;
    app = await buildApp();

    const res = await app.inject({
      method: 'GET',
      url: '/api/v2/saml/metadata',
    });

    expect(res.statusCode).toBe(404);
    await app.close();
    app = null;
  });

  it('exposes metadata and ACS skeleton when feature flag is enabled', async () => {
    process.env.FEATURE_SAML_SSO = 'true';
    app = await buildApp();
    const assertionId = uniqueAssertionId('id-metadata');

    const metadata = await app.inject({
      method: 'GET',
      url: '/api/v2/saml/metadata',
    });
    expect(metadata.statusCode).toBe(200);
    expect(metadata.headers['content-type']).toContain('application/samlmetadata+xml');
    expect(metadata.body).toContain('<EntityDescriptor');

    const email = `jit-${Math.random().toString(36).slice(2, 10)}@example.com`;
    const acs = await app.inject({
      method: 'POST',
      url: '/api/v2/saml/acs',
      payload: {
        SAMLResponse: Buffer.from(`<Assertion ID="${assertionId}" IssueInstant="${new Date().toISOString()}"><NameID>${email}</NameID><Signature/></Assertion>`).toString('base64'),
      },
    });
    expect(acs.statusCode).toBe(200);
    const body = acs.json();
    expect(body).toMatchObject({ success: true, data: { accepted: true } });
    expect(typeof body.data.session.apiKey).toBe('string');
    expect(body.data.session.user.email).toBe(email);
    expect(acs.cookies.find((c) => c.name === getApiKeyCookieName())?.value).toBe(body.data.session.apiKey);
    createdUserIds.push(body.data.session.user.id);
  });

  it('detects replay for same assertion id', async () => {
    process.env.FEATURE_SAML_SSO = 'true';
    app = await buildApp();
    const assertionId = uniqueAssertionId('id-replay');
    const email = `replay-${Math.random().toString(36).slice(2, 10)}@example.com`;

    const xml = `<Assertion ID="${assertionId}" IssueInstant="${new Date().toISOString()}"><NameID>${email}</NameID><Signature/></Assertion>`;
    const samlResponse = Buffer.from(xml).toString('base64');

    const first = await app.inject({
      method: 'POST',
      url: '/api/v2/saml/acs',
      payload: { SAMLResponse: samlResponse },
    });
    expect(first.statusCode).toBe(200);
    createdUserIds.push(first.json().data.session.user.id);

    const second = await app.inject({
      method: 'POST',
      url: '/api/v2/saml/acs',
      payload: { SAMLResponse: samlResponse },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({
      success: false,
      error: { code: 'SAML_ASSERTION_REPLAYED' },
    });
  });

  it('creates membership via RelayState team mapping during JIT provisioning', async () => {
    process.env.FEATURE_SAML_SSO = 'true';
    app = await buildApp();

    const owner = await prisma.user.create({
      data: {
        email: `saml-team-owner-${Math.random().toString(36).slice(2, 10)}@example.com`,
        apiKeyHash: `placeholder-${Math.random().toString(36).slice(2, 14)}`,
      },
      select: { id: true },
    });
    createdUserIds.push(owner.id);

    const team = await prisma.team.create({
      data: {
        name: 'JIT Team',
        slug: `jit-team-${Math.random().toString(36).slice(2, 10)}`,
        ownerId: owner.id,
      },
      select: { id: true },
    });
    createdTeamIds.push(team.id);

    const assertionId = uniqueAssertionId('id-team-map');
    const email = `jit-team-${Math.random().toString(36).slice(2, 10)}@example.com`;
    const samlResponse = Buffer.from(
      `<Assertion ID="${assertionId}" IssueInstant="${new Date().toISOString()}"><NameID>${email}</NameID><Signature/></Assertion>`,
    ).toString('base64');

    const acs = await app.inject({
      method: 'POST',
      url: '/api/v2/saml/acs',
      payload: {
        SAMLResponse: samlResponse,
        RelayState: team.id,
      },
    });

    expect(acs.statusCode).toBe(200);
    const userId = acs.json().data.session.user.id as string;
    createdUserIds.push(userId);

    const membership = await prisma.teamMember.findUnique({
      where: {
        userId_teamId: {
          userId,
          teamId: team.id,
        },
      },
    });

    expect(membership).not.toBeNull();
    expect(acs.json().data.teamMapping).toMatchObject({
      teamId: team.id,
      matched: true,
    });
  });

  it('maps team by SAML attribute and creates membership without RelayState', async () => {
    process.env.FEATURE_SAML_SSO = 'true';
    process.env.SAML_TEAM_ATTRIBUTE = 'groups';
    app = await buildApp();

    const owner = await prisma.user.create({
      data: {
        email: `saml-attr-owner-${Math.random().toString(36).slice(2, 10)}@example.com`,
        apiKeyHash: `placeholder-${Math.random().toString(36).slice(2, 14)}`,
      },
      select: { id: true },
    });
    createdUserIds.push(owner.id);

    const team = await prisma.team.create({
      data: {
        name: 'Attribute Team',
        slug: `attr-team-${Math.random().toString(36).slice(2, 10)}`,
        ownerId: owner.id,
      },
      select: { id: true, slug: true },
    });
    createdTeamIds.push(team.id);

    const assertionId = uniqueAssertionId('id-team-attr-map');
    const email = `jit-attr-${Math.random().toString(36).slice(2, 10)}@example.com`;
    const xml = `<Assertion ID="${assertionId}" IssueInstant="${new Date().toISOString()}">
      <NameID>${email}</NameID>
      <AttributeStatement>
        <Attribute Name="groups"><AttributeValue>${team.slug}</AttributeValue></Attribute>
      </AttributeStatement>
      <Signature/>
    </Assertion>`;

    const acs = await app.inject({
      method: 'POST',
      url: '/api/v2/saml/acs',
      payload: {
        SAMLResponse: Buffer.from(xml).toString('base64'),
      },
    });

    expect(acs.statusCode).toBe(200);
    const userId = acs.json().data.session.user.id as string;
    createdUserIds.push(userId);

    const membership = await prisma.teamMember.findUnique({
      where: {
        userId_teamId: {
          userId,
          teamId: team.id,
        },
      },
    });

    expect(membership).not.toBeNull();
    expect(acs.json().data.teamMapping).toMatchObject({
      teamId: team.id,
      teamAttribute: 'groups',
      matched: true,
    });

  });

  it('enforces signed RelayState when enabled and accepts valid signed RelayState', async () => {
    process.env.FEATURE_SAML_SSO = 'true';
    process.env.FEATURE_SAML_REQUIRE_SIGNED_RELAYSTATE = 'true';
    process.env.SAML_RELAYSTATE_SECRET = 'relaystate-test-secret-very-strong';
    app = await buildApp();

    const owner = await prisma.user.create({
      data: {
        email: `saml-signed-owner-${Math.random().toString(36).slice(2, 10)}@example.com`,
        apiKeyHash: `placeholder-${Math.random().toString(36).slice(2, 14)}`,
      },
      select: { id: true },
    });
    createdUserIds.push(owner.id);

    const team = await prisma.team.create({
      data: {
        name: 'Signed Relay Team',
        slug: `signed-relay-team-${Math.random().toString(36).slice(2, 10)}`,
        ownerId: owner.id,
      },
      select: { id: true },
    });
    createdTeamIds.push(team.id);

    const assertionId = uniqueAssertionId('id-signed-relay');
    const email = `jit-signed-${Math.random().toString(36).slice(2, 10)}@example.com`;
    const samlResponse = Buffer.from(
      `<Assertion ID="${assertionId}" IssueInstant="${new Date().toISOString()}"><NameID>${email}</NameID><Signature/></Assertion>`,
    ).toString('base64');

    const unsignedRes = await app.inject({
      method: 'POST',
      url: '/api/v2/saml/acs',
      payload: {
        SAMLResponse: samlResponse,
        RelayState: team.id,
      },
    });
    expect(unsignedRes.statusCode).toBe(403);
    expect(unsignedRes.json()).toMatchObject({
      success: false,
      error: { code: 'SAML_RELAYSTATE_INVALID' },
    });

    const signedRelayState = createSignedRelayState(team.id, 300);
    const signedRes = await app.inject({
      method: 'POST',
      url: '/api/v2/saml/acs',
      payload: {
        SAMLResponse: samlResponse,
        RelayState: signedRelayState,
      },
    });
    expect(signedRes.statusCode).toBe(200);
    const userId = signedRes.json().data.session.user.id as string;
    createdUserIds.push(userId);
  });

  it('rejects XML payloads with blocked constructs', async () => {
    process.env.FEATURE_SAML_SSO = 'true';
    app = await buildApp();

    const xml = `<!DOCTYPE foo [ <!ELEMENT foo ANY > ]><Assertion ID="id-xml-blocked" IssueInstant="${new Date().toISOString()}"><NameID>blocked@example.com</NameID><Signature/></Assertion>`;
    const res = await app.inject({
      method: 'POST',
      url: '/api/v2/saml/acs',
      payload: {
        SAMLResponse: Buffer.from(xml).toString('base64'),
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      success: false,
      error: { code: 'SAML_INVALID_RESPONSE' },
    });
  });

  it('enforces strict signature mode when enabled', async () => {
    process.env.FEATURE_SAML_SSO = 'true';
    process.env.FEATURE_SAML_STRICT_SIGNATURE = 'true';
    app = await buildApp();

    const xml = `<Assertion ID="id-strict-1" IssueInstant="${new Date().toISOString()}"><NameID>user@example.com</NameID></Assertion>`;
    const samlResponse = Buffer.from(xml).toString('base64');
    await redis.del('saml:assertion:aWQtc3RyaWN0LTE');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v2/saml/acs',
      payload: { SAMLResponse: samlResponse },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({
      success: false,
      error: { code: 'SAML_SIGNATURE_INVALID' },
    });
  });
});
