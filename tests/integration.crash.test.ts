import { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { buildApp } from '../src/index.js';

describe('Crash/Error Handling Integration', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    app.get('/__boom', async () => {
      throw new Error('boom-test-error');
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  test('returns structured 500 for unhandled route error', async () => {
    const res = await app.inject({ method: 'GET', url: '/__boom' });
    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('INTERNAL_ERROR');
    expect(body.timestamp).toBeTruthy();
  });

  test('returns structured 404 from not-found handler', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/definitely-not-a-route' });
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('NOT_FOUND');
  });
});
