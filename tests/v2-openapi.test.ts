import { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/index.js';

describe('API v2 OpenAPI Exposure', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('exposes v2 routes in swagger json', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/documentation/json',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);

    expect(body?.openapi).toBe('3.1.0');
    expect(body?.paths).toBeTruthy();
    const paths = Object.keys(body.paths || {});
    expect(paths.some((p) => p.startsWith('/api/v2/endpoints'))).toBe(true);
    expect(paths.some((p) => p.startsWith('/api/v2/service-keys'))).toBe(true);
  });
});
