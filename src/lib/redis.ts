import { createRequire } from 'module';
import { logger } from './logger.js';

const require = createRequire(import.meta.url);
const Redis = require('ioredis') as any;

declare global {
  // eslint-disable-next-line no-var
  var redis: any | undefined;
}

/**
 * Redis client singleton with automatic reconnection
 * 
 * Features:
 * - Connection pooling
 * - Automatic reconnection with backoff
 * - Health monitoring
 * - Graceful shutdown
 */
const getRedisClient = () => {
  const options = {
    retryStrategy(times: number) {
      const delay = Math.min(times * 50, 2000);
      logger.warn(`Redis reconnecting attempt ${times}, delay: ${delay}ms`);
      return delay;
    },
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    enableOfflineQueue: true,
    lazyConnect: false,
    // Production optimizations
    connectTimeout: 10000,
    commandTimeout: 5000,
    retryDelayOnFailover: 100,
  };

  if (process.env.REDIS_URL) {
    logger.info('Redis: Using REDIS_URL for connection');
    const isTls = process.env.REDIS_URL.startsWith('rediss://');
    return new Redis(process.env.REDIS_URL, {
      ...options,
      tls: isTls ? {} : undefined,
    });
  }

  logger.info(`Redis: Attempting connection to ${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || '6379'}`);
  return new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB || '0', 10),
    // Enable TLS for non-localhost connections (Upstash requires this)
    tls: process.env.REDIS_HOST && process.env.REDIS_HOST !== 'localhost' ? {} : undefined,
    ...options,
  });
};

let _redis: any = global.redis || getRedisClient();

function attachEventHandlers(client: any) {
  client.on('connect', () => {
    logger.info('Redis connection established');
  });

  client.on('ready', () => {
    logger.info('Redis client ready');
  });

  client.on('error', (error: any) => {
    logger.error('Redis connection error', { error: error.message });
  });

  client.on('close', () => {
    logger.warn('Redis connection closed');
  });

  client.on('reconnecting', (delay: number) => {
    logger.info(`Redis reconnecting in ${delay}ms`);
  });
}

attachEventHandlers(_redis);

function ensureRedis(): any {
  // ioredis: status can be 'ready'|'connect'|'reconnecting'|'end' etc.
  if (!_redis || _redis.status === 'end') {
    _redis = getRedisClient();
    attachEventHandlers(_redis);
    if (process.env.NODE_ENV !== 'production') {
      global.redis = _redis;
    }
  }
  return _redis;
}

// Export a proxy so code keeps using `redis.*`, but we can recover if some test calls `redis.quit()`.
export const redis: any = new Proxy({}, {
  get(_target, prop: string) {
    const client = ensureRedis();
    const value = client[prop];
    if (typeof value === 'function') {
      return value.bind(client);
    }
    return value;
  },
});

// Store in global to prevent hot-reload creating multiple instances
if (process.env.NODE_ENV !== 'production') {
  global.redis = _redis;
}

/**
 * Graceful shutdown handler for Redis connection
 */
export async function disconnectRedis(): Promise<void> {
  const client = ensureRedis();
  await client.quit();
  logger.info('Redis connection closed gracefully');
}

/**
 * Health check for Redis connection
 */
export async function checkRedisHealth(): Promise<boolean> {
  try {
    const client = ensureRedis();
    const result = await client.ping();
    return result === 'PONG';
  } catch (error) {
    logger.error('Redis health check failed', { error });
    return false;
  }
}
