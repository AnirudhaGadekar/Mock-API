import { trace } from '@opentelemetry/api';
import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { authenticateApiKey, getAuthenticatedUser } from '../middleware/auth.middleware.js';
import { checkRateLimit } from '../middleware/rate-limit.middleware.js';
import {
    cacheEndpointDetail,
    cacheEndpointList,
    getCachedEndpointDetail,
    getCachedEndpointList,
    hashQueryParams,
    invalidateEndpointCache,
    invalidateUserEndpointCache,
    publishEndpointEvent,
} from '../utils/endpoint.cache.js';
import {
    createEndpointSchema,
    DEFAULT_MOCK_RULES,
    listEndpointsQuerySchema
} from '../validators/endpoint.validator.js';

const tracer = trace.getTracer('endpoints-api');

/**
 * Custom error classes
 */
class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

class ValidationError extends Error {
  constructor(message: string, public details?: any) {
    super(message);
    this.name = 'ValidationError';
  }
}

const BASE_MOCK_DOMAIN = process.env.BASE_MOCK_DOMAIN || 'mockurl.com';

/**
 * Format endpoint for API response (MockUrl-style: instant URL on create)
 */
function formatEndpointResponse(endpoint: { id: string; name: string; rules: unknown; requestCount?: number; createdAt: Date }) {
  const subdomain = endpoint.name;
  return {
    id: endpoint.id,
    name: endpoint.name,
    subdomain,
    url: `https://${subdomain}.${BASE_MOCK_DOMAIN}`,
    dashboardUrl: `/console/${subdomain}`,
    rules: Array.isArray(endpoint.rules) ? endpoint.rules : [],
    reqCount: endpoint.requestCount ?? 0,
    createdAt: endpoint.createdAt,
  };
}

/**
 * Endpoints API routes
 * NOTE: Zod schemas are validated manually in handlers (not via Fastify schema config)
 * to avoid incompatibility between fastify-type-provider-zod@6 and Fastify 5.7.
 */
