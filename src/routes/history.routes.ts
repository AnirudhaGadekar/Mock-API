/**
 * Piece 3: Request History APIs
 */
import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { authenticateApiKey, getAuthenticatedUser } from '../middleware/auth.middleware.js';

const RETENTION_DAYS = 10;

const historyQuerySchema = z.object({
  search: z.string().max(200).optional(),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']).optional(),
  status: z.coerce.number().int().min(100).max(599).optional(),
  after: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const historyRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', authenticateApiKey);

  fastify.get('/export/:endpointId', async (request, reply) => {
    const user = getAuthenticatedUser(request);
    const endpointId = (request.params as { endpointId: string }).endpointId;
    const query = request.query as { format?: string; after?: string };

    const endpoint = await prisma.endpoint.findFirst({
      where: { id: endpointId, userId: user.id, deletedAt: null },
    });
    if (!endpoint) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Endpoint not found' },
        timestamp: new Date().toISOString(),
      });
    }

    const where: Record<string, unknown> = { endpointId };
    if (query.after) where.timestamp = { gte: new Date(query.after) };

    const logs = await prisma.requestLog.findMany({
      where,
      orderBy: { timestamp: 'desc' },
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

    const endpoint = await prisma.endpoint.findFirst({
      where: { id: endpointId, userId: user.id, deletedAt: null },
    });
    if (!endpoint) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Endpoint not found' },
        timestamp: new Date().toISOString(),
      });
    }

    const where: Record<string, unknown> = { endpointId };
    if (q.after) where.timestamp = { gte: new Date(q.after) };
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
        orderBy: { timestamp: 'desc' },
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
};
