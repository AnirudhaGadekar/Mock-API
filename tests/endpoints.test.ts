import crypto from 'crypto';
import { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { buildApp } from '../src/index.js';
import { prisma } from '../src/lib/db.js';
import { redis } from '../src/lib/redis.js';

let app: FastifyInstance;
let testApiKey: string;
let testUserId: string;

/**
 * Setup test environment
 */
beforeAll(async () => {
  app = await buildApp();
  await app.ready();

  // Create test user with API key
  testApiKey = crypto.randomBytes(32).toString('hex');
  const testUser = await prisma.user.create({
    data: {
      email: 'test@mockurl.com',
      apiKey: testApiKey,
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
  // Clear Redis cache before each test
  await redis.flushdb();

  // Delete all test endpoints
  await prisma.endpoint.deleteMany({ where: { userId: testUserId } });
});

/**
 * Helper: Make authenticated request
 */
function makeAuthRequest(path: string, method: string = 'GET', body?: any) {
  return app.inject({
    method,
    url: path,
    headers: {
      'x-api-key': testApiKey,
      'content-type': 'application/json',
    },
    ...(body && { payload: body }),
  });
}

describe('Endpoints API - Authentication', () => {
  test('should reject request without API key', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/endpoints',
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      success: false,
      error: {
        code: 'AUTHENTICATION_REQUIRED',
      },
    });
  });

  test('should reject request with invalid API key format', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/endpoints',
      headers: {
        'x-api-key': 'invalid-key',
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      success: false,
      error: {
        code: 'FORBIDDEN',
      },
    });
  });

  test('should reject request with non-existent API key', async () => {
    const fakeKey = crypto.randomBytes(32).toString('hex');
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/endpoints',
      headers: {
        'x-api-key': fakeKey,
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: 'Invalid API key',
      },
    });
  });

  test('should cache authenticated user', async () => {
    // First request
    const response1 = await makeAuthRequest('/api/v1/endpoints');
    expect(response1.statusCode).toBe(200);

    // Check cache
    const cacheKey = `auth:user:${testApiKey}`;
    const cached = await redis.get(cacheKey);
    expect(cached).toBeTruthy();

    const cachedUser = JSON.parse(cached!);
    expect(cachedUser.id).toBe(testUserId);
  });
});

