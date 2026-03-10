import crypto from 'crypto';
import { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/index.js';
import { prisma } from '../src/lib/db.js';
import { redis } from '../src/lib/redis.js';
import { generateApiKey, hashApiKey } from '../src/utils/apiKey.js';

describe('SAML fail-closed auth enforcement', () => {
  let app: FastifyInstance;
  let userId = '';
  let teamId = '';

  beforeAll(async () => {
    process.env.FEATURE_SAML_SSO = 'true';
    process.env.FEATURE_SAML_ENFORCE_AUTH = 'true';
    app = await buildApp();
    await app.ready();

    const user = await prisma.user.create({
      data: {
        email: `enf-${crypto.randomBytes(4).toString('hex')}@example.com`,
        password: 'hashed-placeholder',
        apiKeyHash: hashApiKey(generateApiKey()),
        authProvider: 'LOCAL',
        emailVerified: true,
      },
    });
    userId = user.id;

    const team = await prisma.team.create({
      data: {
        name: 'Enforced Team',
        slug: `enf-${crypto.randomBytes(4).toString('hex')}`,
        ownerId: userId,
      },
    });
    teamId = team.id;

    await prisma.teamMember.create({
      data: {
        teamId,
        userId,
        role: 'OWNER',
      },
    });
    await redis.set(`saml:sso:enforced:${teamId}`, '1');
  });

  afterAll(async () => {
    delete process.env.FEATURE_SAML_SSO;
    delete process.env.FEATURE_SAML_ENFORCE_AUTH;
    if (teamId) {
      await prisma.teamMember.deleteMany({ where: { teamId } });
      await prisma.team.deleteMany({ where: { id: teamId } });
      await redis.del(`saml:sso:enforced:${teamId}`);
    }
    if (userId) {
      await prisma.user.deleteMany({ where: { id: userId } });
    }
    await app.close();
    await prisma.$disconnect();
    await redis.quit();
  });

  it('blocks otp and password login paths with SSO_REQUIRED', async () => {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    const email = user!.email;

    const sendOtpRes = await app.inject({
      method: 'POST',
      url: '/api/v2/auth/send-otp',
      payload: { email },
    });
    expect(sendOtpRes.statusCode).toBe(403);
    expect(sendOtpRes.json().code).toBe('SSO_REQUIRED');

    const verifyOtpRes = await app.inject({
      method: 'POST',
      url: '/api/v2/auth/verify-otp',
      payload: { email, otp: '123456' },
    });
    expect(verifyOtpRes.statusCode).toBe(403);
    expect(verifyOtpRes.json().code).toBe('SSO_REQUIRED');

    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v2/auth/login',
      payload: { email, password: 'any' },
    });
    expect(loginRes.statusCode).toBe(403);
    expect(loginRes.json().code).toBe('SSO_REQUIRED');
  });
});
