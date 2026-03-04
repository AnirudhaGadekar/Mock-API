/**
 * Piece 3: Request History APIs
 */
import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getEndpointSubscriberCount } from '../engine/websocket.js';
import { prisma } from '../lib/db.js';
import { authenticateApiKey, getAuthenticatedUser } from '../middleware/auth.middleware.js';

const RETENTION_DAYS = Math.max(1, Number(process.env.REQUEST_LOG_RETENTION_DAYS ?? 10));

const historyQuerySchema = z.object({
  search: z.string().max(200).optional(),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']).optional(),
  status: z.coerce.number().int().min(100).max(599).optional(),
  after: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const historyRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', authenticateApiKey);

  function getWorkspaceEndpointWhere(user: any, endpointId: string) {
    if (user.currentWorkspaceType === 'TEAM') {
      if (!user.currentTeamId) {
        return null;
      }
      return { id: endpointId, teamId: user.currentTeamId };
    }
    return { id: endpointId, userId: user.id };
  }

  fastify.get('/export/:endpointId', async (request, reply) => {
    const user = getAuthenticatedUser(request);
    const endpointId = (request.params as { endpointId: string }).endpointId;
    const query = request.query as { format?: string; after?: string };

    const endpointWhere = getWorkspaceEndpointWhere(user, endpointId);
    if (!endpointWhere) {
      return reply.status(400).send({
        success: false,
        error: { code: 'TEAM_CONTEXT_REQUIRED', message: 'Team workspace is active but no team is selected.' },
        timestamp: new Date().toISOString(),
      });
    }

    const endpoint = await prisma.endpoint.findFirst({
      where: endpointWhere,
    });
    if (!endpoint) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Endpoint not found' },
        timestamp: new Date().toISOString(),
      });
    }

    const where: Record<string, unknown> = { endpointId };
    if (query.after) where.createdAt = { gte: new Date(query.after) };

    const logs = await prisma.requestLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 1000,
    });

    reply.header('Content-Type', 'application/json');
    return reply.send(JSON.stringify(logs));
  });

  fastify.get('/:endpointId', async (request, reply) => {
    const user = getAuthenticatedUser(request);
    const endpointId = (request.params as { endpointId: string }).endpointId;
    const parsed = historyQuerySchema.safeParse(request.query);
    const q = parsed.success ? parsed.data : { limit: 50 };

    const endpointWhere = getWorkspaceEndpointWhere(user, endpointId);
    if (!endpointWhere) {
      return reply.status(400).send({
        success: false,
        error: { code: 'TEAM_CONTEXT_REQUIRED', message: 'Team workspace is active but no team is selected.' },
        timestamp: new Date().toISOString(),
      });
    }

    const endpoint = await prisma.endpoint.findFirst({
      where: endpointWhere,
    });
    if (!endpoint) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Endpoint not found' },
        timestamp: new Date().toISOString(),
      });
    }

    const where: Record<string, unknown> = { endpointId };
    if (q.after) where.createdAt = { gte: new Date(q.after) };
    if (q.method) where.method = q.method;
    if (q.status !== undefined) where.responseStatus = q.status;
    if (q.search) {
      where.OR = [
        { path: { contains: q.search, mode: 'insensitive' } },
        { body: { contains: q.search, mode: 'insensitive' } },
      ];
    }

    const [logs, total] = await Promise.all([
      prisma.requestLog.findMany({
        where,
        take: q.limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.requestLog.count({ where }),
    ]);

    const topPaths = await prisma.requestLog.groupBy({
      by: ['path'],
      where: { endpointId },
      _count: { path: true },
      orderBy: { _count: { path: 'desc' } },
      take: 10,
    });
    const topMethods = await prisma.requestLog.groupBy({
      by: ['method'],
      where: { endpointId },
      _count: { method: true },
    });
    const statusCounts = await prisma.requestLog.groupBy({
      by: ['responseStatus'],
      where: { endpointId },
      _count: { responseStatus: true },
    });

    const facets = {
      topPaths: topPaths.map((p) => ({ path: p.path, count: p._count.path })),
      topMethods: topMethods.map((m) => ({ method: m.method, count: m._count.method })),
      statusCounts: Object.fromEntries(statusCounts.map((s) => [String(s.responseStatus ?? 'null'), s._count.responseStatus])),
    };

    return reply.send({
      success: true,
      history: logs,
      facets,
      retentionDays: RETENTION_DAYS,
      totalCount: total,
      timestamp: new Date().toISOString(),
    });
  });

  fastify.get('/:endpointId/live-summary', async (request, reply) => {
    const user = getAuthenticatedUser(request);
    const endpointId = (request.params as { endpointId: string }).endpointId;

    const endpointWhere = getWorkspaceEndpointWhere(user, endpointId);
    if (!endpointWhere) {
      return reply.status(400).send({
        success: false,
        error: { code: 'TEAM_CONTEXT_REQUIRED', message: 'Team workspace is active but no team is selected.' },
        timestamp: new Date().toISOString(),
      });
    }

    const endpoint = await prisma.endpoint.findFirst({
      where: endpointWhere,
      select: { id: true },
    });

    if (!endpoint) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Endpoint not found' },
        timestamp: new Date().toISOString(),
      });
    }

    const now = new Date();
    const oneMinuteAgo = new Date(now.getTime() - 60 * 1000);
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);

    const [requestCount1m, requestCount5m, errorCount5m, latestRequest] = await Promise.all([
      prisma.requestLog.count({
        where: {
          endpointId,
          createdAt: { gte: oneMinuteAgo },
        },
      }),
      prisma.requestLog.count({
        where: {
          endpointId,
          createdAt: { gte: fiveMinutesAgo },
        },
      }),
      prisma.requestLog.count({
        where: {
          endpointId,
          createdAt: { gte: fiveMinutesAgo },
          responseStatus: { gte: 400 },
        },
      }),
      prisma.requestLog.findFirst({
        where: { endpointId },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
    ]);

    return reply.send({
      success: true,
      summary: {
        isActive: requestCount1m > 0 || requestCount5m > 0,
        requestCount1m,
        requestCount5m,
        errorCount5m,
        errorRate5m: requestCount5m > 0 ? Number(((errorCount5m / requestCount5m) * 100).toFixed(2)) : 0,
        lastSeenAt: latestRequest?.createdAt ?? null,
        websocketSubscribers: getEndpointSubscriberCount(endpointId),
      },
      timestamp: now.toISOString(),
    });
  });
};
