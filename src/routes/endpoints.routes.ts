import { trace } from '@opentelemetry/api';
import { FastifyPluginAsync } from 'fastify';
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
    listEndpointsQuerySchema,
    type CreateEndpointInput,
    type ListEndpointsQuery,
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
 */
export const endpointsRoutes: FastifyPluginAsync = async (fastify, opts) => {
  // Apply authentication to all routes
  fastify.addHook('preHandler', authenticateApiKey);

  /**
   * POST /api/v1/endpoints/create
   * Create new endpoint with unique name check and transaction
   */
  fastify.post<{ Body: CreateEndpointInput }>('/create', {
    schema: {
      body: createEndpointSchema,
      response: {
        201: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            endpoint: { type: 'object' },
            timestamp: { type: 'string' },
          },
        },
        409: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'object' },
            timestamp: { type: 'string' },
          },
        },
      },
    },
    handler: async (request, reply) => {
      return tracer.startActiveSpan('trace-endpoint-create', async (span) => {
        try {
          const user = getAuthenticatedUser(request);
          const { name, rules } = request.body;

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
          logger.info({ userId: user.id, endpointId: endpoint.id, name }, 'Endpoint created');

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
              error: {
                code: 'ENDPOINT_EXISTS',
                message: error.message,
              },
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

          logger.error({ error }, 'Failed to create endpoint');
          return reply.status(500).send({
            success: false,
            error: {
              code: 'INTERNAL_ERROR',
              message: 'Failed to create endpoint',
            },
            timestamp: new Date().toISOString(),
          });
        } finally {
          span.end();
        }
      });
    },
  });

  /**
   * GET /api/v1/endpoints
   * List endpoints with cursor-based pagination and caching
   */
  fastify.get<{ Querystring: ListEndpointsQuery }>('/', {
    schema: {
      querystring: listEndpointsQuerySchema,
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'object' },
            timestamp: { type: 'string' },
          },
        },
      },
    },
    handler: async (request, reply) => {
      return tracer.startActiveSpan('list-endpoints', async (span) => {
        try {
          const user = getAuthenticatedUser(request);
          const { limit, afterId, sort, search } = request.query;

          span.setAttribute('user.id', user.id);
          span.setAttribute('pagination.limit', limit);

          // Generate cache key from query params
          const queryHash = hashQueryParams(request.query);
          
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

          // Parse sort parameter
          const [sortField, sortOrder] = sort.split(':') as [string, 'asc' | 'desc'];

          // Build where clause
          const where: Record<string, unknown> = {
            userId: user.id,
            deletedAt: null,
          };

          if (search) {
            where.name = { contains: search, mode: 'insensitive' as const };
          }

          // Cursor-based pagination: afterId is the last id from previous page
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

          // Get total count (optimized with separate query)
          const totalCount = await prisma.endpoint.count({ where });

          // Determine pagination
          const hasMore = endpoints.length > limit;
          const resultEndpoints = hasMore ? endpoints.slice(0, limit) : endpoints;
          const nextCursor = hasMore ? resultEndpoints[resultEndpoints.length - 1].id : null;

          // Format response
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
          logger.error({ error }, 'Failed to list endpoints');

          return reply.status(500).send({
            success: false,
            error: {
              code: 'INTERNAL_ERROR',
              message: 'Failed to list endpoints',
            },
            timestamp: new Date().toISOString(),
          });
        } finally {
          span.end();
        }
      });
    },
  });

  /**
   * GET /api/v1/endpoints/:id
   * Get single endpoint with stats (owner-only)
   */
  fastify.get<{ Params: { id: string } }>('/:id', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
    },
    handler: async (request, reply) => {
      return tracer.startActiveSpan('get-endpoint', async (span) => {
        try {
          const user = getAuthenticatedUser(request);
          const { id } = request.params;

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
          const responseData = {
            ...formatEndpointResponse(endpoint),
            stats,
          };
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
              error: {
                code: 'NOT_FOUND',
                message: error.message,
              },
              timestamp: new Date().toISOString(),
            });
          }

          logger.error({ error }, 'Failed to get endpoint');
          return reply.status(500).send({
            success: false,
            error: {
              code: 'INTERNAL_ERROR',
              message: 'Failed to get endpoint',
            },
            timestamp: new Date().toISOString(),
          });
        } finally {
          span.end();
        }
      });
    },
  });

  /**
   * DELETE /api/v1/endpoints/:id
   * Soft-delete endpoint and invalidate cache
   */
  fastify.delete<{ Params: { id: string } }>('/:id', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
    },
    handler: async (request, reply) => {
      return tracer.startActiveSpan('delete-endpoint', async (span) => {
        try {
          const user = getAuthenticatedUser(request);
          const { id } = request.params;

          span.setAttribute('user.id', user.id);
          span.setAttribute('endpoint.id', id);

          // Soft-delete with owner check
          const deleted = await prisma.endpoint.updateMany({
            where: {
              id,
              userId: user.id, // Owner-only
              deletedAt: null,
            },
            data: {
              deletedAt: new Date(),
            },
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
            await invalidateEndpointCache(id, endpoint.name, user.id);
          }

          // Publish event
          await publishEndpointEvent('deleted', user.id, { id });

          logger.info({ userId: user.id, endpointId: id }, 'Endpoint deleted');

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
              error: {
                code: 'NOT_FOUND',
                message: error.message,
              },
              timestamp: new Date().toISOString(),
            });
          }

          logger.error({ error }, 'Failed to delete endpoint');
          return reply.status(500).send({
            success: false,
            error: {
              code: 'INTERNAL_ERROR',
              message: 'Failed to delete endpoint',
            },
            timestamp: new Date().toISOString(),
          });
        } finally {
          span.end();
        }
      });
    },
  });

  /**
   * POST /api/v1/endpoints/:id/export
   * Export endpoint configuration
   */
  fastify.post<{ Params: { id: string } }>('/:id/export', async (request, reply) => {
    try {
      const user = getAuthenticatedUser(request);
      const { id } = request.params;

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
      logger.error({ error }, 'Failed to export endpoint');
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to export endpoint' },
        timestamp: new Date().toISOString(),
      });
    }
  });

  /**
   * POST /api/v1/endpoints/:id/import
   * Import endpoint configuration
   */
  fastify.post<{ Params: { id: string }; Body: { rules?: unknown; settings?: unknown } }>(
    '/:id/import',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            rules: { type: 'array' },
            settings: { type: 'object' },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const user = getAuthenticatedUser(request);
        const { id } = request.params;
        const { rules, settings } = request.body;

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

        const updateData: { rules?: unknown; settings?: unknown } = {};
        if (rules !== undefined) updateData.rules = rules;
        if (settings !== undefined) updateData.settings = settings;

        await prisma.endpoint.update({
          where: { id },
          data: updateData,
        });

        await invalidateEndpointCache(id, endpoint.name, user.id);
        await invalidateUserEndpointCache(user.id);

        return reply.status(200).send({
          success: true,
          message: 'Endpoint configuration imported',
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error({ error }, 'Failed to import endpoint');
        return reply.status(500).send({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Failed to import endpoint' },
          timestamp: new Date().toISOString(),
        });
      }
    }
  );
};
