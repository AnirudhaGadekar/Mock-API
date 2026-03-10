import { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/index.js';

describe('API Version Headers', () => {
  let app: FastifyInstance;
  let apiKey = '';

  beforeAll(async () => {
    app = await buildApp();
    const anon = await app.inject({ method: 'POST', url: '/api/v2/auth/anonymous' });
    apiKey = JSON.parse(anon.payload).apiKey;
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns standard not-found for removed v1 routes', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { 'x-api-key': apiKey },
    });

    expect(res.statusCode).toBe(404);
    expect(res.headers['x-api-version']).toBeUndefined();
  });

  it('sets stable headers for v2 routes', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v2/endpoints',
      headers: { 'x-api-key': apiKey },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['x-api-version']).toBe('2');
    expect(res.headers['x-api-contract']).toBe('stable');
    expect(res.headers['x-api-lifecycle']).toBe('current');
    expect(res.headers['x-api-supported-versions']).toBe('2');
    expect(res.headers['deprecation']).toBe('false');
    expect(res.headers['sunset']).toBeTruthy();
    expect(res.headers['x-api-migration-guide']).toBe('/documentation');
  });
});
