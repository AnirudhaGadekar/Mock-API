import { trace } from '@opentelemetry/api';
import { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { prisma } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { authenticateApiKey, getAuthenticatedUser } from '../middleware/auth.middleware.js';
import { checkRateLimit } from '../middleware/rate-limit.middleware.js';
import type { EndpointResponse } from '../types/mock.types.js';
import {
    cacheEndpointList,
    getCachedEndpointList,
    hashQueryParams,
    invalidateEndpointCache,
    invalidateUserEndpointCache
} from '../utils/endpoint.cache.js';
import {
    createEndpointSchema,
    DEFAULT_MOCK_RULES,
    listEndpointsQuerySchema
} from '../validators/endpoint.validator.js';

const tracer = trace.getTracer('endpoints-api');

type EndpointAuditAction = 'CREATED' | 'UPDATED' | 'DELETED';
type EndpointWorkspaceType = 'PERSONAL' | 'TEAM';

interface EndpointAuditLogInput {
  action: EndpointAuditAction;
  actorUserId: string;
  endpointId?: string | null;
  endpointSlug?: string | null;
  endpointName?: string | null;
  workspaceType: EndpointWorkspaceType;
  teamId?: string | null;
  details?: unknown;
  request: FastifyRequest;
}

function getFirstHeaderValue(value: string | string[] | undefined): string | undefined {
  if (!value) return undefined;
  const raw = Array.isArray(value) ? value[0] : value;
  const first = raw.split(',')[0]?.trim();
  return first || undefined;
}

function isLocalhostHost(hostOrUrl: string | undefined): boolean {
  if (!hostOrUrl) return false;

  let candidate = hostOrUrl.trim();
  if (!candidate) return false;

  if (!candidate.includes('://')) {
    candidate = `http://${candidate}`;
  }

  try {
    const parsed = new URL(candidate);
    const host = parsed.hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}

function normalizeEndpointBaseUrl(base: string): string {
  const trimmed = base.trim().replace(/\/+$/, '');
  return trimmed.endsWith('/e') ? trimmed : `${trimmed}/e`;
}

/**
 * Format endpoint for API response
 */
function formatEndpointResponse(endpoint: { id: string; name: string; slug: string; rules: unknown; requestCount: number; createdAt: Date; teamId?: string | null }, request?: FastifyRequest): EndpointResponse {
  const subdomain = endpoint.slug;
  const isProductionLike =
    process.env.NODE_ENV === 'production' ||
    process.env.RENDER === 'true' ||
    Boolean(process.env.RENDER_EXTERNAL_URL);
  const configuredBase = process.env.BASE_ENDPOINT_URL?.trim();
  const renderExternalUrl = process.env.RENDER_EXTERNAL_URL?.trim();
  const forwardedHost = request ? getFirstHeaderValue(request.headers['x-forwarded-host'] as string | string[] | undefined) : undefined;
  const requestHost = request ? getFirstHeaderValue(request.headers.host) : undefined;
  const effectiveHost = forwardedHost || requestHost;
  const forwardedProto = request ? getFirstHeaderValue(request.headers['x-forwarded-proto'] as string | string[] | undefined) : undefined;
  const protocol = forwardedProto || (isProductionLike ? 'https' : 'http');

  // Auto-detect base URL from env/proxy headers with production safety guards.
  let baseUrl: string;
  if (configuredBase && !(isProductionLike && isLocalhostHost(configuredBase))) {
    baseUrl = normalizeEndpointBaseUrl(configuredBase);
  } else if (effectiveHost && !(isProductionLike && isLocalhostHost(effectiveHost))) {
    baseUrl = normalizeEndpointBaseUrl(`${protocol}://${effectiveHost}`);
  } else if (renderExternalUrl && !(isProductionLike && isLocalhostHost(renderExternalUrl))) {
    baseUrl = normalizeEndpointBaseUrl(renderExternalUrl);
  } else if (isProductionLike) {
    baseUrl = 'https://mock-url-9rwn.onrender.com/e';
  } else {
    baseUrl = 'http://localhost:3000/e';
  }

  let url = `${baseUrl}/${subdomain}`;

  // If using a custom mock domain with wildcard support (not current case but kept for logic)
  if (process.env.BASE_MOCK_DOMAIN && !process.env.BASE_MOCK_DOMAIN.includes('onrender.com')) {
    url = `https://${subdomain}.${process.env.BASE_MOCK_DOMAIN}`;
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

function getUserAgent(request: FastifyRequest): string | null {
  const userAgent = request.headers['user-agent'];
  if (!userAgent) return null;
  return Array.isArray(userAgent) ? userAgent[0] : userAgent;
}

function getRulesCount(rules: unknown): number {
  return Array.isArray(rules) ? rules.length : 0;
}

async function writeEndpointAuditLog(input: EndpointAuditLogInput): Promise<void> {
  try {
    await prisma.endpointAuditLog.create({
      data: {
        action: input.action,
        actorUserId: input.actorUserId,
        endpointId: input.endpointId ?? null,
        endpointSlug: input.endpointSlug ?? null,
        endpointName: input.endpointName ?? null,
        workspaceType: input.workspaceType,
        teamId: input.teamId ?? null,
        ip: input.request.ip ?? null,
        userAgent: getUserAgent(input.request),
        details: input.details as any,
      },
    });
  } catch (error) {
    logger.warn('Failed to write endpoint audit log', {
      error,
      action: input.action,
      endpointId: input.endpointId ?? null,
      actorUserId: input.actorUserId,
    });
  }
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
        await invalidateEndpointCache(endpoint.id, endpoint.slug).catch((err) => {
          logger.warn('Failed to invalidate endpoint cache after create', { err, endpointId: endpoint.id });
        });
        await writeEndpointAuditLog({
          action: 'CREATED',
          actorUserId: user.id,
          endpointId: endpoint.id,
          endpointSlug: endpoint.slug,
          endpointName: endpoint.name,
          workspaceType: isTeam ? 'TEAM' : 'PERSONAL',
          teamId: endpoint.teamId,
          request,
          details: {
            changedFields: ['name', 'slug', 'rules'],
            rulesCount: getRulesCount(endpoint.rules),
            hasSettings: endpoint.settings !== undefined && endpoint.settings !== null,
          },
        });

        const endpointPayload = formatEndpointResponse(endpoint, request);
        logger.info('Endpoint created', { userId: user.id, endpointId: endpoint.id, name, workspace: isTeam ? 'TEAM' : 'PERSONAL' });

        return reply.status(201).send({
          success: true,
          endpoint: endpointPayload,
          timestamp: new Date().toISOString(),
        });
      } catch (error: unknown) {
        span.recordException(error as Error);
        const message = error instanceof Error ? error.message : 'Unknown error';
        return reply.status(message.includes('taken') ? 409 : 400).send({
          success: false,
          error: { code: 'CREATE_FAILED', message },
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
        const { limit, afterId, sort, search } = parsed.success ? parsed.data : { limit: 20, sort: 'createdAt:desc' as const };

        const queryHash = hashQueryParams(request.query as Record<string, unknown>);
        const cached = await getCachedEndpointList(user.id, queryHash);
        if (cached) return reply.status(200).send({ success: true, ...cached, timestamp: new Date().toISOString() });

        const [sortField, sortOrder] = sort.split(':') as [string, 'asc' | 'desc'];

        const where: { teamId?: string; userId?: string; name?: { contains: string; mode: 'insensitive' } } = {
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
        const formattedEndpoints = resultEndpoints.map((ep) => formatEndpointResponse(ep, request));

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
   * PATCH /api/v1/endpoints/:id
   * Note: Defined before GET /:id to ensure proper route matching
   */
  fastify.patch('/:id', async (request, reply) => {
    return tracer.startActiveSpan('update-endpoint', async (span) => {
      try {
        const user = getAuthenticatedUser(request);
        const { id } = request.params as { id: string };
        const body = request.body as { name?: string; rules?: unknown[]; settings?: unknown };

        // Verify ownership
        const existing = await prisma.endpoint.findFirst({
          where: {
            id,
            OR: [
              { userId: user.id },
              { teamId: user.currentTeamId }
            ]
          },
        });

        if (!existing) {
          return reply.status(404).send({
            success: false,
            error: { code: 'NOT_FOUND', message: 'Endpoint not found' },
            timestamp: new Date().toISOString(),
          });
        }

        // Validate that at least one field is being updated
        if (body.rules === undefined && body.settings === undefined && body.name === undefined) {
          return reply.status(400).send({
            success: false,
            error: { code: 'VALIDATION_ERROR', message: 'At least one field (rules, settings, or name) must be provided' },
            timestamp: new Date().toISOString(),
          });
        }

        // Update endpoint
        const updateData: any = {};
        if (body.rules !== undefined) {
          // Validate rules is an array
          if (!Array.isArray(body.rules)) {
            return reply.status(400).send({
              success: false,
              error: { code: 'VALIDATION_ERROR', message: 'Rules must be an array' },
              timestamp: new Date().toISOString(),
            });
          }
          updateData.rules = body.rules;
        }
        if (body.settings !== undefined) {
          updateData.settings = body.settings;
        }
        if (body.name !== undefined) {
          // Validate name format
          if (typeof body.name !== 'string' || body.name.length < 5 || body.name.length > 40 || !/^[a-z0-9-]+$/.test(body.name)) {
            return reply.status(400).send({
              success: false,
              error: { code: 'VALIDATION_ERROR', message: 'Name must be 5-40 characters, lowercase alphanumeric and hyphens only' },
              timestamp: new Date().toISOString(),
            });
          }
          // Check if new name/slug is available
          const slugTaken = await prisma.endpoint.findUnique({
            where: { slug: body.name },
          });
          if (slugTaken && slugTaken.id !== id) {
            return reply.status(409).send({
              success: false,
              error: { code: 'SLUG_TAKEN', message: `Subdomain "${body.name}" is already taken` },
              timestamp: new Date().toISOString(),
            });
          }
          updateData.name = body.name;
          updateData.slug = body.name;
        }

        // Ensure updateData is not empty (shouldn't happen due to check above, but defensive)
        if (Object.keys(updateData).length === 0) {
          return reply.status(400).send({
            success: false,
            error: { code: 'VALIDATION_ERROR', message: 'No valid fields to update' },
            timestamp: new Date().toISOString(),
          });
        }

        const updated = await prisma.endpoint.update({
          where: { id },
          data: updateData,
        });

        // Invalidate caches
        await invalidateUserEndpointCache(user.id);
        await invalidateEndpointCache(id, updated.slug).catch((err) => {
          logger.warn('Failed to invalidate endpoint cache after update', { err, endpointId: id });
        });
        await writeEndpointAuditLog({
          action: 'UPDATED',
          actorUserId: user.id,
          endpointId: updated.id,
          endpointSlug: updated.slug,
          endpointName: updated.name,
          workspaceType: updated.teamId ? 'TEAM' : 'PERSONAL',
          teamId: updated.teamId,
          request,
          details: {
            changedFields: Object.keys(updateData),
            before: {
              name: existing.name,
              slug: existing.slug,
              rulesCount: getRulesCount(existing.rules),
              hasSettings: existing.settings !== undefined && existing.settings !== null,
            },
            after: {
              name: updated.name,
              slug: updated.slug,
              rulesCount: getRulesCount(updated.rules),
              hasSettings: updated.settings !== undefined && updated.settings !== null,
            },
          },
        });

        return reply.status(200).send({
          success: true,
          endpoint: formatEndpointResponse(updated, request),
          timestamp: new Date().toISOString(),
        });
      } catch (error: unknown) {
        span.recordException(error as Error);
        const params = request.params as { id: string };
        logger.error('Failed to update endpoint', { error, endpointId: params.id });
        const message = error instanceof Error ? error.message : 'Failed to update endpoint';
        return reply.status(500).send({
          success: false,
          error: { code: 'UPDATE_FAILED', message },
          timestamp: new Date().toISOString(),
        });
      } finally {
        span.end();
      }
    });
  });

  /**
   * GET /api/v1/endpoints/audit
   * Returns recent endpoint configuration changes in current workspace.
   */
  fastify.get('/audit', async (request, reply) => {
    try {
      const user = getAuthenticatedUser(request);
      const isTeamWorkspace = user.currentWorkspaceType === 'TEAM';
      const query = request.query as { limit?: string; endpointId?: string };
      const requestedLimit = Number.parseInt(query.limit ?? '50', 10);
      const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 200) : 50;

      if (isTeamWorkspace && !user.currentTeamId) {
        return reply.status(400).send({
          success: false,
          error: { code: 'TEAM_CONTEXT_REQUIRED', message: 'Team workspace is active but no team is selected.' },
          timestamp: new Date().toISOString(),
        });
      }

      const where: {
        workspaceType: EndpointWorkspaceType;
        teamId?: string;
        actorUserId?: string;
        endpointId?: string;
      } = isTeamWorkspace
        ? { workspaceType: 'TEAM', teamId: user.currentTeamId as string }
        : { workspaceType: 'PERSONAL', actorUserId: user.id };

      if (query.endpointId) {
        where.endpointId = query.endpointId;
      }

      const auditLogs = await prisma.endpointAuditLog.findMany({
        where,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          action: true,
          endpointId: true,
          endpointSlug: true,
          endpointName: true,
          workspaceType: true,
          teamId: true,
          ip: true,
          userAgent: true,
          details: true,
          createdAt: true,
          actorUser: {
            select: {
              id: true,
              email: true,
              name: true,
            },
          },
        },
      });

      return reply.status(200).send({
        success: true,
        auditLogs,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Failed to fetch endpoint audit logs', { error });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch endpoint audit logs' },
        timestamp: new Date().toISOString(),
      });
    }
  });

  /**
   * GET /api/v1/endpoints/:id
   */
  fastify.get('/:id', async (request, reply) => {
    try {
      const user = getAuthenticatedUser(request);
      const { id } = request.params as { id: string };

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
        endpoint: formatEndpointResponse(endpoint, request),
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
      const { id } = request.params as { id: string };

      // Get endpoint before deletion to invalidate subdomain cache
      const endpoint = await prisma.endpoint.findFirst({
        where: {
          id,
          OR: [
            { userId: user.id },
            { teamId: user.currentTeamId }
          ]
        },
        select: {
          id: true,
          name: true,
          slug: true,
          teamId: true,
          rules: true,
          settings: true,
        },
      });

      const deleted = await prisma.endpoint.deleteMany({
        where: {
          id,
          OR: [
            { userId: user.id },
            { teamId: user.currentTeamId }
          ]
        }
      });

      if (deleted.count === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Endpoint not found' },
          timestamp: new Date().toISOString(),
        });
      }

      await invalidateUserEndpointCache(user.id);
      // Invalidate subdomain cache when endpoint is deleted
      if (endpoint?.slug) {
        await invalidateEndpointCache(id, endpoint.slug).catch((err) => {
          logger.warn('Failed to invalidate endpoint cache after delete', { err, endpointId: id });
        });
      }
      await writeEndpointAuditLog({
        action: 'DELETED',
        actorUserId: user.id,
        endpointId: endpoint?.id ?? id,
        endpointSlug: endpoint?.slug ?? null,
        endpointName: endpoint?.name ?? null,
        workspaceType: user.currentWorkspaceType === 'TEAM' ? 'TEAM' : 'PERSONAL',
        teamId: user.currentWorkspaceType === 'TEAM' ? user.currentTeamId : null,
        request,
        details: {
          changedFields: ['deleted'],
          rulesCount: getRulesCount(endpoint?.rules),
          hadSettings: endpoint?.settings !== undefined && endpoint?.settings !== null,
        },
      });
      return { success: true };
    } catch (error) {
      return reply.status(500).send({ error: 'Failed to delete endpoint' });
    }
  });
};
