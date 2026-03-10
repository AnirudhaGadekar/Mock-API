import crypto from 'crypto';
import { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { buildApp } from '../src/index.js';
import { prisma } from '../src/lib/db.js';
import { redis } from '../src/lib/redis.js';
import { generateApiKey, hashApiKey } from '../src/utils/apiKey.js';

describe('Production Mode Behavior Simulation', () => {
  let app: FastifyInstance;
  let userId: string;
  let apiKey: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'production';
    process.env.RENDER = 'true';
    process.env.RENDER_EXTERNAL_URL = 'https://mock-url-9rwn.onrender.com';

    app = await buildApp();
    await app.ready();

    apiKey = generateApiKey();
    const user = await prisma.user.create({
      data: {
        email: `prod-${crypto.randomBytes(4).toString('hex')}@example.com`,
        apiKeyHash: hashApiKey(apiKey),
      },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.endpoint.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await app.close();
    await prisma.$disconnect();
    await redis.quit();

    delete process.env.RENDER;
    delete process.env.RENDER_EXTERNAL_URL;
  });

  test('created endpoint URL should not fallback to localhost in production mode', async () => {
    const name = `prod-url-${crypto.randomBytes(3).toString('hex')}`;

    const res = await app.inject({
      method: 'POST',
      url: '/api/v2/endpoints',
      headers: {
        'x-api-key': apiKey,
      },
      payload: { name },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.data.url.startsWith('https://')).toBe(true);
    expect(body.data.url).not.toContain('localhost');
  });
});