export const endpointsRoutes: FastifyPluginAsync = async (fastify, _opts) => {
  // Apply authentication to all routes
  fastify.addHook('preHandler', authenticateApiKey);

  /**
   * POST /api/v1/endpoints/create
   */
  fastify.post('/create', async (request, reply) => {
    return tracer.startActiveSpan('trace-endpoint-create', async (span) => {
      try {
        const user = getAuthenticatedUser(request);

        // Manual Zod validation
        const parsed = createEndpointSchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.status(400).send({
            success: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid request body',
              details: parsed.error.flatten(),
            },
            timestamp: new Date().toISOString(),
          });
        }

        const { name, rules } = parsed.data;

        const rateLimit = await checkRateLimit(`user:create:${user.id}`, 100, 60);
        if (!rateLimit.allowed) {
          return reply.status(429).send({
            success: false,
            error: {
              code: 'RATE_LIMIT_EXCEEDED',
              message: 'Too many endpoint creation requests. Please try again later.',
              retryAfter: Math.ceil((rateLimit.resetAt.getTime() - Date.now()) / 1000),
            },
            timestamp: new Date().toISOString(),
          });
        }

        span.setAttribute('user.id', user.id);
        span.setAttribute('endpoint.name', name);

        const endpoint = await prisma.$transaction(async (tx) => {
          const userRecord = await tx.user.findUnique({
            where: { id: user.id },
            select: { id: true, _count: { select: { endpoints: true } } },
          });
          if (!userRecord) throw new NotFoundError('User not found');
          if (userRecord._count.endpoints >= 10) {
            throw new ValidationError('Endpoint limit reached (10 max for free tier)', {
              limit: 10,
              current: userRecord._count.endpoints,
            });
          }
          const existing = await tx.endpoint.findFirst({
            where: { name, userId: user.id, deletedAt: null },
          });
          if (existing) throw new ConflictError(`Endpoint with name "${name}" already exists`);
          return tx.endpoint.create({
            data: {
              name,
              userId: user.id,
              rules: rules && rules.length > 0 ? (rules as object[]) : DEFAULT_MOCK_RULES,
              requestCount: 0,
            },
          });
        });

        await invalidateUserEndpointCache(user.id);
        await publishEndpointEvent('created', user.id, endpoint);

        const endpointPayload = formatEndpointResponse(endpoint);
        span.setAttribute('endpoint.id', endpoint.id);
        logger.info('Endpoint created', { userId: user.id, endpointId: endpoint.id, name });

        return reply.status(201).send({
          success: true,
          endpoint: endpointPayload,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        span.recordException(error as Error);

        if (error instanceof ConflictError) {
          return reply.status(409).send({
            success: false,
            error: { code: 'ENDPOINT_EXISTS', message: error.message },
            timestamp: new Date().toISOString(),
          });
        }

        if (error instanceof ValidationError) {
          return reply.status(422).send({
            success: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: error.message,
              details: error.details,
            },
            timestamp: new Date().toISOString(),
          });
        }

        logger.error('Failed to create endpoint', { error });
        return reply.status(500).send({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Failed to create endpoint' },
          timestamp: new Date().toISOString(),
        });
      } finally {
        span.end();
      }
    });
  });

  /**
   * GET /api/v1/endpoints
   */
  fastify.get('/', async (request, reply) => {
    return tracer.startActiveSpan('list-endpoints', async (span) => {
      try {
        const user = getAuthenticatedUser(request);

        // Manual Zod validation of query params
        const parsed = listEndpointsQuerySchema.safeParse(request.query);
        if (!parsed.success) {
          return reply.status(400).send({
            success: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid query parameters',
              details: parsed.error.flatten(),
            },
            timestamp: new Date().toISOString(),
          });
        }

        const { limit, afterId, sort, search } = parsed.data;

        span.setAttribute('user.id', user.id);
        span.setAttribute('pagination.limit', limit);

        const queryHash = hashQueryParams(request.query as any);
        const cached = await getCachedEndpointList(user.id, queryHash);
        if (cached) {
          span.setAttribute('cache.hit', true);
          return reply.status(200).send({
            success: true,
            ...cached,
            timestamp: new Date().toISOString(),
          });
        }

        span.setAttribute('cache.hit', false);

        const [sortField, sortOrder] = sort.split(':') as [string, 'asc' | 'desc'];

        const where: Record<string, unknown> = {
          userId: user.id,
          deletedAt: null,
        };
        if (search) {
          where.name = { contains: search, mode: 'insensitive' as const };
        }

        const endpoints = await prisma.endpoint.findMany({
          where,
          take: limit + 1,
          ...(afterId && { cursor: { id: afterId }, skip: 1 }),
          orderBy: { [sortField]: sortOrder },
          select: {
            id: true,
            name: true,
            rules: true,
            requestCount: true,
            createdAt: true,
          },
        });

        const totalCount = await prisma.endpoint.count({ where });
        const hasMore = endpoints.length > limit;
        const resultEndpoints = hasMore ? endpoints.slice(0, limit) : endpoints;
        const nextCursor = hasMore ? resultEndpoints[resultEndpoints.length - 1].id : null;
        const formattedEndpoints = resultEndpoints.map((ep) => formatEndpointResponse(ep));

        const responseData = {
          endpoints: formattedEndpoints,
          nextCursor: nextCursor ?? undefined,
          totalCount,
        };
        await cacheEndpointList(user.id, queryHash, responseData);
        span.setAttribute('result.count', formattedEndpoints.length);

        return reply.status(200).send({
          success: true,
          ...responseData,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        span.recordException(error as Error);
        logger.error('Failed to list endpoints', { error });

        return reply.status(500).send({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Failed to list endpoints' },
          timestamp: new Date().toISOString(),
        });
      } finally {
        span.end();
      }
    });
  });

  /**
   * GET /api/v1/endpoints/:id
   */
  fastify.get('/:id', async (request, reply) => {
    return tracer.startActiveSpan('get-endpoint', async (span) => {
      try {
        const user = getAuthenticatedUser(request);
        const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
        if (!params.success) {
          return reply.status(400).send({
            success: false,
            error: { code: 'VALIDATION_ERROR', message: 'Invalid endpoint ID' },
            timestamp: new Date().toISOString(),
          });
        }
        const { id } = params.data;

        span.setAttribute('user.id', user.id);
        span.setAttribute('endpoint.id', id);

        const cached = await getCachedEndpointDetail(id);
        if (cached && cached.userId === user.id) {
          span.setAttribute('cache.hit', true);
          return reply.status(200).send({
            success: true,
            ...cached,
            timestamp: new Date().toISOString(),
          });
        }

        span.setAttribute('cache.hit', false);
        const endpoint = await prisma.endpoint.findFirst({
          where: { id, userId: user.id, deletedAt: null },
        });
        if (!endpoint) throw new NotFoundError('Endpoint not found');

        const stats = { req24h: 0, total: endpoint.requestCount };
        const responseData = { ...formatEndpointResponse(endpoint), stats };
        await cacheEndpointDetail(id, { ...responseData, userId: user.id });

        return reply.status(200).send({
          success: true,
          ...responseData,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        span.recordException(error as Error);

        if (error instanceof NotFoundError) {
          return reply.status(404).send({
            success: false,
            error: { code: 'NOT_FOUND', message: error.message },
            timestamp: new Date().toISOString(),
          });
        }

        logger.error('Failed to get endpoint', { error });
        return reply.status(500).send({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Failed to get endpoint' },
          timestamp: new Date().toISOString(),
        });
      } finally {
        span.end();
      }
    });
  });

  /**
   * PATCH /api/v1/endpoints/:id
   * Update endpoint name, rules, or settings.
   */
  fastify.patch('/:id', async (request, reply) => {
    return tracer.startActiveSpan('update-endpoint', async (span) => {
      try {
        const user = getAuthenticatedUser(request);
        const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
        if (!params.success) {
          return reply.status(400).send({
            success: false,
            error: { code: 'VALIDATION_ERROR', message: 'Invalid endpoint ID' },
            timestamp: new Date().toISOString(),
          });
        }
        const { id } = params.data;

        const bodySchema = z.object({
          name: z.string().min(5).max(40).regex(/^[a-z0-9-]+$/).optional(),
          rules: z.array(z.any()).optional(),
          settings: z.record(z.any()).optional(),
        });

        const bodyParsed = bodySchema.safeParse(request.body);
        if (!bodyParsed.success) {
          return reply.status(400).send({
            success: false,
            error: { code: 'VALIDATION_ERROR', message: bodyParsed.error.errors[0].message },
            timestamp: new Date().toISOString(),
          });
        }

        const { name, rules, settings } = bodyParsed.data;

        const endpoint = await prisma.endpoint.findFirst({
          where: { id, userId: user.id, deletedAt: null },
        });

        if (!endpoint) throw new NotFoundError('Endpoint not found');

        const updateData: any = {};
        if (name !== undefined) updateData.name = name;
        if (rules !== undefined) updateData.rules = rules;
        if (settings !== undefined) updateData.settings = settings;

        const updated = await prisma.endpoint.update({
          where: { id },
          data: updateData,
        });

        // Invalidate caches
        await invalidateEndpointCache(id, endpoint.name);
        if (name && name !== endpoint.name) {
          await invalidateEndpointCache(id, name);
        }
        await invalidateUserEndpointCache(user.id);

        logger.info('Endpoint updated', { userId: user.id, endpointId: id });

        return reply.status(200).send({
          success: true,
          endpoint: formatEndpointResponse(updated),
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        span.recordException(error as Error);

        if (error instanceof NotFoundError) {
          return reply.status(404).send({
            success: false,
            error: { code: 'NOT_FOUND', message: error.message },
            timestamp: new Date().toISOString(),
          });
        }

        logger.error('Failed to update endpoint', { error });
        return reply.status(500).send({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Failed to update endpoint' },
          timestamp: new Date().toISOString(),
        });
      } finally {
        span.end();
      }
    });
  });

  /**
   * DELETE /api/v1/endpoints/:id
   */
  fastify.delete('/:id', async (request, reply) => {
    return tracer.startActiveSpan('delete-endpoint', async (span) => {
      try {
        const user = getAuthenticatedUser(request);
        const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
        if (!params.success) {
          return reply.status(400).send({
            success: false,
            error: { code: 'VALIDATION_ERROR', message: 'Invalid endpoint ID' },
            timestamp: new Date().toISOString(),
          });
        }
        const { id } = params.data;

        span.setAttribute('user.id', user.id);
        span.setAttribute('endpoint.id', id);

        const deleted = await prisma.endpoint.updateMany({
          where: { id, userId: user.id, deletedAt: null },
          data: { deletedAt: new Date() },
        });

        if (deleted.count === 0) {
          throw new NotFoundError('Endpoint not found or already deleted');
        }

        const endpoint = await prisma.endpoint.findUnique({
          where: { id },
          select: { name: true },
        });
        await invalidateUserEndpointCache(user.id);
        if (endpoint) {
          await invalidateEndpointCache(id, endpoint.name);
        }

        await publishEndpointEvent('deleted', user.id, { id });
        logger.info('Endpoint deleted', { userId: user.id, endpointId: id });

        return reply.status(200).send({
          success: true,
          deleted: true,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        span.recordException(error as Error);

        if (error instanceof NotFoundError) {
          return reply.status(404).send({
            success: false,
            error: { code: 'NOT_FOUND', message: error.message },
            timestamp: new Date().toISOString(),
          });
        }

        logger.error('Failed to delete endpoint', { error });
        return reply.status(500).send({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Failed to delete endpoint' },
          timestamp: new Date().toISOString(),
        });
      } finally {
        span.end();
      }
    });
  });

  /**
   * POST /api/v1/endpoints/:id/export
   */
  fastify.post('/:id/export', async (request, reply) => {
    try {
      const user = getAuthenticatedUser(request);
      const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
      if (!params.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Invalid endpoint ID' },
          timestamp: new Date().toISOString(),
        });
      }
      const { id } = params.data;

      const endpoint = await prisma.endpoint.findFirst({
        where: { id, userId: user.id, deletedAt: null },
      });
      if (!endpoint) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Endpoint not found' },
          timestamp: new Date().toISOString(),
        });
      }

      const exportData = {
        name: endpoint.name,
        rules: endpoint.rules,
        settings: endpoint.settings,
        version: '1.0',
        exportedAt: new Date().toISOString(),
      };

      return reply.status(200).send({
        success: true,
        export: exportData,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Failed to export endpoint', { error });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to export endpoint' },
        timestamp: new Date().toISOString(),
      });
    }
  });

  /**
   * POST /api/v1/endpoints/:id/import
   */
  fastify.post('/:id/import', async (request, reply) => {
    try {
      const user = getAuthenticatedUser(request);
      const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
      if (!params.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Invalid endpoint ID' },
          timestamp: new Date().toISOString(),
        });
      }
      const { id } = params.data;

      const bodySchema = z.object({
        rules: z.unknown().optional(),
        settings: z.unknown().optional(),
      });
      const bodyParsed = bodySchema.safeParse(request.body);
      if (!bodyParsed.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Invalid request body' },
          timestamp: new Date().toISOString(),
        });
      }
      const { rules, settings } = bodyParsed.data;

      const endpoint = await prisma.endpoint.findFirst({
        where: { id, userId: user.id, deletedAt: null },
      });
      if (!endpoint) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Endpoint not found' },
          timestamp: new Date().toISOString(),
        });
      }

      const updateData: { rules?: any; settings?: any } = {};
      if (rules !== undefined) updateData.rules = rules;
      if (settings !== undefined) updateData.settings = settings;

      await prisma.endpoint.update({
        where: { id },
        data: updateData,
      });

      await invalidateEndpointCache(id, endpoint.name);
      await invalidateUserEndpointCache(user.id);

      return reply.status(200).send({
        success: true,
        message: 'Endpoint configuration imported',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Failed to import endpoint', { error });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to import endpoint' },
        timestamp: new Date().toISOString(),
      });
    }
  });
};
