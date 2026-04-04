import crypto from 'crypto';
import { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/index.js';
import { prisma } from '../src/lib/db.js';
import { redis } from '../src/lib/redis.js';
import { generateApiKey, hashApiKey } from '../src/utils/apiKey.js';

describe('security policy enforcement', () => {
  let app: FastifyInstance;
  let apiKey = '';
  let userId = '';
  let endpointId = '';
  let endpointName = '';

  beforeAll(async () => {
    process.env.FEATURE_IP_ALLOWLIST = 'true';

    app = await buildApp();
    await app.ready();

    apiKey = generateApiKey();
    const user = await prisma.user.create({
      data: {
        email: `policy-${crypto.randomBytes(4).toString('hex')}@example.com`,
        apiKeyHash: hashApiKey(apiKey),
      },
    });
    userId = user.id;

    endpointName = `policy-${crypto.randomBytes(3).toString('hex')}`;
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v2/endpoints',
      headers: { 'x-api-key': apiKey },
      payload: { name: endpointName },
    });
    endpointId = createRes.json().data.id as string;

    await app.inject({
      method: 'PUT',
      url: `/api/v2/endpoints/${endpointId}/security-policy`,
      headers: { 'x-api-key': apiKey },
      payload: {
        ipAllowlist: ['10.0.0.0/8'],
        maskedHeaders: ['authorization'],
        maskingStrategy: 'full',
        mtlsMode: 'off',
      },
    });
  });

  afterAll(async () => {
    delete process.env.FEATURE_IP_ALLOWLIST;
    if (endpointId) {
      await prisma.endpoint.deleteMany({ where: { id: endpointId } });
    }
    if (userId) {
      await prisma.user.deleteMany({ where: { id: userId } });
    }
    await app.close();
    await prisma.$disconnect();
    await redis.quit();
  });

  it('denies mock traffic when caller ip is outside allowlist', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/e/${endpointName}/hello`,
      headers: {
        host: 'mockapi.com',
      },
      remoteAddress: '172.16.10.9',
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({
      success: false,
      error: {
        code: 'POLICY_DENIED',
      },
    });
  });
});
