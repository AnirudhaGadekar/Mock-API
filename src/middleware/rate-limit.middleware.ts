import rateLimit from '@fastify/rate-limit';
import { FastifyPluginAsync } from 'fastify';
import { logger } from '../lib/logger';
import { redis } from '../lib/redis';

/**
 * Redis-backed rate limit store for distributed systems
 */
class RedisRateLimitStore {
  private prefix: string;

  /**
   * fastify-rate-limit calls `new Store(opts)`, so we accept the full
   * options object and derive a prefix from it (falling back to "ratelimit").
   */
  constructor(opts?: { nameSpace?: string } | string) {
    if (typeof opts === 'string') {
      this.prefix = opts;
    } else {
      this.prefix = (opts && opts.nameSpace) || 'ratelimit';
    }
  }

  private getKey(routeKey: string, identifier: string): string {
    return `${this.prefix}:${routeKey}:${identifier}`;
  }

  async incr(key: string, callback: (err: Error | null, result?: { current: number; ttl: number }) => void): Promise<void> {
    try {
      const redisKey = this.getKey('default', key);

      // Use Redis pipeline for atomic operations
      const pipeline = redis.pipeline();
      pipeline.incr(redisKey);
      pipeline.ttl(redisKey);

      const results = await pipeline.exec();

      if (!results) {
        throw new Error('Redis pipeline returned null');
      }

      const [[incrErr, current], [ttlErr, ttl]] = results as [[Error | null, number], [Error | null, number]];

      if (incrErr || ttlErr) {
        throw incrErr || ttlErr;
      }

      // Set expiry on first increment
      if (current === 1) {
        await redis.expire(redisKey, 60); // 1 minute window
      }

      callback(null, { current, ttl: ttl > 0 ? ttl : 60 });
    } catch (error) {
      logger.error('Rate limit store error', { error, key });
      callback(error as Error);
    }
  }

  async child(routeOptions: any): Promise<any> {
    const routeInfo = routeOptions?.routeInfo || { method: 'unknown', url: 'unknown' };
    const routeKey = `${routeInfo.method}:${routeInfo.url}`;

    return {
      incr: async (key: string, callback: (err: Error | null, result?: { current: number; ttl: number }) => void) => {
        try {
          const redisKey = this.getKey(routeKey, key);

          const pipeline = redis.pipeline();
          pipeline.incr(redisKey);
          pipeline.ttl(redisKey);

          const results = await pipeline.exec();

          if (!results) {
            throw new Error('Redis pipeline returned null');
          }

          const [[incrErr, current], [ttlErr, ttl]] = results as [[Error | null, number], [Error | null, number]];

          if (incrErr || ttlErr) {
            throw incrErr || ttlErr;
          }

          if (current === 1) {
            await redis.expire(redisKey, 60);
          }

          callback(null, { current, ttl: ttl > 0 ? ttl : 60 });
        } catch (error) {
          logger.error('Rate limit child store error', { error, key, routeKey });
          callback(error as Error);
        }
      },
    };
  }
}

/**
 * Rate limiting configuration for different route types
 */
export const rateLimitConfig = {
  // Endpoint creation: 100 requests per minute per user
  endpointCreate: {
    max: 100,
    timeWindow: '1 minute',
    keyGenerator: (req: any) => {
      const user = req.user;
      return user ? `user:${user.id}` : req.ip;
    },
    errorResponseBuilder: (_req: any, context: any) => {
      return {
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many endpoint creation requests. Please try again later.',
          retryAfter: context.ttl,
        },
        timestamp: new Date().toISOString(),
      };
    },
    skipOnError: true, // Don't fail open on Redis errors
  },

  // General API: 500 requests per hour per IP
  generalApi: {
    max: 500,
    timeWindow: '1 hour',
    keyGenerator: (req: any) => req.ip,
    errorResponseBuilder: (_req: any, context: any) => {
      return {
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests. Please try again later.',
          retryAfter: context.ttl,
        },
        timestamp: new Date().toISOString(),
      };
    },
    skipOnError: true,
  },

  // Mock endpoint requests: 1000 requests per minute per endpoint
  endpointRequests: {
    max: 1000,
    timeWindow: '1 minute',
    keyGenerator: (req: any) => {
      const endpoint = req.endpoint;
      return endpoint ? `endpoint:${endpoint.id}` : req.ip;
    },
    errorResponseBuilder: (_req: any, context: any) => {
      return {
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Mock endpoint rate limit exceeded. Please upgrade for higher limits.',
          retryAfter: context.ttl,
        },
        timestamp: new Date().toISOString(),
      };
    },
    skipOnError: false, // Enforce limits even on Redis errors
  },
};

/**
 * Fastify rate limit plugin registration
 */
export const registerRateLimiting: FastifyPluginAsync = async (fastify, _opts) => {
  // Register global rate limit (general API protection)
  await fastify.register(rateLimit, {
    global: false, // We'll apply per-route
    redis, // Use our Redis instance
    nameSpace: 'ratelimit:', // Prefix for Redis keys
    ...rateLimitConfig.generalApi,
    store: RedisRateLimitStore as any,
    addHeaders: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
    },
  });

  logger.info('Rate limiting registered with Redis backend');
};

/**
 * Apply rate limit to specific route
 * Usage in routes:
 * 
 * fastify.post('/create', {
 *   preHandler: createRateLimiter,
 *   handler: async (req, reply) => { ... }
 * });
 */
export async function createEndpointRateLimiter(fastify: any) {
  return fastify.register(rateLimit, {
    ...rateLimitConfig.endpointCreate,
    redis,
    nameSpace: 'ratelimit:',
    store: RedisRateLimitStore as any,
  });
}

export async function endpointRequestRateLimiter(fastify: any) {
  return fastify.register(rateLimit, {
    ...rateLimitConfig.endpointRequests,
    redis,
    nameSpace: 'ratelimit:',
    store: RedisRateLimitStore as any,
  });
}

/**
 * Standalone rate limit middleware (for custom logic)
 */
export async function checkRateLimit(
  key: string,
  max: number,
  windowSeconds: number
): Promise<{ allowed: boolean; remaining: number; resetAt: Date }> {
  try {
    const redisKey = `ratelimit:custom:${key}`;

    const pipeline = redis.pipeline();
    pipeline.incr(redisKey);
    pipeline.ttl(redisKey);

    const results = await pipeline.exec();

    if (!results) {
      throw new Error('Redis pipeline returned null');
    }

    const [[incrErr, current], [ttlErr, ttl]] = results as [[Error | null, number], [Error | null, number]];

    if (incrErr || ttlErr) {
      throw incrErr || ttlErr;
    }

    // Set expiry on first request
    if (current === 1) {
      await redis.expire(redisKey, windowSeconds);
    }

    const allowed = current <= max;
    const remaining = Math.max(0, max - current);
    const resetAt = new Date(Date.now() + (ttl > 0 ? ttl * 1000 : windowSeconds * 1000));

    return { allowed, remaining, resetAt };
  } catch (error) {
    logger.error('Rate limit check failed', { error, key });
    // Fail open on errors (allow request)
    return { allowed: true, remaining: max, resetAt: new Date(Date.now() + windowSeconds * 1000) };
  }
}
