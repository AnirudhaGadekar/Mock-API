import { trace } from '@opentelemetry/api';
import { logger } from '../lib/logger';
import { redis } from '../lib/redis';

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

// FIXED: Remove userId from cache key for routing
export function getEndpointSubdomainCacheKey(subdomain: string): string {
  return `endpoint:subdomain:${subdomain}`;
}

export function getEndpointRequestCountKey(endpointId: string): string {
  return `endpoint:req_count:${endpointId}`;
}

/**
 * Generate hash for query parameters (for cache key uniqueness)
 */
export function hashQueryParams(params: Record<string, any>): string {
  const sorted = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');

  let hash = 0;
  for (let i = 0; i < sorted.length; i++) {
    const char = sorted.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
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
    } catch (error) {
      span.recordException(error as Error);
      logger.error('Failed to cache endpoint list', { error, userId });
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
      if (!cached) return null;

      span.setAttribute('cache.hit', true);
      return JSON.parse(cached);
    } catch (error) {
      span.recordException(error as Error);
      return null;
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
    } catch (error) {
      span.recordException(error as Error);
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
      if (!cached) return null;
      return JSON.parse(cached);
    } catch (error) {
      span.recordException(error as Error);
      return null;
    } finally {
      span.end();
    }
  });
}

/**
 * Cache subdomain-to-endpoint mapping (hot path for router)
 * FIXED: Removed userId from arguments as it is redundant for the key
 */
export async function cacheSubdomainMapping(
  subdomain: string,
  endpointData: any
): Promise<void> {
  return tracer.startActiveSpan('cache-subdomain-mapping', async (span) => {
    try {
      // Logic fix: Ensure we don't cache deeply nested rule objects if not needed, 
      // but here we likely need the full object for the router.
      const key = getEndpointSubdomainCacheKey(subdomain);
      await redis.setex(key, ENDPOINT_DETAIL_TTL, JSON.stringify(endpointData));
    } catch (error) {
      span.recordException(error as Error);
      logger.error('Failed to cache subdomain mapping', { error, subdomain });
    } finally {
      span.end();
    }
  });
}

/**
 * Get cached subdomain mapping
 */
export async function getCachedSubdomainMapping(subdomain: string): Promise<any | null> {
  return tracer.startActiveSpan('get-cached-subdomain-mapping', async (span) => {
    try {
      const key = getEndpointSubdomainCacheKey(subdomain);
      const cached = await redis.get(key);
      if (!cached) return null;
      return JSON.parse(cached);
    } catch (error) {
      span.recordException(error as Error);
      return null;
    } finally {
      span.end();
    }
  });
}

/**
 * Invalidate ALL endpoint caches for a user
 * FIXED: Uses SCAN instead of KEYS to avoid blocking Redis
 */
export async function invalidateUserEndpointCache(userId: string): Promise<void> {
  return tracer.startActiveSpan('invalidate-user-endpoint-cache', async (span) => {
    try {
      const pattern = `user:endpoints:${userId}:*`;
      const keys: string[] = [];
      let cursor = '0';

      // Safe SCAN iteration
      do {
        const [nextCursor, matchedKeys] = await redis.scan(
          cursor,
          'MATCH',
          pattern,
          'COUNT',
          100
        );
        cursor = nextCursor;
        if (matchedKeys.length > 0) {
          keys.push(...matchedKeys);
        }
      } while (cursor !== '0');

      if (keys.length > 0) {
        await redis.del(...keys);
        span.setAttribute('cache.keys_deleted', keys.length);
      }
    } catch (error) {
      span.recordException(error as Error);
      logger.error('Failed to invalidate user endpoint cache', { error, userId });
    } finally {
      span.end();
    }
  });
}

/**
 * Invalidate specific endpoint cache
 */
export async function invalidateEndpointCache(
  endpointId: string,
  subdomain?: string
): Promise<void> {
  const keysToDelete = [getEndpointDetailCacheKey(endpointId)];
  if (subdomain) {
    keysToDelete.push(getEndpointSubdomainCacheKey(subdomain));
  }
  await redis.del(...keysToDelete);
}

/**
 * Buffered Request Counter
 * Instead of hitting DB every time, we increment in Redis and let a CRON job flush it.
 */
export async function bufferRequestCount(endpointId: string): Promise<void> {
  try {
    // Increment atomic counter in Redis
    await redis.incr(getEndpointRequestCountKey(endpointId));

    // Add to a "dirty set" so the flusher knows which endpoints to update
    await redis.sadd('dirty_endpoints_counts', endpointId);
  } catch (error) {
    // If Redis fails, we log but don't crash request. 
    // We lose 1 count, better than losing the request.
    logger.error('Failed to buffer request count', { error, endpointId });
  }
}

/**
 * Flush counts to DB (Call this from a cron/interval)
 */
export async function flushRequestCounts(prisma: any): Promise<void> {
  try {
    const dirtyEndpoints = await redis.smembers('dirty_endpoints_counts');
    if (dirtyEndpoints.length === 0) return;

    logger.debug('Flushing request counts to DB', { count: dirtyEndpoints.length });

    for (const id of dirtyEndpoints) {
      const key = getEndpointRequestCountKey(id);
      // Get and reset counter atomically
      const countStr = await redis.getset(key, '0');
      const count = parseInt(countStr || '0', 10);

      if (count > 0) {
        await prisma.endpoint.update({
          where: { id },
          data: { requestCount: { increment: count } },
        }).catch((err: Error) => {
          logger.error('Failed to flush count to DB', { err, id });
        });
      }
    }

    // Cleanup processed IDs (safe-ish, better to use Lua for perfect atomicity but this is fine for now)
    await redis.srem('dirty_endpoints_counts', ...dirtyEndpoints);
  } catch (error) {
    logger.error('Failed to flush request counts', error);
  }
}

export async function publishEndpointEvent(
  eventType: 'created' | 'updated' | 'deleted',
  userId: string,
  endpointData: any
): Promise<void> {
  const channel = `endpoint:${eventType}:${userId}`;
  const message = JSON.stringify({
    event: eventType,
    userId,
    endpoint: endpointData,
    timestamp: new Date().toISOString(),
  });
  await redis.publish(channel, message).catch(console.error);
}

/**
 * Get next sequence index using atomic Redis increment
 */
export async function getNextSequenceIndex(endpointId: string, rulePath: string, method: string, modulo: number): Promise<number> {
  const key = `sequence:${endpointId}:${rulePath}:${method}`;
  try {
    const next = await redis.incr(key);
    // Redis INCR starts at 1, we want 0-based.
    // If modulo is 3:
    // next=1 -> (0) % 3 = 0
    // next=2 -> (1) % 3 = 1
    // next=3 -> (2) % 3 = 2
    // next=4 -> (3) % 3 = 0
    return (next - 1) % modulo;
  } catch (error) {
    logger.error('Failed to get next sequence index', { error });
    return 0; // Fallback to first item on error
  }
}
