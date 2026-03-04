import { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { buildApp } from '../src/index.js';

describe('🌐 Infrastructure Health Check', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  test('Backend health endpoint works', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health'
    });

    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.payload);
    expect(data.status).toBe('healthy');
    expect(data.services).toBeDefined();
  });

  test('Database connectivity works', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/healthz/ready'
    });

    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.payload);
    expect(data.status).toBe('ready');
  });

});
