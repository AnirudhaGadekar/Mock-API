/**
 * Piece 4: Admin APIs – overview, issues, alerts (role: admin)
 */
import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../lib/db.js';
import { authenticateApiKey, getAuthenticatedUser } from '../middleware/auth.middleware.js';

export const adminRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', authenticateApiKey);

  const requireAdmin = async (request: any, reply: any) => {
    const user = getAuthenticatedUser(request);
    const isAdmin = process.env.ADMIN_USER_IDS?.split(',').includes(user.id) ?? false;
    if (!isAdmin) {
      return reply.status(403).send({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Admin role required' },
        timestamp: new Date().toISOString(),
      });
    }
  };

  fastify.addHook('preHandler', requireAdmin);

  /** GET /api/v1/admin/overview – fleet stats */
  fastify.get('/overview', async (request, reply) => {
    const [endpointCount, userCount, logsToday] = await Promise.all([
      prisma.endpoint.count({ where: { deletedAt: null } }),
      prisma.user.count(),
      prisma.requestLog.count({
        where: {
          timestamp: {
            gte: new Date(new Date().setHours(0, 0, 0, 0)),
          },
        },
      }),
    ]);

    const totalLogs = await prisma.requestLog.count();
    const errorLogs = await prisma.requestLog.count({
      where: { responseStatus: { gte: 500 } },
    });
    const errorRate = totalLogs > 0 ? (errorLogs / totalLogs) * 100 : 0;

    return reply.send({
      success: true,
      overview: {
        endpoints: endpointCount,
        users: userCount,
        requestsToday: logsToday,
        errorRate: Math.round(errorRate * 100) / 100,
        errorRateAbove5: errorRate > 5,
      },
      timestamp: new Date().toISOString(),
    });
  });

  /** GET /api/v1/admin/issues – silent fails (valid req → 5xx/timeout) */
  fastify.get<{ Querystring: { userId?: string; endpointId?: string } }>('/issues', async (request, reply) => {
    const { userId, endpointId } = request.query;
    const where: Record<string, unknown> = { responseStatus: { gte: 500 } };
    if (endpointId) where.endpointId = endpointId;

    const logs = await prisma.requestLog.findMany({
      where,
      take: 100,
      orderBy: { timestamp: 'desc' },
      include: { endpoint: { select: { id: true, name: true, userId: true } } },
    });

    let filtered = logs;
    if (userId) filtered = logs.filter((l) => l.endpoint.userId === userId);

    return reply.send({
      success: true,
      issues: filtered.map((l) => ({
        id: l.id,
        endpointId: l.endpointId,
        endpointName: l.endpoint.name,
        userId: l.endpoint.userId,
        method: l.method,
        path: l.path,
        responseStatus: l.responseStatus,
        timestamp: l.timestamp,
      })),
      timestamp: new Date().toISOString(),
    });
  });

  /** POST /api/v1/admin/alerts – webhook for issues (stub) */
  fastify.post<{ Body: { webhookUrl: string } }>('/alerts', async (request, reply) => {
    const { webhookUrl } = request.body || {};
    return reply.send({
      success: true,
      message: 'Alert webhook configured (stub)',
      webhookUrl: webhookUrl ?? null,
      timestamp: new Date().toISOString(),
    });
  });
};
