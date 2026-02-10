import { FastifyRequest, FastifyReply } from 'fastify';
import { trace } from '@opentelemetry/api';
import { prisma } from '../lib/prisma';
import { redis } from '../lib/redis';
import { logger } from '../lib/logger';

const tracer = trace.getTracer('auth-middleware');

/**
 * Custom error classes for authentication
 */
export class AuthenticationError extends Error {
  constructor(message: string, public statusCode: number = 401) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForbiddenError';
  }
}

/**
 * Extract API key from request headers
 */
function extractApiKey(request: FastifyRequest): string | null {
  const headerKey = request.headers['x-api-key'];
  
  if (!headerKey) {
    return null;
  }

  // Handle both string and array formats
  return Array.isArray(headerKey) ? headerKey[0] : headerKey;
}

/**
 * Cache key generator for user data
 */
function getUserCacheKey(apiKey: string): string {
  return `auth:user:${apiKey}`;
}

/**
 * Fetch user from cache or database with 1h TTL
 */
async function fetchUserByApiKey(apiKey: string): Promise<{ id: string; email: string } | null> {
  return tracer.startActiveSpan('fetch-user-by-api-key', async (span) => {
    try {
      const cacheKey = getUserCacheKey(apiKey);

      // Try cache first
      const cached = await redis.get(cacheKey);
      if (cached) {
        span.setAttribute('cache.hit', true);
        logger.debug({ apiKey: apiKey.slice(0, 8) + '***' }, 'Auth cache hit');
        return JSON.parse(cached);
      }

      span.setAttribute('cache.hit', false);

      // Fetch from database
      const user = await prisma.user.findUnique({
        where: { apiKey },
        select: { id: true, email: true },
      });

      if (!user) {
        span.setAttribute('auth.valid', false);
        return null;
      }

      // Cache for 1 hour (3600 seconds)
      await redis.setex(cacheKey, 3600, JSON.stringify(user));
      span.setAttribute('auth.valid', true);
      
      logger.debug({ userId: user.id }, 'User authenticated and cached');
      return user;
    } catch (error) {
      span.recordException(error as Error);
      logger.error({ error }, 'Error fetching user by API key');
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Invalidate user cache (call after API key rotation)
 */
export async function invalidateUserCache(apiKey: string): Promise<void> {
  const cacheKey = getUserCacheKey(apiKey);
  await redis.del(cacheKey);
  logger.info({ cacheKey }, 'User cache invalidated');
}

/**
 * Fastify middleware: Authenticate API key and attach user to request
 * Usage: fastify.addHook('preHandler', authenticateApiKey)
 */
export async function authenticateApiKey(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  return tracer.startActiveSpan('authenticate-api-key', async (span) => {
    try {
      // Extract API key from headers
      const apiKey = extractApiKey(request);

      if (!apiKey) {
        span.setAttribute('auth.missing', true);
        throw new AuthenticationError('Missing X-API-Key header');
      }

      // Validate format (should be 64 hex chars from crypto.randomBytes(32))
      if (!/^[a-f0-9]{64}$/i.test(apiKey)) {
        span.setAttribute('auth.invalid_format', true);
        throw new ForbiddenError('Invalid API key format');
      }

      // Fetch user with caching
      const user = await fetchUserByApiKey(apiKey);

      if (!user) {
        span.setAttribute('auth.user_not_found', true);
        throw new ForbiddenError('Invalid API key');
      }

      // Attach user to request for downstream handlers
      (request as any).user = user;
      span.setAttribute('user.id', user.id);

      logger.debug({ userId: user.id, path: request.url }, 'Request authenticated');
    } catch (error) {
      span.recordException(error as Error);

      if (error instanceof AuthenticationError) {
        return reply.status(error.statusCode).send({
          success: false,
          error: {
            code: 'AUTHENTICATION_REQUIRED',
            message: error.message,
          },
          timestamp: new Date().toISOString(),
        });
      }

      if (error instanceof ForbiddenError) {
        return reply.status(403).send({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: error.message,
          },
          timestamp: new Date().toISOString(),
        });
      }

      // Unexpected error
      logger.error({ error }, 'Unexpected authentication error');
      return reply.status(500).send({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Authentication failed',
        },
        timestamp: new Date().toISOString(),
      });
    } finally {
      span.end();
    }
  });
}

/**
 * Helper: Get authenticated user from request
 * Use this in route handlers after authenticateApiKey middleware
 */
export function getAuthenticatedUser(request: FastifyRequest): { id: string; email: string } {
  const user = (request as any).user;
  
  if (!user) {
    throw new AuthenticationError('No authenticated user found');
  }

  return user;
}

/**
 * Optional middleware: Require specific user ID (for admin routes)
 */
export function requireUserId(userId: string) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const user = getAuthenticatedUser(request);
    
    if (user.id !== userId) {
      return reply.status(403).send({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Access denied',
        },
        timestamp: new Date().toISOString(),
      });
    }
  };
}
