import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/db.js';
import { emitSecurityAuditEvent, securityAuditContextFromRequest } from '../../lib/security-audit.js';
import { replayIdempotentIfExists, storeIdempotentResponse } from '../../lib/v2-idempotency.js';
import { V2_ERROR_CODES } from '../../lib/v2-error-codes.js';
import { v2Error, v2Success } from '../../lib/v2-response.js';
import { authenticateApiKey, getAuthenticatedUser } from '../../middleware/auth.middleware.js';
import { generateApiKey, hashApiKey } from '../../utils/apiKey.js';

const ALLOWED_SCOPES = new Set([
  'endpoints:read',
  'endpoints:write',
  'traffic:read',
  'security:read',
  'security:write',
  '*',
]);

const v2ErrorSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
  timestamp: z.string(),
  requestId: z.string(),
});

const serviceKeyMetadataSchema = z.object({
  id: z.string(),
  name: z.string(),
  scopes: z.array(z.string()),
  workspaceType: z.enum(['PERSONAL', 'TEAM']),
  teamId: z.string().nullable().optional(),
  lastUsedAt: z.date().nullable().optional(),
  expiresAt: z.date().nullable().optional(),
  revokedAt: z.date().nullable().optional(),
  createdAt: z.date(),
  updatedAt: z.date().optional(),
});

const createServiceKeyBodySchema = z.object({
  name: z.string().min(3),
  scopes: z.array(z.string()).optional(),
  workspaceType: z.enum(['PERSONAL', 'TEAM']).optional(),
  teamId: z.string().optional(),
  expiresAt: z.string().datetime().optional(),
});

