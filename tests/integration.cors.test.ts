import { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { buildApp } from '../src/index.js';

describe('🌍 CORS Validation', () => {

  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  test('CORS headers allow frontend', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
      headers: {
        Origin: process.env.FRONTEND_URL || 'http://localhost:5173'
      }
    });

    expect(res.headers['access-control-allow-origin']).toBeTruthy();
  });

});
