import { trace } from '@opentelemetry/api';
import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { authenticateApiKey, getAuthenticatedUser } from '../middleware/auth.middleware.js';
import { checkRateLimit } from '../middleware/rate-limit.middleware.js';
import {
  cacheEndpointList,
  getCachedEndpointList,
  hashQueryParams,
  invalidateUserEndpointCache
} from '../utils/endpoint.cache.js';
import {
  createEndpointSchema,
  DEFAULT_MOCK_RULES,
  listEndpointsQuerySchema
} from '../validators/endpoint.validator.js';

const tracer = trace.getTracer('endpoints-api');

const BASE_MOCK_DOMAIN = process.env.BASE_MOCK_DOMAIN || 'mockurl.com';

/**
 * Format endpoint for API response
 */
function formatEndpointResponse(endpoint: any) {
  const subdomain = endpoint.slug;
  let url = `https://${subdomain}.${BASE_MOCK_DOMAIN}`;

  if (process.env.RENDER_EXTERNAL_URL && BASE_MOCK_DOMAIN === 'mockurl.com') {
    url = `${process.env.RENDER_EXTERNAL_URL}/${subdomain}`;
  }

  return {
    id: endpoint.id,
    name: endpoint.name,
    subdomain,
    url,
    dashboardUrl: `/console/${subdomain}`,
    rules: Array.isArray(endpoint.rules) ? endpoint.rules : [],
    reqCount: endpoint.requestCount ?? 0,
    createdAt: endpoint.createdAt,
    workspaceType: endpoint.teamId ? 'TEAM' : 'PERSONAL',
    teamId: endpoint.teamId,
  };
}

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
        const isTeam = user.currentWorkspaceType === 'TEAM';
        const teamId = user.currentTeamId;

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
            },
            timestamp: new Date().toISOString(),
          });
        }

        const endpoint = await prisma.$transaction(async (tx) => {
          // Check limits per workspace
          const count = await tx.endpoint.count({
            where: isTeam ? { teamId } : { userId: user.id }
          });

          if (count >= 20) {
            throw new Error('Endpoint limit reached (20 max per workspace)');
          }

          const existing = await tx.endpoint.findUnique({
            where: { slug: name },
          });
          if (existing) {
            throw new Error(`Subdomain "${name}" is already taken`);
          }

          return tx.endpoint.create({
            data: {
              name,
              slug: name,
              userId: isTeam ? null : user.id,
              teamId: isTeam ? teamId : null,
              rules: rules && rules.length > 0 ? (rules as object[]) : DEFAULT_MOCK_RULES,
              requestCount: 0,
              lastActiveAt: new Date(),
            },
          });
        });

        await invalidateUserEndpointCache(user.id);

        const endpointPayload = formatEndpointResponse(endpoint);
        logger.info('Endpoint created', { userId: user.id, endpointId: endpoint.id, name, workspace: isTeam ? 'TEAM' : 'PERSONAL' });

        return reply.status(201).send({
          success: true,
          endpoint: endpointPayload,
          timestamp: new Date().toISOString(),
        });
      } catch (error: any) {
        span.recordException(error);
        return reply.status(error.message.includes('taken') ? 409 : 400).send({
          success: false,
          error: { code: 'CREATE_FAILED', message: error.message },
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
        const isTeam = user.currentWorkspaceType === 'TEAM';
        const teamId = user.currentTeamId;

        const parsed = listEndpointsQuerySchema.safeParse(request.query);
        const { limit, afterId, sort, search } = parsed.success ? parsed.data : { limit: 20, sort: 'createdAt:desc' } as any;

        const queryHash = hashQueryParams(request.query as any);
        const cached = await getCachedEndpointList(user.id, queryHash);
        if (cached) return reply.status(200).send({ success: true, ...cached, timestamp: new Date().toISOString() });

        const [sortField, sortOrder] = sort.split(':') as [string, 'asc' | 'desc'];

        const where: any = {
          ...(isTeam ? { teamId } : { userId: user.id }),
        };

        if (search) {
          where.name = { contains: search, mode: 'insensitive' };
        }

        const endpoints = await prisma.endpoint.findMany({
          where,
          take: limit + 1,
          ...(afterId && { cursor: { id: afterId }, skip: 1 }),
          orderBy: { [sortField]: sortOrder },
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

        return reply.status(200).send({
          success: true,
          ...responseData,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
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
    try {
      const user = getAuthenticatedUser(request);
      const { id } = request.params as any;

      const endpoint = await prisma.endpoint.findFirst({
        where: {
          id,
          OR: [
            { userId: user.id },
            { teamId: user.currentTeamId }
          ]
        },
      });

      if (!endpoint) return reply.status(404).send({ error: 'Endpoint not found' });

      return {
        success: true,
        endpoint: formatEndpointResponse(endpoint),
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return reply.status(500).send({ error: 'Failed to get endpoint' });
    }
  });

  /**
   * DELETE /api/v1/endpoints/:id
   */
  fastify.delete('/:id', async (request, reply) => {
    try {
      const user = getAuthenticatedUser(request);
      const { id } = request.params as any;

      await prisma.endpoint.deleteMany({
        where: {
          id,
          OR: [
            { userId: user.id },
            { teamId: user.currentTeamId }
          ]
        }
      });

      await invalidateUserEndpointCache(user.id);
      return { success: true };
    } catch (error) {
      return reply.status(500).send({ error: 'Failed to delete endpoint' });
    }
  });
};
