import { describe, expect, it } from 'vitest';
import { getRedisConfigurationError, resolveRedisConnectionConfig } from '../src/lib/redis.js';

describe('Redis configuration resolution', () => {
  it('falls back to REDIS_HOST and REDIS_PORT when REDIS_URL is malformed', () => {
    const resolved = resolveRedisConnectionConfig({
      REDIS_URL: '/',
      REDIS_HOST: 'cache.internal',
      REDIS_PORT: '6379',
      REDIS_DB: '2',
    });

    expect(resolved).toMatchObject({
      mode: 'host',
      host: 'cache.internal',
      port: 6379,
      db: 2,
    });
  });

  it('reports invalid REDIS_URL when there is no fallback host and port', () => {
    expect(getRedisConfigurationError({ REDIS_URL: '/' })).toBe(
      'Invalid REDIS_URL: "/" is not a valid Redis URL or socket path',
    );
  });
});
