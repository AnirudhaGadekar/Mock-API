import crypto from 'crypto';
import { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/index.js';
import { prisma } from '../src/lib/db.js';
import { redis } from '../src/lib/redis.js';
import { generateApiKey, hashApiKey } from '../src/utils/apiKey.js';

describe('SAML team enforcement toggle', () => {
  let app: FastifyInstance;
  let ownerApiKey = '';
  let ownerId = '';
  let memberApiKey = '';
  let memberId = '';
  let teamId = '';

  beforeAll(async () => {
    process.env.FEATURE_SAML_SSO = 'true';
    app = await buildApp();
    await app.ready();

    ownerApiKey = generateApiKey();
    const owner = await prisma.user.create({
      data: {
        email: `saml-owner-${crypto.randomBytes(4).toString('hex')}@example.com`,
        apiKeyHash: hashApiKey(ownerApiKey),
      },
    });
    ownerId = owner.id;

    memberApiKey = generateApiKey();
    const member = await prisma.user.create({
      data: {
        email: `saml-member-${crypto.randomBytes(4).toString('hex')}@example.com`,
        apiKeyHash: hashApiKey(memberApiKey),
      },
    });
    memberId = member.id;

    const team = await prisma.team.create({
      data: {
        name: 'SAML Team',
        slug: `saml-team-${crypto.randomBytes(4).toString('hex')}`,
        ownerId,
      },
    });
    teamId = team.id;

    await prisma.teamMember.createMany({
      data: [
        { teamId, userId: ownerId, role: 'OWNER' },
        { teamId, userId: memberId, role: 'MEMBER' },
      ],
    });
  });

  afterAll(async () => {
    delete process.env.FEATURE_SAML_SSO;
    if (teamId) {
      await prisma.teamMember.deleteMany({ where: { teamId } });
      await prisma.team.deleteMany({ where: { id: teamId } });
    }
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, memberId] } } });
    await app.close();
    await prisma.$disconnect();
    await redis.quit();
  });

  it('allows team owner to toggle and read enforcement', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: `/api/v2/saml/teams/${teamId}/enforcement`,
      headers: { 'x-api-key': ownerApiKey },
      payload: { enforced: true },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().data.enforced).toBe(true);

    const get = await app.inject({
      method: 'GET',
      url: `/api/v2/saml/teams/${teamId}/enforcement`,
      headers: { 'x-api-key': ownerApiKey },
    });
    expect(get.statusCode).toBe(200);
    expect(get.json().data.enforced).toBe(true);
  });

  it('rejects non-admin member updates', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: `/api/v2/saml/teams/${teamId}/enforcement`,
      headers: { 'x-api-key': memberApiKey },
      payload: { enforced: false },
    });
    expect(put.statusCode).toBe(403);
  });

  it('allows owner to set and read saml team config', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: `/api/v2/saml/teams/${teamId}/config`,
      headers: { 'x-api-key': ownerApiKey },
      payload: {
        idpEntityId: 'https://idp.example.com/entity',
        emailAttribute: 'email',
        teamAttribute: 'groups',
      },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().data.config.idpEntityId).toBe('https://idp.example.com/entity');

    const get = await app.inject({
      method: 'GET',
      url: `/api/v2/saml/teams/${teamId}/config`,
      headers: { 'x-api-key': ownerApiKey },
    });
    expect(get.statusCode).toBe(200);
    expect(get.json().data.config.emailAttribute).toBe('email');
  });
});
