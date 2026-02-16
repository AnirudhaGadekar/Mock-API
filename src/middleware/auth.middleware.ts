import { trace } from '@opentelemetry/api';
import { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../lib/db.js'; // Updated import path to match others? Or ../lib/prisma.js?
import { logger } from '../lib/logger.js';
// The file I read used ../lib/prisma.js. Let's check if that exists.
// src/index.ts used ./lib/db.js.
// I'll stick to ../lib/db.js if it works, or check list_dir.
// Previous file used ../lib/prisma.js. I'll check if both exist.

import { redis } from '../lib/redis.js';

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
export function extractApiKey(request: FastifyRequest): string | null {
  // Check X-API-Key header
  let headerKey = request.headers['x-api-key'];

  // Check Authorization: Bearer <key>
  if (!headerKey && request.headers.authorization) {
    const parts = request.headers.authorization.split(' ');
    if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
      headerKey = parts[1];
    }
  }

  if (!headerKey) {
    return null;
  }

  // Handle both string and array formats
  return Array.isArray(headerKey) ? headerKey[0] : headerKey;
}

import { hashApiKey } from '../utils/apiKey.js';

// ... (imports remain similar, but adding hashApiKey)

/**
 * Cache key generator for user data (Uses hash for security)
 */
function getUserCacheKey(apiKeyHash: string): string {
  return `auth:user:hash:${apiKeyHash}`;
}

/**
 * Fetch user from cache or database with 1h TTL
 */
export async function fetchUserByApiKey(apiKey: string): Promise<any | null> {
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

      // Fetch from database using hashed key
      const user = await prisma.user.findUnique({
        where: { apiKeyHash },
        include: {
          ownedTeams: { select: { id: true, slug: true, name: true } },
          teamMemberships: {
            include: { team: { select: { id: true, slug: true, name: true } } }
          }
        }
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
 * Invalidate user cache
 */
export async function invalidateUserCache(apiKey: string): Promise<void> {
  const apiKeyHash = hashApiKey(apiKey);
  const cacheKey = getUserCacheKey(apiKeyHash);
  await redis.del(cacheKey);
  logger.info('User cache invalidated', { cacheKey });
}

/**
 * Fastify middleware: Authenticate API key and attach user to request
 * Usage: fastify.register(async (instance) => { instance.addHook('preHandler', authenticateApiKey); ... })
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
        // Optional: Check for cookie token if we implement JWT later
        span.setAttribute('auth.missing', true);
        throw new AuthenticationError('Missing API Key or Authorization header');
      }

      // Fetch user with caching
      const user = await fetchUserByApiKey(apiKey);

      if (!user) {
        span.setAttribute('auth.user_not_found', true);
        throw new ForbiddenError('Invalid API Key');
      }

      // Attach user to request for downstream handlers
      (request as any).user = user;
      span.setAttribute('user.id', user.id);

      // logger.debug('Request authenticated', { userId: user.id, path: request.url });
    } catch (error) {
      if (error instanceof AuthenticationError) {
        return reply.status(error.statusCode).send({
          success: false,
          error: {
            code: 'AUTHENTICATION_REQUIRED',
            message: error.message,
          },
        });
      }

      if (error instanceof ForbiddenError) {
        return reply.status(403).send({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: error.message,
          },
        });
      }

      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Helper: Get authenticated user from request
 */
export function getAuthenticatedUser(request: FastifyRequest): any {
  const user = (request as any).user;

  if (!user) {
    throw new AuthenticationError('No authenticated user found');
  }

  return user;
}