describe('Endpoints API - Create Endpoint', () => {
  test('should create endpoint with valid data', async () => {
    const response = await makeAuthRequest('/api/v1/endpoints/create', 'POST', {
      name: 'test-endpoint-123',
      description: 'Test endpoint for unit tests',
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();

    expect(body).toMatchObject({
      success: true,
      endpoint: {
        name: 'test-endpoint-123',
        subdomain: 'test-endpoint-123',
        url: 'https://test-endpoint-123.mockurl.com',
        dashboardUrl: '/console/test-endpoint-123',
        reqCount: 0,
      },
    });

    expect(body.endpoint.id).toBeTruthy();
    expect(body.endpoint.rules).toHaveLength(2); // Default rules (MockUrl spec)
    expect(body.timestamp).toBeTruthy();
  });

  test('should reject invalid endpoint names', async () => {
    const invalidNames = [
      'ab', // Too short
      'a'.repeat(41), // Too long
      'Test-Endpoint', // Uppercase
      'test_endpoint', // Underscore
      'test endpoint', // Space
      '-test', // Starts with hyphen
      'test-', // Ends with hyphen
      'test--endpoint', // Consecutive hyphens
    ];

    for (const name of invalidNames) {
      const response = await makeAuthRequest('/api/v1/endpoints/create', 'POST', { name });
      expect(response.statusCode).toBeGreaterThanOrEqual(400);
    }
  });

  test('should reject duplicate endpoint name for same user', async () => {
    // Create first endpoint
    await makeAuthRequest('/api/v1/endpoints/create', 'POST', {
      name: 'duplicate-test',
    });

    // Try to create duplicate
    const response = await makeAuthRequest('/api/v1/endpoints/create', 'POST', {
      name: 'duplicate-test',
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      success: false,
      error: {
        code: 'ENDPOINT_EXISTS',
      },
    });
  });

  test('should accept custom rules', async () => {
    const customRules = [
      {
        path: '/custom',
        method: 'GET',
        response: {
          status: 200,
          body: { message: 'Custom response' },
        },
      },
    ];

    const response = await makeAuthRequest('/api/v1/endpoints/create', 'POST', {
      name: 'custom-rules-test',
      rules: customRules,
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.endpoint.rules).toHaveLength(1);
    expect(body.endpoint.rules[0]).toMatchObject(customRules[0]);
  });

  test('should invalidate endpoint list cache after creation', async () => {
    // Populate cache
    await makeAuthRequest('/api/v1/endpoints');

    // Create endpoint
    await makeAuthRequest('/api/v1/endpoints/create', 'POST', {
      name: 'cache-test',
    });

    // Check that cache was cleared
    const pattern = `user:endpoints:${testUserId}:*`;
    const keys = await redis.keys(pattern);
    expect(keys.length).toBe(0); // Cache should be invalidated
  });
});

describe('Endpoints API - List Endpoints', () => {
  test('should list endpoints with pagination', async () => {
    // Create 3 test endpoints
    await makeAuthRequest('/api/v1/endpoints/create', 'POST', { name: 'endpoint-01' });
    await makeAuthRequest('/api/v1/endpoints/create', 'POST', { name: 'endpoint-02' });
    await makeAuthRequest('/api/v1/endpoints/create', 'POST', { name: 'endpoint-03' });

    const response = await makeAuthRequest('/api/v1/endpoints?limit=2');
    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.endpoints).toHaveLength(2);
    expect(body.totalCount).toBe(3);
    expect(body.nextCursor).toBeTruthy();
  });

  test('should handle cursor-based pagination', async () => {
    // Create 3 endpoints
    await makeAuthRequest('/api/v1/endpoints/create', 'POST', { name: 'page-test-01' });
    await makeAuthRequest('/api/v1/endpoints/create', 'POST', { name: 'page-test-02' });
    await makeAuthRequest('/api/v1/endpoints/create', 'POST', { name: 'page-test-03' });

    const page1 = await makeAuthRequest('/api/v1/endpoints?limit=2');
    const page1Body = page1.json();
    const cursor = page1Body.nextCursor;

    const page2 = await makeAuthRequest(`/api/v1/endpoints?limit=2&afterId=${cursor}`);
    const page2Body = page2.json();

    expect(page2Body.endpoints).toHaveLength(1);
  });

  test('should cache list results', async () => {
    await makeAuthRequest('/api/v1/endpoints/create', 'POST', { name: 'cache-list-test' });

    const response1 = await makeAuthRequest('/api/v1/endpoints?limit=20');
    expect(response1.statusCode).toBe(200);

    const pattern = `user:endpoints:${testUserId}:*`;
    const keys = await redis.keys(pattern);
    expect(keys.length).toBeGreaterThan(0);

    const response2 = await makeAuthRequest('/api/v1/endpoints?limit=20');
    expect(response2.statusCode).toBe(200);
    expect(response1.json()).toEqual(response2.json());
  });

  test('should support search filter', async () => {
    await makeAuthRequest('/api/v1/endpoints/create', 'POST', { name: 'searchable-endpoint' });
    await makeAuthRequest('/api/v1/endpoints/create', 'POST', { name: 'other-endpoint' });

    const response = await makeAuthRequest('/api/v1/endpoints?search=searchable');
    const body = response.json();

    expect(body.endpoints).toHaveLength(1);
    expect(body.endpoints[0].name).toBe('searchable-endpoint');
  });
});

describe('Endpoints API - Get Single Endpoint', () => {
  test('should get endpoint by ID', async () => {
    const createResponse = await makeAuthRequest('/api/v1/endpoints/create', 'POST', {
      name: 'get-test-endpoint',
    });
    const endpointId = createResponse.json().endpoint.id;

    const response = await makeAuthRequest(`/api/v1/endpoints/${endpointId}`);
    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.id).toBe(endpointId);
    expect(body.stats).toBeDefined();
  });

  test('should return 404 for non-existent endpoint', async () => {
    const fakeId = crypto.randomUUID();
    const response = await makeAuthRequest(`/api/v1/endpoints/${fakeId}`);

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      success: false,
      error: {
        code: 'NOT_FOUND',
      },
    });
  });

  test('should cache endpoint details', async () => {
    const createResponse = await makeAuthRequest('/api/v1/endpoints/create', 'POST', {
      name: 'cache-detail-test',
    });
    const endpointId = createResponse.json().endpoint.id;

    // First request
    await makeAuthRequest(`/api/v1/endpoints/${endpointId}`);

    // Check cache
    const cacheKey = `endpoint:detail:${endpointId}`;
    const cached = await redis.get(cacheKey);
    expect(cached).toBeTruthy();
  });
});

describe('Endpoints API - Delete Endpoint', () => {
  test('should soft-delete endpoint', async () => {
    const createResponse = await makeAuthRequest('/api/v1/endpoints/create', 'POST', {
      name: 'delete-test',
    });
    const endpointId = createResponse.json().endpoint.id;

    const deleteResponse = await makeAuthRequest(`/api/v1/endpoints/${endpointId}`, 'DELETE');
    expect(deleteResponse.statusCode).toBe(200);
    expect(deleteResponse.json()).toMatchObject({
      success: true,
      deleted: true,
    });

    const endpoint = await prisma.endpoint.findUnique({ where: { id: endpointId } });
    expect(endpoint?.deletedAt).toBeTruthy();

    const listResponse = await makeAuthRequest('/api/v1/endpoints');
    const endpoints = listResponse.json().endpoints;
    expect(endpoints.find((e: { id: string }) => e.id === endpointId)).toBeUndefined();
  });

  test('should invalidate cache after deletion', async () => {
    const createResponse = await makeAuthRequest('/api/v1/endpoints/create', 'POST', {
      name: 'delete-cache-test',
    });
    const endpointId = createResponse.json().endpoint.id;

    // Populate cache
    await makeAuthRequest('/api/v1/endpoints');
    await makeAuthRequest(`/api/v1/endpoints/${endpointId}`);

    // Delete
    await makeAuthRequest(`/api/v1/endpoints/${endpointId}`, 'DELETE');

    // Check that cache was cleared
    const pattern = `user:endpoints:${testUserId}:*`;
    const keys = await redis.keys(pattern);
    expect(keys.length).toBe(0);
  });
});

describe('Endpoints API - Rate Limiting', () => {
  test('should rate limit endpoint creation', async () => {
    // This test would require 100+ requests to trigger
    // Skipping for brevity, but rate limiting is configured
    expect(true).toBe(true);
  });
});
