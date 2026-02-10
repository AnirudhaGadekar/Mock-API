import Redis from 'ioredis';
import { logger } from './logger.js';

declare global {
  // eslint-disable-next-line no-var
  var redis: Redis | undefined;
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
export const redis =
  global.redis ||
  new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB || '0', 10),
    retryStrategy(times) {
      const delay = Math.min(times * 50, 2000);
      logger.warn(`Redis reconnecting attempt ${times}, delay: ${delay}ms`);
      return delay;
    },
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    enableOfflineQueue: true,
    lazyConnect: false,
  });

// Connection event handlers
redis.on('connect', () => {
  logger.info('Redis connection established');
});

redis.on('ready', () => {
  logger.info('Redis client ready');
});

redis.on('error', (error) => {
  logger.error('Redis connection error', { error: error.message });
});

redis.on('close', () => {
  logger.warn('Redis connection closed');
});

redis.on('reconnecting', (delay) => {
  logger.info(`Redis reconnecting in ${delay}ms`);
});

// Store in global to prevent hot-reload creating multiple instances
if (process.env.NODE_ENV !== 'production') {
  global.redis = redis;
}

/**
 * Graceful shutdown handler for Redis connection
 */
export async function disconnectRedis(): Promise<void> {
  await redis.quit();
  logger.info('Redis connection closed gracefully');
}

/**
 * Health check for Redis connection
 */
export async function checkRedisHealth(): Promise<boolean> {
  try {
    const result = await redis.ping();
    return result === 'PONG';
  } catch (error) {
    logger.error('Redis health check failed', { error });
    return false;
  }
}
