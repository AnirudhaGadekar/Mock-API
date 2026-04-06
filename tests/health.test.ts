import { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/index.js';

describe('Health Check Endpoints', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('should return ok status on /healthz/live', async () => {
    const response = await app.inject({ method: 'GET', url: '/healthz/live' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('ok');
    expect(body.uptime).toBeGreaterThan(0);
  });

  it('should return readiness shape on /healthz/ready', async () => {
    const response = await app.inject({ method: 'GET', url: '/healthz/ready' });
    expect([200, 503]).toContain(response.statusCode);
    const body = response.json();
    expect(body.status).toMatch(/ready|not ready/);
  });

  it('should return health payload on /health', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect([200, 503]).toContain(response.statusCode);
    const body = response.json();
    expect(body.status).toMatch(/healthy|unhealthy/);
    expect(body.timestamp).toBeTruthy();
  });

  it('should expose metrics endpoint', async () => {
    const response = await app.inject({ method: 'GET', url: '/metrics' });
    expect(response.statusCode).toBe(200);
    expect(String(response.headers['content-type'] || '')).toContain('text/plain');
    expect(response.body.length).toBeGreaterThan(10);
  });

  it('should answer root probes on the API hostname without entering mock routing', async () => {
    const previousBaseMockDomain = process.env.BASE_MOCK_DOMAIN;
    process.env.BASE_MOCK_DOMAIN = 'mockapi.online';

    const probeApp = await buildApp();
    await probeApp.ready();

    try {
      const response = await probeApp.inject({
        method: 'HEAD',
        url: '/',
        headers: {
          host: 'api.mockapi.online',
        },
      });

      expect(response.statusCode).toBe(200);
    } finally {
      await probeApp.close();
      process.env.BASE_MOCK_DOMAIN = previousBaseMockDomain;
    }
  });
});
