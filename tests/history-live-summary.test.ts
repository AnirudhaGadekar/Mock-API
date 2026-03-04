import crypto from 'crypto';
import { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { buildApp } from '../src/index.js';
import { prisma } from '../src/lib/db.js';
import { redis } from '../src/lib/redis.js';
import { generateApiKey, hashApiKey } from '../src/utils/apiKey.js';

describe('History live summary and logging robustness', () => {
  let app: FastifyInstance;
  let testApiKey: string;
  let testUserId: string;
  let endpointId: string;
  let endpointSlug: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    testApiKey = generateApiKey();
    const testUser = await prisma.user.create({
      data: {
        email: `history-${crypto.randomBytes(4).toString('hex')}@mockurl.com`,
        apiKeyHash: hashApiKey(testApiKey),
      },
    });
    testUserId = testUser.id;

    endpointSlug = `history-${crypto.randomBytes(4).toString('hex')}`;
    const endpoint = await prisma.endpoint.create({
      data: {
        name: endpointSlug,
        slug: endpointSlug,
        userId: testUserId,
        rules: [],
      },
    });
    endpointId = endpoint.id;
  });

  afterAll(async () => {
    await prisma.endpoint.deleteMany({ where: { userId: testUserId } });
    await prisma.user.delete({ where: { id: testUserId } });
    await app.close();
    await prisma.$disconnect();
    await redis.quit();
  });

  beforeEach(async () => {
    await redis.flushdb();
    await prisma.requestLog.deleteMany({ where: { endpointId } });
  });

  test('logs plain-text request bodies and returns live summary', async () => {
    const mockRes = await app.inject({
      method: 'POST',
      url: `/e/${endpointSlug}/ping`,
      headers: {
        'content-type': 'text/plain',
      },
      payload: 'hello-from-plain-text',
    });

    expect(mockRes.statusCode).toBe(200);

    const historyRes = await app.inject({
      method: 'GET',
      url: `/api/v1/history/${endpointId}`,
      headers: {
        'x-api-key': testApiKey,
      },
    });

    expect(historyRes.statusCode).toBe(200);
    const historyJson = historyRes.json();
    expect(historyJson.success).toBe(true);
    expect(Array.isArray(historyJson.history)).toBe(true);
    expect(historyJson.history.length).toBeGreaterThan(0);

    const summaryRes = await app.inject({
      method: 'GET',
      url: `/api/v1/history/${endpointId}/live-summary`,
      headers: {
        'x-api-key': testApiKey,
      },
    });

    expect(summaryRes.statusCode).toBe(200);
    const summaryJson = summaryRes.json();
    expect(summaryJson.success).toBe(true);
    expect(summaryJson.summary.requestCount5m).toBeGreaterThanOrEqual(1);
    expect(typeof summaryJson.summary.websocketSubscribers).toBe('number');
  });
});
