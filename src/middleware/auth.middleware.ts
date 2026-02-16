import { trace } from '@opentelemetry/api';
import * as crypto from 'crypto';
import { FastifyReply, FastifyRequest } from 'fastify';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { redis } from '../lib/redis.js';

const tracer = trace.getTracer('auth-middleware');

/**
 * SHA-256 hash helper for API keys
 */
export function hashApiKey(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey).digest('hex');
}

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
 * Cache key generator for user data - uses HASH of key for safety in Redis
 */
function getUserCacheKey(apiKeyHash: string): string {
  return `auth:user:${apiKeyHash}`;
}

/**
 * Fetch user from cache or database with 1h TTL
 */
export async function fetchUserByApiKey(apiKey: string): Promise<{ id: string; email: string } | null> {
  return tracer.startActiveSpan('fetch-user-by-api-key', async (span) => {
    try {
      const apiKeyHash = hashApiKey(apiKey);
      const cacheKey = getUserCacheKey(apiKeyHash);

      // Try cache first
      const cached = await redis.get(cacheKey);
      if (cached) {
        span.setAttribute('cache.hit', true);
        return JSON.parse(cached);
      }

      span.setAttribute('cache.hit', false);

      // Fetch from database using HASH
      const user = await prisma.user.findUnique({
        where: { apiKeyHash } as any,
        select: { id: true, email: true },
      });

      if (!user) {
        span.setAttribute('auth.valid', false);
        return null;
      }

      // Cache for 1 hour
      await redis.setex(cacheKey, 3600, JSON.stringify(user));
      span.setAttribute('auth.valid', true);

      logger.debug('User authenticated and cached', { userId: user.id });
      return user;
    } catch (error) {
      span.recordException(error as Error);
      logger.error('Error fetching user by API key', { error });
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Invalidate user cache (call after API key rotation)
 */
export async function invalidateUserCache(apiKeyHash: string): Promise<void> {
  const cacheKey = getUserCacheKey(apiKeyHash);
  await redis.del(cacheKey);
  logger.info('User cache invalidated', { cacheKey });
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

      // Validate format (64 hex chars)
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

      logger.debug('Request authenticated', { userId: user.id, path: request.url });
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
      logger.error('Unexpected authentication error', { error });
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
