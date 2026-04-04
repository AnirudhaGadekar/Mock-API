import crypto from 'crypto';
import { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { buildApp } from '../src/index.js';
import { prisma } from '../src/lib/db.js';
import { redis } from '../src/lib/redis.js';
import { generateApiKey, hashApiKey } from '../src/utils/apiKey.js';

let app: FastifyInstance;
let testApiKey: string;
let testUserId: string;

beforeAll(async () => {
    try {
        console.log('DEBUG: v4-roadmap.test.ts - process.env.DATABASE_URL:', process.env.DATABASE_URL);
        app = await buildApp();
        await app.ready();

        testApiKey = generateApiKey();
        const testApiKeyHash = hashApiKey(testApiKey);

        // Cleanup if previous run failed
        await prisma.user.deleteMany({ where: { email: 'v4test@mockapi.com' } });

        const testUser = await prisma.user.create({
            data: {
                email: `v4test-${crypto.randomBytes(4).toString('hex')}@mockapi.com`,
                apiKeyHash: testApiKeyHash,
            },
        });
        testUserId = testUser.id;
        console.log('Test user created:', testUserId);
    } catch (err) {
        console.error('CRITICAL: beforeAll failed in v4-roadmap.test.ts');
        console.error(err);
        throw err;
    }
});

afterAll(async () => {
    if (testUserId) {
        await prisma.endpoint.deleteMany({ where: { userId: testUserId } });
        await prisma.user.delete({ where: { id: testUserId } });
    }
    if (app) await app.close();
    await prisma.$disconnect();
    await redis.quit();
});

beforeEach(async () => {
    await redis.flushdb();
    if (testUserId) {
        await prisma.endpoint.deleteMany({ where: { userId: testUserId } });
    }
});

function makeAuthRequest(path: string, method: string = 'GET', body?: any) {
    const headers: Record<string, string> = {
        'x-api-key': testApiKey,
    };
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

describe('Roadmap V4 - Advanced Chaos Validation', () => {
    test('should allow setting timeout and jitter', async () => {
        // 1. Create endpoint
        const createRes = await makeAuthRequest('/api/v2/endpoints', 'POST', { name: 'chaos-v4' });
        const endpointId = createRes.json().endpoint.id;

        // 2. Set Chaos with new params
        const chaosRes = await makeAuthRequest(`/api/v2/chaos/${endpointId}`, 'PUT', {
            enabled: true,
            jitter: { ms: 500 },
            timeout: { probability: 0.1, durationMs: 2000 }
        });

        expect(chaosRes.statusCode).toBe(200);
        expect(chaosRes.json().config).toMatchObject({
            jitter: { ms: 500 },
            timeout: { probability: 0.1, durationMs: 2000 }
        });
    });

    test('should reject invalid jitter value', async () => {
        const createRes = await makeAuthRequest('/api/v2/endpoints', 'POST', { name: 'chaos-fail' });
        const endpointId = createRes.json().endpoint.id;

        const chaosRes = await makeAuthRequest(`/api/v2/chaos/${endpointId}`, 'PUT', {
            jitter: { ms: 6000 } // Limit is 5000
        });

        expect(chaosRes.statusCode).toBe(400);
        expect(chaosRes.json().error.message).toContain('jitter.ms must be 0-5000');
    });

    test('should reject invalid timeout duration', async () => {
        const createRes = await makeAuthRequest('/api/v2/endpoints', 'POST', { name: 'timeout-fail' });
        const endpointId = createRes.json().endpoint.id;

        const chaosRes = await makeAuthRequest(`/api/v2/chaos/${endpointId}`, 'PUT', {
            timeout: { probability: 0.5, durationMs: 40000 } // Limit is 30000
        });

        expect(chaosRes.statusCode).toBe(400);
        expect(chaosRes.json().error.message).toContain('timeout.durationMs must be 0-30000');
    });
});

describe('Roadmap V4 - JWT Validation Mock', () => {
    const JWT_SECRET = 'test-secret-123';
    const validToken = jwt.sign({ sub: 'user123' }, JWT_SECRET, { issuer: 'mockapi', audience: 'app' });
    const invalidToken = jwt.sign({ sub: 'user123' }, 'wrong-secret');

    test('should match rule when JWT is valid', async () => {
        // 1. Create endpoint with JWT rule
        const createRes = await makeAuthRequest('/api/v2/endpoints', 'POST', {
            name: 'jwt-match',
            rules: [
                {
                    path: '/secure',
                    method: 'GET',
                    condition: {
                        jwtValidation: {
                            secret: JWT_SECRET,
                            issuer: 'mockapi',
                            audience: 'app',
                            required: true
                        }
                    },
                    response: {
                        status: 200,
                        body: { message: 'Authorized' }
                    }
                }
            ]
        });
        const subdomain = createRes.json().endpoint.subdomain;

        // 2. Request with valid JWT
        const response = await app.inject({
            method: 'GET',
            url: '/secure',
            headers: {
                host: `${subdomain}.mockapi.com`,
                authorization: `Bearer ${validToken}`
            }
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ message: 'Authorized' });
    });

    test('should fail to match rule when JWT is invalid', async () => {
        const createRes = await makeAuthRequest('/api/v2/endpoints', 'POST', {
            name: 'jwt-fail',
            rules: [
                {
                    path: '/secure',
                    method: 'GET',
                    condition: {
                        jwtValidation: {
                            secret: JWT_SECRET,
                            required: true
                        }
                    },
                    response: {
                        status: 200,
                        body: { message: 'Authorized' }
                    }
                }
            ]
        });
        const subdomain = createRes.json().endpoint.subdomain;

        // Request with invalid token
        const response = await app.inject({
            method: 'GET',
            url: '/secure',
            headers: {
                host: `${subdomain}.mockapi.com`,
                authorization: `Bearer ${invalidToken}`
            }
        });

        // Should fall back to default rule (Mock endpoint active)
        expect(response.statusCode).toBe(200);
        expect(response.json().message).toBe('Mock endpoint active');
        expect(response.json().message).not.toBe('Authorized');
    });

    test('should fail to match rule when JWT is missing and required', async () => {
        const createRes = await makeAuthRequest('/api/v2/endpoints', 'POST', {
            name: 'jwt-missing',
            rules: [
                {
                    path: '/secure',
                    method: 'GET',
                    condition: {
                        jwtValidation: {
                            secret: JWT_SECRET,
                            required: true
                        }
                    },
                    response: {
                        status: 200,
                        body: { message: 'Authorized' }
                    }
                }
            ]
        });
        const subdomain = createRes.json().endpoint.subdomain;

        const response = await app.inject({
            method: 'GET',
            url: '/secure',
            headers: {
                host: `${subdomain}.mockapi.com`
            }
        });

        expect(response.statusCode).toBe(200);
        expect(response.json().message).toBe('Mock endpoint active');
    });
});
