/**
 * Admin API routes — full monitoring dashboard backend.
 *
 * Auth: X-Admin-Secret header must match ADMIN_SECRET env variable.
 * This is separate from user API keys.
 *
 * Endpoints:
 *   GET /api/v1/admin/overview    → system stats
 *   GET /api/v1/admin/users       → all users with endpoint counts
 *   GET /api/v1/admin/endpoints   → all endpoints across users
 *   GET /api/v1/admin/logs        → request logs with full request/response
 *   GET /api/v1/admin/errors      → only error logs (4xx + 5xx)
 */
import { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../lib/db.js';
import { logger } from '../lib/logger.js';

const ADMIN_SECRET = process.env.ADMIN_SECRET || '';

/**
 * Admin auth: check X-Admin-Secret header.
 */
async function requireAdminSecret(request: FastifyRequest, reply: FastifyReply) {
  const secret = request.headers['x-admin-secret'] as string | undefined;
  if (!ADMIN_SECRET || secret !== ADMIN_SECRET) {
    return reply.status(403).send({
      success: false,
      error: { code: 'FORBIDDEN', message: 'Invalid admin secret' },
      timestamp: new Date().toISOString(),
    });
  }
}

export const adminRoutes: FastifyPluginAsync = async (fastify) => {
  // All admin routes require the admin secret
  fastify.addHook('preHandler', requireAdminSecret);

  // ─── GET /overview ────────────────────────────────────────────────────────
  fastify.get('/overview', async (_request, reply) => {
    try {
      const [endpointCount, userCount, logsToday, totalLogs, errorLogs] = await Promise.all([
        prisma.endpoint.count({ where: { deletedAt: null } }),
        prisma.user.count(),
        prisma.requestLog.count({
          where: { timestamp: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } },
        }),
        prisma.requestLog.count(),
        prisma.requestLog.count({ where: { responseStatus: { gte: 400 } } }),
      ]);

      const errorRate = totalLogs > 0 ? (errorLogs / totalLogs) * 100 : 0;

      return reply.send({
        success: true,
        overview: {
          endpoints: endpointCount,
          users: userCount,
          requestsToday: logsToday,
          totalRequests: totalLogs,
          errorCount: errorLogs,
          errorRate: Math.round(errorRate * 100) / 100,
          errorRateAbove5: errorRate > 5,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error(`Admin overview failed: ${(error as Error).message}`);
      return reply.status(500).send({ success: false, error: { code: 'INTERNAL', message: 'Failed to load overview' } });
    }
  });

  // ─── GET /users ───────────────────────────────────────────────────────────
  fastify.get<{ Querystring: { limit?: string; offset?: string } }>(
    '/users',
    async (request, reply) => {
      try {
        const limit = Math.min(parseInt(request.query.limit || '50'), 200);
        const offset = parseInt(request.query.offset || '0');

        const [users, total] = await Promise.all([
          prisma.user.findMany({
            take: limit,
            skip: offset,
            orderBy: { email: 'asc' },
            select: {
              id: true,
              email: true,
              apiKeyHash: true,
              _count: { select: { endpoints: true } },
            },
          }),
          prisma.user.count(),
        ]);

        return reply.send({
          success: true,
          users: users.map((u) => ({
            id: u.id,
            email: u.email,
            apiKey: '********' + u.apiKeyHash.slice(-4), // Show only last 4 chars of HASH
            endpointCount: u._count.endpoints,
          })),
          total,
          limit,
          offset,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error('Failed to load users', { error });
        return reply.status(500).send({ success: false, error: { code: 'INTERNAL', message: 'Failed to load users' } });
      }
    },
  );

  // ─── GET /endpoints ───────────────────────────────────────────────────────
  fastify.get<{ Querystring: { limit?: string; offset?: string; userId?: string } }>(
    '/endpoints',
    async (request, reply) => {
      try {
        const limit = Math.min(parseInt(request.query.limit || '50'), 200);
        const offset = parseInt(request.query.offset || '0');
        const where: Record<string, unknown> = { deletedAt: null };
        if (request.query.userId) where.userId = request.query.userId;

        const [endpoints, total] = await Promise.all([
          prisma.endpoint.findMany({
            where,
            take: limit,
            skip: offset,
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              name: true,
              userId: true,
              requestCount: true,
              createdAt: true,
              user: { select: { email: true } },
            },
          }),
          prisma.endpoint.count({ where }),
        ]);

        return reply.send({
          success: true,
          endpoints: endpoints.map((ep) => ({
            id: ep.id,
            name: ep.name,
            userId: ep.userId,
            userEmail: ep.user.email,
            requestCount: ep.requestCount,
            createdAt: ep.createdAt,
          })),
          total,
          limit,
          offset,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error(`Admin endpoints failed: ${(error as Error).message}`);
        return reply.status(500).send({ success: false, error: { code: 'INTERNAL', message: 'Failed to load endpoints' } });
      }
    },
  );

  // ─── GET /logs ────────────────────────────────────────────────────────────
  fastify.get<{
    Querystring: {
      limit?: string;
      offset?: string;
      endpointId?: string;
      method?: string;
      status?: string;
      search?: string;
    };
  }>('/logs', async (request, reply) => {
    try {
      const limit = Math.min(parseInt(request.query.limit || '50'), 200);
      const offset = parseInt(request.query.offset || '0');

      const where: Record<string, unknown> = {};
      if (request.query.endpointId) where.endpointId = request.query.endpointId;
      if (request.query.method) where.method = request.query.method.toUpperCase();
      if (request.query.status) {
        const s = parseInt(request.query.status);
        if (s >= 100 && s < 200) where.responseStatus = { gte: 100, lt: 200 };
        else if (s >= 200 && s < 300) where.responseStatus = { gte: 200, lt: 300 };
        else if (s >= 300 && s < 400) where.responseStatus = { gte: 300, lt: 400 };
        else if (s >= 400 && s < 500) where.responseStatus = { gte: 400, lt: 500 };
        else if (s >= 500) where.responseStatus = { gte: 500 };
      }
      if (request.query.search) {
        where.path = { contains: request.query.search, mode: 'insensitive' };
      }

      const [logs, total] = await Promise.all([
        prisma.requestLog.findMany({
          where,
          take: limit,
          skip: offset,
          orderBy: { timestamp: 'desc' },
          include: {
            endpoint: { select: { name: true, userId: true, user: { select: { email: true } } } },
          },
        }),
        prisma.requestLog.count({ where }),
      ]);

      return reply.send({
        success: true,
        logs: logs.map((l) => ({
          id: l.id,
          endpointId: l.endpointId,
          endpointName: l.endpoint.name,
          userEmail: l.endpoint.user.email,
          timestamp: l.timestamp,
          method: l.method,
          path: l.path,
          query: l.query,
          headers: l.headers,
          body: l.body,
          ip: l.ip,
          userAgent: l.userAgent,
          responseStatus: l.responseStatus,
          responseHeaders: l.responseHeaders,
          responseBody: l.responseBody,
          latencyMs: l.latencyMs,
        })),
        total,
        limit,
        offset,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error(`Admin logs failed: ${(error as Error).message}`);
      return reply.status(500).send({ success: false, error: { code: 'INTERNAL', message: 'Failed to load logs' } });
    }
  });

  // ─── GET /errors ──────────────────────────────────────────────────────────
  fastify.get<{ Querystring: { limit?: string; offset?: string } }>(
    '/errors',
    async (request, reply) => {
      try {
        const limit = Math.min(parseInt(request.query.limit || '50'), 200);
        const offset = parseInt(request.query.offset || '0');

        const where = { responseStatus: { gte: 400 } };

        const [logs, total] = await Promise.all([
          prisma.requestLog.findMany({
            where,
            take: limit,
            skip: offset,
            orderBy: { timestamp: 'desc' },
            include: {
              endpoint: { select: { name: true, userId: true, user: { select: { email: true } } } },
            },
          }),
          prisma.requestLog.count({ where }),
        ]);

        return reply.send({
          success: true,
          errors: logs.map((l) => ({
            id: l.id,
            endpointId: l.endpointId,
            endpointName: l.endpoint.name,
            userEmail: l.endpoint.user.email,
            timestamp: l.timestamp,
            method: l.method,
            path: l.path,
            body: l.body,
            responseStatus: l.responseStatus,
            responseBody: l.responseBody,
            latencyMs: l.latencyMs,
          })),
          total,
          limit,
          offset,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error(`Admin errors failed: ${(error as Error).message}`);
        return reply.status(500).send({ success: false, error: { code: 'INTERNAL', message: 'Failed to load errors' } });
      }
    },
  );
};
