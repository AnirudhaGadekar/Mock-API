import { redis } from '../lib/redis';
import { logger } from '../lib/logger';
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('endpoint-cache');

const ENDPOINT_LIST_TTL = 300; // 5 minutes
const ENDPOINT_DETAIL_TTL = 600; // 10 minutes

/**
 * Generate cache keys
 */
export function getEndpointListCacheKey(userId: string, queryHash: string): string {
  return `user:endpoints:${userId}:${queryHash}`;
}

export function getEndpointDetailCacheKey(endpointId: string): string {
  return `endpoint:detail:${endpointId}`;
}

export function getEndpointSubdomainCacheKey(subdomain: string, userId: string): string {
  return `endpoint:subdomain:${subdomain}:${userId}`;
}

/**
 * Generate hash for query parameters (for cache key uniqueness)
 */
export function hashQueryParams(params: Record<string, any>): string {
  const sorted = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');
  
  // Simple hash for cache key (not cryptographic)
  let hash = 0;
  for (let i = 0; i < sorted.length; i++) {
    const char = sorted.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Cache endpoint list with TTL
 */
export async function cacheEndpointList(
  userId: string,
  queryHash: string,
  data: any
): Promise<void> {
  return tracer.startActiveSpan('cache-endpoint-list', async (span) => {
    try {
      const key = getEndpointListCacheKey(userId, queryHash);
      await redis.setex(key, ENDPOINT_LIST_TTL, JSON.stringify(data));
      
      span.setAttribute('cache.key', key);
      span.setAttribute('cache.ttl', ENDPOINT_LIST_TTL);
      
      logger.debug({ userId, queryHash }, 'Cached endpoint list');
    } catch (error) {
      span.recordException(error as Error);
      logger.error({ error, userId }, 'Failed to cache endpoint list');
      // Don't throw - caching is not critical
    } finally {
      span.end();
    }
  });
}

/**
 * Get cached endpoint list
 */
export async function getCachedEndpointList(
  userId: string,
  queryHash: string
): Promise<any | null> {
  return tracer.startActiveSpan('get-cached-endpoint-list', async (span) => {
    try {
      const key = getEndpointListCacheKey(userId, queryHash);
      const cached = await redis.get(key);
      
      if (!cached) {
        span.setAttribute('cache.hit', false);
        return null;
      }

      span.setAttribute('cache.hit', true);
      logger.debug({ userId, queryHash }, 'Endpoint list cache hit');
      
      return JSON.parse(cached);
    } catch (error) {
      span.recordException(error as Error);
      logger.error({ error, userId }, 'Failed to get cached endpoint list');
      return null; // Fail gracefully
    } finally {
      span.end();
    }
  });
}

/**
 * Cache single endpoint detail
 */
export async function cacheEndpointDetail(endpointId: string, data: any): Promise<void> {
  return tracer.startActiveSpan('cache-endpoint-detail', async (span) => {
    try {
      const key = getEndpointDetailCacheKey(endpointId);
      await redis.setex(key, ENDPOINT_DETAIL_TTL, JSON.stringify(data));
      
      span.setAttribute('cache.key', key);
      logger.debug({ endpointId }, 'Cached endpoint detail');
    } catch (error) {
      span.recordException(error as Error);
      logger.error({ error, endpointId }, 'Failed to cache endpoint detail');
    } finally {
      span.end();
    }
  });
}

/**
 * Get cached endpoint detail
 */
export async function getCachedEndpointDetail(endpointId: string): Promise<any | null> {
  return tracer.startActiveSpan('get-cached-endpoint-detail', async (span) => {
    try {
      const key = getEndpointDetailCacheKey(endpointId);
      const cached = await redis.get(key);
      
      if (!cached) {
        span.setAttribute('cache.hit', false);
        return null;
      }

      span.setAttribute('cache.hit', true);
      logger.debug({ endpointId }, 'Endpoint detail cache hit');
      
      return JSON.parse(cached);
    } catch (error) {
      span.recordException(error as Error);
      logger.error({ error, endpointId }, 'Failed to get cached endpoint detail');
      return null;
    } finally {
      span.end();
    }
  });
}

/**
 * Cache subdomain-to-endpoint mapping (hot path for router)
 */
export async function cacheSubdomainMapping(
  subdomain: string,
  userId: string,
  endpointData: any
): Promise<void> {
  return tracer.startActiveSpan('cache-subdomain-mapping', async (span) => {
    try {
      const key = getEndpointSubdomainCacheKey(subdomain, userId);
      await redis.setex(key, ENDPOINT_DETAIL_TTL, JSON.stringify(endpointData));
      
      span.setAttribute('cache.key', key);
      logger.debug({ subdomain, userId }, 'Cached subdomain mapping');
    } catch (error) {
      span.recordException(error as Error);
      logger.error({ error, subdomain }, 'Failed to cache subdomain mapping');
    } finally {
      span.end();
    }
  });
}

/**
 * Get cached subdomain mapping
 */
export async function getCachedSubdomainMapping(
  subdomain: string,
  userId: string
): Promise<any | null> {
  return tracer.startActiveSpan('get-cached-subdomain-mapping', async (span) => {
    try {
      const key = getEndpointSubdomainCacheKey(subdomain, userId);
      const cached = await redis.get(key);
      
      if (!cached) {
        span.setAttribute('cache.hit', false);
        return null;
      }

      span.setAttribute('cache.hit', true);
      logger.debug({ subdomain, userId }, 'Subdomain mapping cache hit');
      
      return JSON.parse(cached);
    } catch (error) {
      span.recordException(error as Error);
      logger.error({ error, subdomain }, 'Failed to get cached subdomain mapping');
      return null;
    } finally {
      span.end();
    }
  });
}

/**
 * Invalidate ALL endpoint caches for a user
 * Call after: create, delete, update operations
 */
export async function invalidateUserEndpointCache(userId: string): Promise<void> {
  return tracer.startActiveSpan('invalidate-user-endpoint-cache', async (span) => {
    try {
      // Delete all list caches for this user (pattern match)
      const pattern = `user:endpoints:${userId}:*`;
      const keys = await redis.keys(pattern);
      
      if (keys.length > 0) {
        await redis.del(...keys);
        span.setAttribute('cache.keys_deleted', keys.length);
        logger.info({ userId, keysDeleted: keys.length }, 'Invalidated user endpoint cache');
      }
    } catch (error) {
      span.recordException(error as Error);
      logger.error({ error, userId }, 'Failed to invalidate user endpoint cache');
      // Don't throw - invalidation failure shouldn't break the operation
    } finally {
      span.end();
    }
  });
}

/**
 * Invalidate specific endpoint cache
 * Call after: update, delete operations
 */
export async function invalidateEndpointCache(
  endpointId: string,
  subdomain?: string,
  userId?: string
): Promise<void> {
  return tracer.startActiveSpan('invalidate-endpoint-cache', async (span) => {
    try {
      const keysToDelete: string[] = [getEndpointDetailCacheKey(endpointId)];
      
      if (subdomain && userId) {
        keysToDelete.push(getEndpointSubdomainCacheKey(subdomain, userId));
      }

      await redis.del(...keysToDelete);
      span.setAttribute('cache.keys_deleted', keysToDelete.length);
      
      logger.info({ endpointId, subdomain }, 'Invalidated endpoint cache');
    } catch (error) {
      span.recordException(error as Error);
      logger.error({ error, endpointId }, 'Failed to invalidate endpoint cache');
    } finally {
      span.end();
    }
  });
}

/**
 * Publish event to Redis pub/sub (for real-time updates)
 */
export async function publishEndpointEvent(
  eventType: 'created' | 'updated' | 'deleted',
  userId: string,
  endpointData: any
): Promise<void> {
  return tracer.startActiveSpan('publish-endpoint-event', async (span) => {
    try {
      const channel = `endpoint:${eventType}:${userId}`;
      const message = JSON.stringify({
        event: eventType,
        userId,
        endpoint: endpointData,
        timestamp: new Date().toISOString(),
      });

      await redis.publish(channel, message);
      
      span.setAttribute('pubsub.channel', channel);
      span.setAttribute('pubsub.event', eventType);
      
      logger.debug({ userId, eventType, endpointId: endpointData.id }, 'Published endpoint event');
    } catch (error) {
      span.recordException(error as Error);
      logger.error({ error, userId, eventType }, 'Failed to publish endpoint event');
    } finally {
      span.end();
    }
  });
}
