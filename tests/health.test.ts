import Fastify, { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkDatabaseHealth } from '../src/lib/db.js';
import { checkRedisHealth } from '../src/lib/redis.js';

describe('Health Check Endpoints', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });

    app.get('/healthz', async () => {
      const dbHealthy = await checkDatabaseHealth();
      const redisHealthy = await checkRedisHealth();

      return {
        status: dbHealthy && redisHealthy ? 'ok' : 'degraded',
        uptime: process.uptime(),
        checks: {
          database: dbHealthy ? 'healthy' : 'unhealthy',
          redis: redisHealthy ? 'healthy' : 'unhealthy',
        },
      };
    });

    app.get('/healthz/live', async () => {
      return {
        status: 'ok',
        uptime: process.uptime(),
      };
    });

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('should return ok status on /healthz/live', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/healthz/live',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe('ok');
    expect(body.uptime).toBeGreaterThan(0);
  });

  it('should return health status on /healthz', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/healthz',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toMatch(/ok|degraded/);
    expect(body.checks).toBeDefined();
    expect(body.checks.database).toMatch(/healthy|unhealthy/);
    expect(body.checks.redis).toMatch(/healthy|unhealthy/);
  });
});