export const v2ServiceKeysRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', authenticateApiKey);
  fastify.addHook('onRequest', async (_request, reply) => {
    reply.header('x-api-version', '2');
  });

  fastify.get('/', {
    schema: {
      tags: ['v2 Service Keys'],
      summary: 'List service keys',
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({ keys: z.array(serviceKeyMetadataSchema) }),
          timestamp: z.string(),
        }),
        401: v2ErrorSchema,
        500: v2ErrorSchema,
      },
    },
  }, async (request, reply) => {
    try {
      const user = getAuthenticatedUser(request);

      const keys = await prisma.serviceApiKey.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          scopes: true,
          workspaceType: true,
          teamId: true,
          lastUsedAt: true,
          expiresAt: true,
          revokedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return v2Success(reply, { keys });
    } catch {
      return v2Error(request, reply, 500, {
        code: V2_ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to list service keys',
      });
    }
  });

  fastify.post('/', {
    schema: {
      tags: ['v2 Service Keys'],
      summary: 'Create service key',
      body: createServiceKeyBodySchema,
      response: {
        201: z.object({
          success: z.literal(true),
          data: z.object({
            key: z.string(),
            metadata: serviceKeyMetadataSchema.omit({ lastUsedAt: true, revokedAt: true, updatedAt: true }),
            message: z.string(),
          }),
          timestamp: z.string(),
        }),
        400: v2ErrorSchema,
        401: v2ErrorSchema,
        403: v2ErrorSchema,
        500: v2ErrorSchema,
      },
    },
  }, async (request, reply) => {
    try {
      const idem = await replayIdempotentIfExists(request, reply, 'service-keys:create');
      if (idem.replayed) return;

      const user = getAuthenticatedUser(request);
      const body = request.body as {
        name?: string;
        scopes?: string[];
        workspaceType?: 'PERSONAL' | 'TEAM';
        teamId?: string;
        expiresAt?: string;
      };

      const name = body.name?.trim();
      const scopes = Array.isArray(body.scopes) && body.scopes.length > 0 ? body.scopes : ['endpoints:read'];
      const workspaceType = body.workspaceType ?? 'PERSONAL';

      if (!name || name.length < 3) {
        return v2Error(request, reply, 400, {
          code: V2_ERROR_CODES.VALIDATION_ERROR,
          message: 'name must be at least 3 characters',
        });
      }

      for (const scope of scopes) {
        if (!ALLOWED_SCOPES.has(scope)) {
          return v2Error(request, reply, 400, {
            code: V2_ERROR_CODES.VALIDATION_ERROR,
            message: `Unsupported scope: ${scope}`,
          });
        }
      }

      if (workspaceType === 'TEAM') {
        if (!body.teamId) {
          return v2Error(request, reply, 400, {
            code: V2_ERROR_CODES.VALIDATION_ERROR,
            message: 'teamId is required for TEAM workspace keys',
          });
        }

        const membership = await prisma.teamMember.findFirst({
          where: { userId: user.id, teamId: body.teamId },
        });

        if (!membership) {
          return v2Error(request, reply, 403, {
            code: V2_ERROR_CODES.FORBIDDEN,
            message: 'You are not a member of the target team',
          });
        }
      }

      const rawKey = `murl_sk_${generateApiKey()}`;
      const keyHash = hashApiKey(rawKey);

      const created = await prisma.serviceApiKey.create({
        data: {
          name,
          keyHash,
          scopes,
          workspaceType,
          teamId: workspaceType === 'TEAM' ? body.teamId! : null,
          userId: user.id,
          expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
        },
        select: {
          id: true,
          name: true,
          scopes: true,
          workspaceType: true,
          teamId: true,
          expiresAt: true,
          createdAt: true,
        },
      });

      const responseBody = {
        success: true as const,
        data: {
          key: rawKey,
          metadata: created,
          message: 'Store this key now. It will not be shown again.',
        },
        timestamp: new Date().toISOString(),
      };
      await storeIdempotentResponse(idem.cacheKey, 201, responseBody);
      await emitSecurityAuditEvent(securityAuditContextFromRequest(request, {
        action: 'SERVICE_KEY_CREATED',
        targetType: 'ServiceApiKey',
        targetId: created.id,
        result: 'SUCCESS',
        metadata: {
          scopes,
          workspaceType,
          teamId: workspaceType === 'TEAM' ? body.teamId ?? null : null,
          expiresAt: body.expiresAt ?? null,
        },
      }));

      return reply.status(201).send(responseBody);
    } catch (error) {
      await emitSecurityAuditEvent(securityAuditContextFromRequest(request, {
        action: 'SERVICE_KEY_CREATED',
        targetType: 'ServiceApiKey',
        result: 'ERROR',
        reason: 'create_failed',
        metadata: { error: String((error as Error)?.message ?? error) },
      }));
      return v2Error(request, reply, 500, {
        code: V2_ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to create service key',
      });
    }
  });

  fastify.post('/:id/revoke', {
    schema: {
      tags: ['v2 Service Keys'],
      summary: 'Revoke service key',
      params: z.object({ id: z.string() }),
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({ revoked: z.boolean() }),
          timestamp: z.string(),
        }),
        401: v2ErrorSchema,
        404: v2ErrorSchema,
        500: v2ErrorSchema,
      },
    },
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const idem = await replayIdempotentIfExists(request, reply, `service-keys:revoke:${id}`);
      if (idem.replayed) return;

      const user = getAuthenticatedUser(request);

      const existing = await prisma.serviceApiKey.findFirst({
        where: { id, userId: user.id },
        select: { id: true, revokedAt: true },
      });

      if (!existing) {
        await emitSecurityAuditEvent(securityAuditContextFromRequest(request, {
          action: 'SERVICE_KEY_REVOKED',
          targetType: 'ServiceApiKey',
          targetId: id,
          result: 'DENIED',
          reason: 'not_found',
        }));
        return v2Error(request, reply, 404, {
          code: V2_ERROR_CODES.NOT_FOUND,
          message: 'Key not found',
        });
      }

      if (!existing.revokedAt) {
        await prisma.serviceApiKey.update({
          where: { id },
          data: { revokedAt: new Date() },
        });
      }

      const responseBody = {
        success: true as const,
        data: { revoked: true },
        timestamp: new Date().toISOString(),
      };
      await storeIdempotentResponse(idem.cacheKey, 200, responseBody);
      await emitSecurityAuditEvent(securityAuditContextFromRequest(request, {
        action: 'SERVICE_KEY_REVOKED',
        targetType: 'ServiceApiKey',
        targetId: id,
        result: 'SUCCESS',
      }));
      return reply.status(200).send(responseBody);
    } catch (error) {
      await emitSecurityAuditEvent(securityAuditContextFromRequest(request, {
        action: 'SERVICE_KEY_REVOKED',
        targetType: 'ServiceApiKey',
        result: 'ERROR',
        reason: 'revoke_failed',
        metadata: { error: String((error as Error)?.message ?? error) },
      }));
      return v2Error(request, reply, 500, {
        code: V2_ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to revoke key',
      });
    }
  });

  fastify.post('/:id/rotate', {
    schema: {
      tags: ['v2 Service Keys'],
      summary: 'Rotate service key',
      params: z.object({ id: z.string() }),
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({ key: z.string(), message: z.string() }),
          timestamp: z.string(),
        }),
        401: v2ErrorSchema,
        404: v2ErrorSchema,
        409: v2ErrorSchema,
        500: v2ErrorSchema,
      },
    },
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const idem = await replayIdempotentIfExists(request, reply, `service-keys:rotate:${id}`);
      if (idem.replayed) return;

      const user = getAuthenticatedUser(request);

      const existing = await prisma.serviceApiKey.findFirst({
        where: { id, userId: user.id },
        select: { id: true, revokedAt: true },
      });

      if (!existing) {
        await emitSecurityAuditEvent(securityAuditContextFromRequest(request, {
          action: 'SERVICE_KEY_ROTATED',
          targetType: 'ServiceApiKey',
          targetId: id,
          result: 'DENIED',
          reason: 'not_found',
        }));
        return v2Error(request, reply, 404, {
          code: V2_ERROR_CODES.NOT_FOUND,
          message: 'Key not found',
        });
      }

      if (existing.revokedAt) {
        await emitSecurityAuditEvent(securityAuditContextFromRequest(request, {
          action: 'SERVICE_KEY_ROTATED',
          targetType: 'ServiceApiKey',
          targetId: id,
          result: 'DENIED',
          reason: 'key_revoked',
        }));
        return v2Error(request, reply, 409, {
          code: V2_ERROR_CODES.KEY_REVOKED,
          message: 'Cannot rotate a revoked key',
        });
      }

      const rawKey = `murl_sk_${generateApiKey()}`;
      const keyHash = hashApiKey(rawKey);

      await prisma.serviceApiKey.update({
        where: { id },
        data: {
          keyHash,
          lastUsedAt: null,
        },
      });

      const responseBody = {
        success: true as const,
        data: {
          key: rawKey,
          message: 'Store this rotated key now. It will not be shown again.',
        },
        timestamp: new Date().toISOString(),
      };
      await storeIdempotentResponse(idem.cacheKey, 200, responseBody);
      await emitSecurityAuditEvent(securityAuditContextFromRequest(request, {
        action: 'SERVICE_KEY_ROTATED',
        targetType: 'ServiceApiKey',
        targetId: id,
        result: 'SUCCESS',
      }));
      return reply.status(200).send(responseBody);
    } catch (error) {
      await emitSecurityAuditEvent(securityAuditContextFromRequest(request, {
        action: 'SERVICE_KEY_ROTATED',
        targetType: 'ServiceApiKey',
        result: 'ERROR',
        reason: 'rotate_failed',
        metadata: { error: String((error as Error)?.message ?? error) },
      }));
      return v2Error(request, reply, 500, {
        code: V2_ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to rotate key',
      });
    }
  });
};
