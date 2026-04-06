import crypto from 'crypto';
import { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { buildApp } from '../src/index.js';
import { prisma } from '../src/lib/db.js';
import { redis } from '../src/lib/redis.js';
import { generateApiKey, hashApiKey } from '../src/utils/apiKey.js';

let app: FastifyInstance;
let testApiKey: string;
let testUserId: string;

function uniqueName(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(3).toString('hex')}`;
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();

  testApiKey = generateApiKey();
  const testUser = await prisma.user.create({
    data: {
      email: `test-${crypto.randomBytes(4).toString('hex')}@mockapi.com`,
      apiKeyHash: hashApiKey(testApiKey),
    },
  });
  testUserId = testUser.id;
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
  await prisma.endpoint.deleteMany({ where: { userId: testUserId } });
});

function makeAuthRequest(path: string, method: string = 'GET', body?: any) {
  const headers: Record<string, string> = { 'x-api-key': testApiKey };
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
  }

  return app.inject({
    method,
    url: path,
    headers,
    ...(body && { payload: body }),
  });
}

describe('Endpoints API v2 - Authentication', () => {
  test('rejects request without API key', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v2/endpoints' });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ success: false, error: { code: 'AUTHENTICATION_REQUIRED' } });
  });

  test('rejects request with invalid API key', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v2/endpoints',
      headers: { 'x-api-key': 'invalid-key' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ success: false, error: { code: 'FORBIDDEN' } });
  });
});

describe('Endpoints API v2 - CRUD', () => {
  test('creates endpoint with valid data', async () => {
    const name = uniqueName('endpoint');
    const response = await makeAuthRequest('/api/v2/endpoints', 'POST', { name });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.data.name).toBe(name);
    expect(body.data.subdomain).toBe(name);
    expect(body.data.id).toBeTruthy();
    expect(Array.isArray(body.data.rules)).toBe(true);
  });

  test('rejects duplicate endpoint name', async () => {
    const name = uniqueName('dupe');
    await makeAuthRequest('/api/v2/endpoints', 'POST', { name });

    const response = await makeAuthRequest('/api/v2/endpoints', 'POST', { name });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ success: false, error: { code: 'SLUG_TAKEN' } });
  });

  test('rejects reserved platform subdomains', async () => {
    const response = await makeAuthRequest('/api/v2/endpoints', 'POST', { name: 'health' });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
      },
    });
  });

  test('lists endpoints with pagination envelope', async () => {
    const prefix = uniqueName('list');
    await makeAuthRequest('/api/v2/endpoints', 'POST', { name: `${prefix}-01` });
    await makeAuthRequest('/api/v2/endpoints', 'POST', { name: `${prefix}-02` });
    await makeAuthRequest('/api/v2/endpoints', 'POST', { name: `${prefix}-03` });

    const response = await makeAuthRequest('/api/v2/endpoints?limit=2');
    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.data.endpoints).toHaveLength(2);
    expect(body.data.totalCount).toBe(3);
    expect(body.data.nextCursor).toBeTruthy();
  });

  test('gets and deletes an endpoint', async () => {
    const name = uniqueName('delete');
    const createResponse = await makeAuthRequest('/api/v2/endpoints', 'POST', { name });
    const endpointId = createResponse.json().data.id as string;

    const getResponse = await makeAuthRequest(`/api/v2/endpoints/${endpointId}`);
    expect(getResponse.statusCode).toBe(200);
    expect(getResponse.json().data.id).toBe(endpointId);

    const deleteResponse = await makeAuthRequest(`/api/v2/endpoints/${endpointId}`, 'DELETE');
    expect(deleteResponse.statusCode).toBe(200);
    expect(deleteResponse.json()).toMatchObject({ success: true, data: { deleted: true } });

    const getAfterDelete = await makeAuthRequest(`/api/v2/endpoints/${endpointId}`);
    expect(getAfterDelete.statusCode).toBe(404);
  });
});
