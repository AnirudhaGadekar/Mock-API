import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/db.js';
import { emitSecurityAuditEvent, securityAuditContextFromRequest } from '../../lib/security-audit.js';
import { isValidCidr, resolveEffectiveSecurityPolicy } from '../../lib/security-policy.js';
import { replayIdempotentIfExists, storeIdempotentResponse } from '../../lib/v2-idempotency.js';
import { V2_ERROR_CODES } from '../../lib/v2-error-codes.js';
import { v2Error, v2Success } from '../../lib/v2-response.js';
import { authenticateV2ApiKey, requireV2Scopes } from '../../middleware/auth-v2.middleware.js';
import { invalidateEndpointCache } from '../../utils/endpoint.cache.js';
import {
  DEFAULT_MOCK_RULES,
  createEndpointSchema,
  endpointNameSchema,
  listEndpointsQuerySchema,
  mockRuleSchema,
} from '../../validators/endpoint.validator.js';

function normalizeEndpointBaseUrl(base: string): string {
  const trimmed = base.trim().replace(/\/+$/, '');
  return trimmed.endsWith('/e') ? trimmed : `${trimmed}/e`;
}

function endpointPublicUrl(slug: string): string {
  const configuredBase = process.env.BASE_ENDPOINT_URL?.trim();
  const base = configuredBase ? normalizeEndpointBaseUrl(configuredBase) : 'http://localhost:3000/e';
  return `${base}/${slug}`;
}

function getWorkspaceWhere(request: any): { userId?: string; teamId?: string } | null {
  const workspaceType = request.v2Auth?.workspaceType;
  if (workspaceType === 'TEAM') {
    if (!request.v2Auth?.teamId) return null;
    return { teamId: request.v2Auth.teamId };
  }
  if (!request.user?.id) return null;
  return { userId: request.user.id };
}

async function ensureWorkspaceId(workspaceWhere: { userId?: string; teamId?: string }): Promise<string> {
  if (workspaceWhere.teamId) {
    const ws = await prisma.workspace.upsert({
      where: { teamId: workspaceWhere.teamId },
      update: { updatedAt: new Date() },
      create: { id: `ws_team_${workspaceWhere.teamId}`, type: 'TEAM', teamId: workspaceWhere.teamId },
    });
    return ws.id;
  }
  if (workspaceWhere.userId) {
    const id = `ws_personal_${workspaceWhere.userId}`;
    const ws = await prisma.workspace.upsert({
      where: { id },
      update: { updatedAt: new Date() },
      create: { id, type: 'PERSONAL', personalOwnerUserId: workspaceWhere.userId },
    });
    return ws.id;
  }
  throw new Error('Cannot resolve workspaceId');
}

function formatEndpoint(endpoint: any) {
  return {
    id: endpoint.id,
    name: endpoint.name,
    subdomain: endpoint.slug,
    url: endpointPublicUrl(endpoint.slug),
    rules: Array.isArray(endpoint.rules) ? endpoint.rules : [],
    reqCount: endpoint.requestCount ?? 0,
    createdAt: endpoint.createdAt instanceof Date ? endpoint.createdAt.toISOString() : String(endpoint.createdAt),
    updatedAt: endpoint.updatedAt instanceof Date ? endpoint.updatedAt.toISOString() : String(endpoint.updatedAt),
    settings: endpoint.settings ?? null,
    workspaceType: endpoint.teamId ? 'TEAM' : 'PERSONAL',
    teamId: endpoint.teamId ?? null,
  };
}

function getValidationErrorDetails(request: { validationError?: { validation?: unknown; message?: string } }): unknown {
  return request.validationError?.validation ?? request.validationError?.message ?? null;
}

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

const v2EndpointSchema = z.object({
  id: z.string(),
  name: z.string(),
  subdomain: z.string(),
  url: z.string(),
  rules: z.array(z.unknown()),
  reqCount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  settings: z.unknown().optional(),
  workspaceType: z.enum(['PERSONAL', 'TEAM']),
  teamId: z.string().nullable(),
});

const v2EndpointSingleResponseSchema = z.object({
  success: z.literal(true),
  endpoint: v2EndpointSchema.optional(),
  data: v2EndpointSchema,
  timestamp: z.string(),
});

const patchEndpointBodySchema = z.object({
  name: z.string().optional(),
  rules: z.array(z.unknown()).optional(),
  settings: z.unknown().optional(),
  forwardUrl: z.string().url().optional(),
  forwardFallback: z.boolean().optional(),
});

const putEndpointBodySchema = z
  .object({
    name: endpointNameSchema.optional(),
    rules: z.array(mockRuleSchema).optional(),
    forwardUrl: z.string().url().optional(),
    forwardFallback: z.boolean().optional(),
  })
  .refine((value) => value.name !== undefined || value.rules !== undefined || value.forwardUrl !== undefined || value.forwardFallback !== undefined, {
    message: 'Provide at least one of name, rules, forwardUrl, or forwardFallback',
  });

const endpointIdParamsSchema = z.object({ id: z.string() });

const deleteEndpointSuccessSchema = z.object({
  success: z.literal(true),
  message: z.literal('Endpoint deleted'),
  id: z.string(),
});

const deleteEndpointNotFoundSchema = z.object({
  success: z.literal(false),
  error: z.literal('Endpoint not found'),
});

const v2RulesResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    endpointId: z.string(),
    rules: z.array(z.unknown()),
  }),
  timestamp: z.string(),
});

const updateRulesBodySchema = z.object({
  rules: z.array(z.unknown()),
});

const securityPolicySchema = z.object({
  ipAllowlist: z.array(z.string()).default([]).superRefine((values, ctx) => {
    for (const raw of values) {
      const value = String(raw ?? '').trim();
      if (!value) continue;
      if (!isValidCidr(value)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Invalid CIDR: ${value}` });
      }
    }
  }),
  maskedHeaders: z.array(z.string()).default([]).transform((values) => {
    const normalized = values.map((v) => v.trim().toLowerCase()).filter(Boolean);
    return Array.from(new Set(normalized));
  }),
  maskingStrategy: z.enum(['full', 'partial', 'hash']).default('full'),
  mtlsMode: z.enum(['off', 'optional', 'required']).default('off'),
});

const v2SecurityPolicyResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    endpointId: z.string(),
    securityPolicy: securityPolicySchema,
    effectivePolicy: securityPolicySchema,
    featureFlags: z.object({
      ipAllowlist: z.boolean(),
      headerMasking: z.boolean(),
    }),
  }),
  timestamp: z.string(),
});

export const v2EndpointsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', authenticateV2ApiKey);

  fastify.get('/', {
    preHandler: [requireV2Scopes(['endpoints:read'])],
    schema: {
      tags: ['v2 Endpoints'],
      summary: 'List endpoints',
      querystring: listEndpointsQuerySchema,
      response: {
        200: z.any(),
        400: v2ErrorSchema,
        401: v2ErrorSchema,
        403: v2ErrorSchema,
        500: v2ErrorSchema,
      },
    },
  }, async (request, reply) => {
    try {
      const parsed = listEndpointsQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return v2Error(request, reply, 400, {
          code: V2_ERROR_CODES.VALIDATION_ERROR,
          message: 'Invalid query',
          details: parsed.error.flatten(),
        });
      }

      const workspaceWhere = getWorkspaceWhere(request);
      if (!workspaceWhere) {
        return v2Error(request, reply, 400, {
          code: V2_ERROR_CODES.TEAM_CONTEXT_REQUIRED,
          message: 'teamId is required for TEAM workspace key',
        });
      }

      const { limit, afterId, sort, search } = parsed.data;
      const [sortField, sortOrder] = sort.split(':') as [string, 'asc' | 'desc'];
      const where = {
        ...workspaceWhere,
        ...(search ? { name: { contains: search, mode: 'insensitive' as const } } : {}),
      };

      const rows = await prisma.endpoint.findMany({
        where,
        take: limit + 1,
        ...(afterId ? { cursor: { id: afterId }, skip: 1 } : {}),
        orderBy: { [sortField]: sortOrder },
      });

      const hasMore = rows.length > limit;
      const pageRows = hasMore ? rows.slice(0, limit) : rows;
      const totalCount = await prisma.endpoint.count({ where });

      return v2Success(reply, {
        endpoints: pageRows.map(formatEndpoint),
        nextCursor: hasMore ? pageRows[pageRows.length - 1]?.id ?? null : null,
        totalCount,
        hasMore,
      });
    } catch {
      return v2Error(request, reply, 500, { code: V2_ERROR_CODES.INTERNAL_ERROR, message: 'Failed to list endpoints' });
    }
  });

  fastify.post('/', {
    preHandler: [requireV2Scopes(['endpoints:write'])],
    attachValidation: true,
    schema: {
      tags: ['v2 Endpoints'],
      summary: 'Create endpoint',
      body: createEndpointSchema,
      response: {
        201: v2EndpointSingleResponseSchema,
        400: v2ErrorSchema,
        401: v2ErrorSchema,
        403: v2ErrorSchema,
        409: v2ErrorSchema,
        500: v2ErrorSchema,
      },
    },
  }, async (request: any, reply) => {
    try {
      if (request.validationError) {
        return v2Error(request, reply, 400, {
          code: V2_ERROR_CODES.VALIDATION_ERROR,
          message: 'Invalid body',
          details: getValidationErrorDetails(request),
        });
      }

      const idem = await replayIdempotentIfExists(request, reply, 'endpoints:create');
      if (idem.replayed) return;

      const parsed = createEndpointSchema.safeParse(request.body);
      if (!parsed.success) {
        return v2Error(request, reply, 400, {
          code: V2_ERROR_CODES.VALIDATION_ERROR,
          message: 'Invalid body',
          details: parsed.error.flatten(),
        });
      }

      const workspaceWhere = getWorkspaceWhere(request);
      if (!workspaceWhere) {
        return v2Error(request, reply, 400, {
          code: V2_ERROR_CODES.TEAM_CONTEXT_REQUIRED,
          message: 'teamId is required for TEAM workspace key',
        });
      }

      const { name, rules, forwardUrl, forwardFallback } = parsed.data;
      const existing = await prisma.endpoint.findUnique({ where: { slug: name } });
      if (existing) {
        return v2Error(request, reply, 409, {
          code: V2_ERROR_CODES.SLUG_TAKEN,
          message: `Subdomain "${name}" is already taken`,
        });
      }

      const workspaceId = await ensureWorkspaceId(workspaceWhere);
      const created = await prisma.endpoint.create({
        data: {
          name,
          slug: name,
          userId: workspaceWhere.userId ?? null,
          teamId: workspaceWhere.teamId ?? null,
          workspaceId,
          rules: rules && rules.length > 0 ? (rules as object[]) : DEFAULT_MOCK_RULES,
          settings:
            forwardUrl !== undefined || forwardFallback !== undefined
              ? {
                forwardUrl: forwardUrl ?? null,
                forwardFallback: forwardFallback ?? true,
              }
              : undefined,
          requestCount: 0,
          lastActiveAt: new Date(),
        },
      });

      await emitSecurityAuditEvent(securityAuditContextFromRequest(request, {
        action: 'ENDPOINT_CREATED',
        targetType: 'Endpoint',
        targetId: created.id,
        result: 'SUCCESS',
        metadata: { name, slug: created.slug, teamId: created.teamId ?? null, workspaceId },
      }));

      const responseBody = {
        success: true as const,
        endpoint: formatEndpoint(created),
        data: formatEndpoint(created),
        timestamp: new Date().toISOString(),
      };
      await storeIdempotentResponse(idem.cacheKey, 201, responseBody);
      return reply.status(201).send(responseBody);
    } catch (error: unknown) {
      await emitSecurityAuditEvent(securityAuditContextFromRequest(request, {
        action: 'ENDPOINT_CREATED',
        targetType: 'Endpoint',
        result: 'ERROR',
        reason: 'create_failed',
        metadata: { error: String((error as Error)?.message ?? error) },
      }));
      return v2Error(request, reply, 500, { code: V2_ERROR_CODES.INTERNAL_ERROR, message: 'Failed to create endpoint' });
    }
  });

  fastify.get('/:id', {
    preHandler: [requireV2Scopes(['endpoints:read'])],
    attachValidation: true,
    schema: {
      tags: ['v2 Endpoints'],
      summary: 'Get endpoint',
      params: endpointIdParamsSchema,
      response: {
        200: v2EndpointSingleResponseSchema,
        400: v2ErrorSchema,
        401: v2ErrorSchema,
        403: v2ErrorSchema,
        404: v2ErrorSchema,
        500: v2ErrorSchema,
      },
    },
  }, async (request: any, reply) => {
    try {
      if (request.validationError) {
        return v2Error(request, reply, 400, {
          code: V2_ERROR_CODES.VALIDATION_ERROR,
          message: 'Invalid id',
          details: getValidationErrorDetails(request),
        });
      }

      const params = endpointIdParamsSchema.safeParse(request.params);
      if (!params.success) {
        return v2Error(request, reply, 400, { code: V2_ERROR_CODES.VALIDATION_ERROR, message: 'Invalid id' });
      }
      const workspaceWhere = getWorkspaceWhere(request);
      if (!workspaceWhere) {
        return v2Error(request, reply, 400, { code: V2_ERROR_CODES.TEAM_CONTEXT_REQUIRED, message: 'teamId is required' });
      }
      const endpoint = await prisma.endpoint.findFirst({ where: { id: params.data.id, ...workspaceWhere } });
      if (!endpoint) {
        return v2Error(request, reply, 404, { code: V2_ERROR_CODES.NOT_FOUND, message: 'Endpoint not found' });
      }
      return v2Success(reply, formatEndpoint(endpoint));
    } catch {
      return v2Error(request, reply, 500, { code: V2_ERROR_CODES.INTERNAL_ERROR, message: 'Failed to load endpoint' });
    }
  });

  fastify.delete('/:id', {
    preHandler: [requireV2Scopes(['endpoints:write'])],
    attachValidation: true,
    schema: {
      tags: ['v2 Endpoints'],
      summary: 'Delete endpoint',
      params: endpointIdParamsSchema,
      response: {
        200: deleteEndpointSuccessSchema,
        400: v2ErrorSchema,
        401: v2ErrorSchema,
        403: v2ErrorSchema,
        404: deleteEndpointNotFoundSchema,
        500: v2ErrorSchema,
      },
    },
  }, async (request: any, reply) => {
    try {
      if (request.validationError) {
        return v2Error(request, reply, 400, {
          code: V2_ERROR_CODES.VALIDATION_ERROR,
          message: 'Invalid id',
          details: getValidationErrorDetails(request),
        });
      }

      const params = endpointIdParamsSchema.safeParse(request.params);
      if (!params.success) {
        return v2Error(request, reply, 400, { code: V2_ERROR_CODES.VALIDATION_ERROR, message: 'Invalid id' });
      }
      const workspaceWhere = getWorkspaceWhere(request);
      if (!workspaceWhere) {
        return v2Error(request, reply, 400, { code: V2_ERROR_CODES.TEAM_CONTEXT_REQUIRED, message: 'teamId is required' });
      }
      const endpoint = await prisma.endpoint.findFirst({ where: { id: params.data.id, ...workspaceWhere } });
      if (!endpoint) {
        return reply.status(404).send({ success: false, error: 'Endpoint not found' });
      }
      await prisma.endpoint.delete({ where: { id: endpoint.id } });
      await invalidateEndpointCache(endpoint.id, endpoint.slug).catch(() => {});
      await emitSecurityAuditEvent(securityAuditContextFromRequest(request, {
        action: 'ENDPOINT_DELETED',
        targetType: 'Endpoint',
        targetId: endpoint.id,
        result: 'SUCCESS',
      }));
      return reply.status(200).send({ success: true, message: 'Endpoint deleted', id: endpoint.id });
    } catch {
      return v2Error(request, reply, 500, { code: V2_ERROR_CODES.INTERNAL_ERROR, message: 'Failed to delete endpoint' });
    }
  });

  fastify.put('/:id', {
    preHandler: [requireV2Scopes(['endpoints:write'])],
    attachValidation: true,
    schema: {
      tags: ['v2 Endpoints'],
      summary: 'Replace endpoint data',
      params: endpointIdParamsSchema,
      body: putEndpointBodySchema,
      response: {
        200: v2EndpointSingleResponseSchema,
        400: v2ErrorSchema,
        401: v2ErrorSchema,
        403: v2ErrorSchema,
        404: v2ErrorSchema,
        409: v2ErrorSchema,
        500: v2ErrorSchema,
      },
    },
  }, async (request: any, reply) => {
    try {
      if (request.validationError) {
        return v2Error(request, reply, 400, {
          code: V2_ERROR_CODES.VALIDATION_ERROR,
          message: 'Invalid request',
          details: getValidationErrorDetails(request),
        });
      }

      const params = endpointIdParamsSchema.safeParse(request.params);
      const body = putEndpointBodySchema.safeParse(request.body);
      if (!params.success || !body.success) {
        return v2Error(request, reply, 400, {
          code: V2_ERROR_CODES.VALIDATION_ERROR,
          message: 'Invalid request',
          details: { params: params.success ? null : params.error.flatten(), body: body.success ? null : body.error.flatten() },
        });
      }

      const workspaceWhere = getWorkspaceWhere(request);
      if (!workspaceWhere) {
        return v2Error(request, reply, 400, { code: V2_ERROR_CODES.TEAM_CONTEXT_REQUIRED, message: 'teamId is required' });
      }

      const endpoint = await prisma.endpoint.findFirst({ where: { id: params.data.id, ...workspaceWhere } });
      if (!endpoint) {
        return v2Error(request, reply, 404, { code: V2_ERROR_CODES.NOT_FOUND, message: 'Endpoint not found' });
      }

      const nextName = body.data.name?.trim();
      if (nextName) {
        const existing = await prisma.endpoint.findUnique({ where: { slug: nextName } });
        if (existing && existing.id !== endpoint.id) {
          return v2Error(request, reply, 409, {
            code: V2_ERROR_CODES.SLUG_TAKEN,
            message: `Subdomain "${nextName}" is already taken`,
          });
        }
      }

      const updated = await prisma.endpoint.update({
        where: { id: endpoint.id },
        data: {
          ...(nextName ? { name: nextName, slug: nextName } : {}),
          ...(body.data.rules ? { rules: body.data.rules as any } : {}),
          ...((body.data.forwardUrl !== undefined || body.data.forwardFallback !== undefined)
            ? {
              settings: {
                ...((endpoint.settings as any) ?? {}),
                ...(body.data.forwardUrl !== undefined ? { forwardUrl: body.data.forwardUrl } : {}),
                ...(body.data.forwardFallback !== undefined ? { forwardFallback: body.data.forwardFallback } : {}),
              },
            }
            : {}),
        },
      });

      await invalidateEndpointCache(updated.id, endpoint.slug).catch(() => {});
      if (nextName && nextName !== endpoint.slug) {
        await invalidateEndpointCache(updated.id, nextName).catch(() => {});
      }

      return v2Success(reply, formatEndpoint(updated));
    } catch {
      return v2Error(request, reply, 500, { code: V2_ERROR_CODES.INTERNAL_ERROR, message: 'Failed to update endpoint' });
    }
  });

  fastify.patch('/:id', {
    preHandler: [requireV2Scopes(['endpoints:write'])],
    attachValidation: true,
    schema: {
      tags: ['v2 Endpoints'],
      summary: 'Update endpoint',
      params: endpointIdParamsSchema,
      body: patchEndpointBodySchema,
      response: {
        200: v2EndpointSingleResponseSchema,
        400: v2ErrorSchema,
        401: v2ErrorSchema,
        403: v2ErrorSchema,
        404: v2ErrorSchema,
        409: v2ErrorSchema,
        500: v2ErrorSchema,
      },
    },
  }, async (request: any, reply) => {
    try {
      if (request.validationError) {
        return v2Error(request, reply, 400, {
          code: V2_ERROR_CODES.VALIDATION_ERROR,
          message: 'Invalid request',
          details: getValidationErrorDetails(request),
        });
      }

      const params = endpointIdParamsSchema.safeParse(request.params);
      const body = patchEndpointBodySchema.safeParse(request.body);
      if (!params.success || !body.success) {
        return v2Error(request, reply, 400, {
          code: V2_ERROR_CODES.VALIDATION_ERROR,
          message: 'Invalid request',
          details: { params: params.success ? null : params.error.flatten(), body: body.success ? null : body.error.flatten() },
        });
      }

      const workspaceWhere = getWorkspaceWhere(request);
      if (!workspaceWhere) {
        return v2Error(request, reply, 400, { code: V2_ERROR_CODES.TEAM_CONTEXT_REQUIRED, message: 'teamId is required' });
      }

      const endpoint = await prisma.endpoint.findFirst({ where: { id: params.data.id, ...workspaceWhere } });
      if (!endpoint) {
        return v2Error(request, reply, 404, { code: V2_ERROR_CODES.NOT_FOUND, message: 'Endpoint not found' });
      }

      const nextName = body.data.name?.trim();
      if (nextName) {
        const existing = await prisma.endpoint.findUnique({ where: { slug: nextName } });
        if (existing && existing.id !== endpoint.id) {
          return v2Error(request, reply, 409, {
            code: V2_ERROR_CODES.SLUG_TAKEN,
            message: `Subdomain "${nextName}" is already taken`,
          });
        }
      }

      const updated = await prisma.endpoint.update({
        where: { id: endpoint.id },
        data: {
          ...(nextName ? { name: nextName, slug: nextName } : {}),
          ...(body.data.rules ? { rules: body.data.rules as any } : {}),
          ...((body.data.settings !== undefined || body.data.forwardUrl !== undefined || body.data.forwardFallback !== undefined)
            ? {
              settings: {
                ...((endpoint.settings as any) ?? {}),
                ...(body.data.settings !== undefined ? (body.data.settings as any) : {}),
                ...(body.data.forwardUrl !== undefined ? { forwardUrl: body.data.forwardUrl } : {}),
                ...(body.data.forwardFallback !== undefined ? { forwardFallback: body.data.forwardFallback } : {}),
              },
            }
            : {}),
        },
      });

      await invalidateEndpointCache(updated.id, endpoint.slug).catch(() => {});
      if (nextName && nextName !== endpoint.slug) {
        await invalidateEndpointCache(updated.id, nextName).catch(() => {});
      }

      return v2Success(reply, formatEndpoint(updated));
    } catch {
      return v2Error(request, reply, 500, { code: V2_ERROR_CODES.INTERNAL_ERROR, message: 'Failed to update endpoint' });
    }
  });

  fastify.get('/:id/rules', {
    preHandler: [requireV2Scopes(['endpoints:read'])],
    attachValidation: true,
    schema: {
      tags: ['v2 Endpoints'],
      summary: 'Get endpoint rules',
      params: endpointIdParamsSchema,
      response: {
        200: v2RulesResponseSchema,
        400: v2ErrorSchema,
        401: v2ErrorSchema,
        403: v2ErrorSchema,
        404: v2ErrorSchema,
        500: v2ErrorSchema,
      },
    },
  }, async (request: any, reply) => {
    try {
      if (request.validationError) {
        return v2Error(request, reply, 400, {
          code: V2_ERROR_CODES.VALIDATION_ERROR,
          message: 'Invalid id',
          details: getValidationErrorDetails(request),
        });
      }

      const params = endpointIdParamsSchema.safeParse(request.params);
      if (!params.success) {
        return v2Error(request, reply, 400, { code: V2_ERROR_CODES.VALIDATION_ERROR, message: 'Invalid id' });
      }

      const workspaceWhere = getWorkspaceWhere(request);
      if (!workspaceWhere) {
        return v2Error(request, reply, 400, { code: V2_ERROR_CODES.TEAM_CONTEXT_REQUIRED, message: 'teamId is required' });
      }

      const endpoint = await prisma.endpoint.findFirst({ where: { id: params.data.id, ...workspaceWhere } });
      if (!endpoint) {
        return v2Error(request, reply, 404, { code: V2_ERROR_CODES.NOT_FOUND, message: 'Endpoint not found' });
      }

      return v2Success(reply, { endpointId: endpoint.id, rules: Array.isArray(endpoint.rules) ? endpoint.rules : [] });
    } catch {
      return v2Error(request, reply, 500, { code: V2_ERROR_CODES.INTERNAL_ERROR, message: 'Failed to load rules' });
    }
  });

  fastify.put('/:id/rules', {
    preHandler: [requireV2Scopes(['endpoints:write'])],
    attachValidation: true,
    schema: {
      tags: ['v2 Endpoints'],
      summary: 'Replace endpoint rules',
      params: endpointIdParamsSchema,
      body: updateRulesBodySchema,
      response: {
        200: v2RulesResponseSchema,
        400: v2ErrorSchema,
        401: v2ErrorSchema,
        403: v2ErrorSchema,
        404: v2ErrorSchema,
        500: v2ErrorSchema,
      },
    },
  }, async (request: any, reply) => {
    try {
      if (request.validationError) {
        return v2Error(request, reply, 400, {
          code: V2_ERROR_CODES.VALIDATION_ERROR,
          message: 'Invalid request',
          details: getValidationErrorDetails(request),
        });
      }

      const params = endpointIdParamsSchema.safeParse(request.params);
      const body = updateRulesBodySchema.safeParse(request.body);
      if (!params.success || !body.success) {
        return v2Error(request, reply, 400, { code: V2_ERROR_CODES.VALIDATION_ERROR, message: 'Invalid request' });
      }

      const workspaceWhere = getWorkspaceWhere(request);
      if (!workspaceWhere) {
        return v2Error(request, reply, 400, { code: V2_ERROR_CODES.TEAM_CONTEXT_REQUIRED, message: 'teamId is required' });
      }

      const endpoint = await prisma.endpoint.findFirst({ where: { id: params.data.id, ...workspaceWhere } });
      if (!endpoint) {
        return v2Error(request, reply, 404, { code: V2_ERROR_CODES.NOT_FOUND, message: 'Endpoint not found' });
      }

      const updated = await prisma.endpoint.update({
        where: { id: endpoint.id },
        data: { rules: body.data.rules as any },
      });

      await emitSecurityAuditEvent(securityAuditContextFromRequest(request, {
        action: 'ENDPOINT_RULES_REPLACED',
        targetType: 'Endpoint',
        targetId: updated.id,
        result: 'SUCCESS',
        metadata: { count: Array.isArray(body.data.rules) ? body.data.rules.length : 0 },
      }));

      return v2Success(reply, { endpointId: updated.id, rules: Array.isArray(updated.rules) ? updated.rules : [] });
    } catch {
      return v2Error(request, reply, 500, { code: V2_ERROR_CODES.INTERNAL_ERROR, message: 'Failed to update rules' });
    }
  });

  fastify.get('/:id/security-policy', {
    preHandler: [requireV2Scopes(['security:read'])],
    schema: {
      tags: ['v2 SecurityPolicy'],
      summary: 'Get security policy for endpoint',
      response: {
        200: v2SecurityPolicyResponseSchema,
        400: v2ErrorSchema,
        401: v2ErrorSchema,
        403: v2ErrorSchema,
        404: v2ErrorSchema,
        500: v2ErrorSchema,
      },
    },
  }, async (request: any, reply) => {
    try {
      const id = request.params?.id as string;
      if (!id) {
        return v2Error(request, reply, 400, { code: V2_ERROR_CODES.VALIDATION_ERROR, message: 'Missing id' });
      }

      const workspaceWhere = getWorkspaceWhere(request);
      if (!workspaceWhere) {
        return v2Error(request, reply, 400, { code: V2_ERROR_CODES.TEAM_CONTEXT_REQUIRED, message: 'teamId is required' });
      }

      const endpoint = await prisma.endpoint.findFirst({ where: { id, ...workspaceWhere } });
      if (!endpoint) {
        return v2Error(request, reply, 404, { code: V2_ERROR_CODES.NOT_FOUND, message: 'Endpoint not found' });
      }

      const raw = (endpoint.settings as any)?.securityPolicy ?? {};
      const policy = securityPolicySchema.parse(raw);
      const effectivePolicy = resolveEffectiveSecurityPolicy(endpoint.settings, endpoint.teamId ?? null);

      return v2Success(reply, {
        endpointId: endpoint.id,
        securityPolicy: policy,
        effectivePolicy,
        featureFlags: {
          ipAllowlist: Boolean(process.env.FEATURE_IP_ALLOWLIST),
          headerMasking: Boolean(process.env.FEATURE_HEADER_MASKING),
        },
      });
    } catch (error: unknown) {
      return v2Error(request, reply, 500, {
        code: V2_ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to load security policy',
        details: String((error as Error)?.message ?? error),
      });
    }
  });

  fastify.put('/:id/security-policy', {
    preHandler: [requireV2Scopes(['security:write'])],
    attachValidation: true,
    schema: {
      tags: ['v2 SecurityPolicy'],
      summary: 'Update security policy for endpoint',
      body: securityPolicySchema,
      response: {
        200: v2SecurityPolicyResponseSchema,
        400: v2ErrorSchema,
        401: v2ErrorSchema,
        403: v2ErrorSchema,
        404: v2ErrorSchema,
        500: v2ErrorSchema,
      },
    },
  }, async (request: any, reply) => {
    try {
      if (request.validationError) {
        return v2Error(request, reply, 400, {
          code: V2_ERROR_CODES.VALIDATION_ERROR,
          message: 'Invalid security policy',
          details: getValidationErrorDetails(request),
        });
      }

      const id = request.params?.id as string;
      const parsed = securityPolicySchema.safeParse(request.body);
      if (!parsed.success) {
        return v2Error(request, reply, 400, {
          code: V2_ERROR_CODES.VALIDATION_ERROR,
          message: 'Invalid security policy',
          details: parsed.error.flatten(),
        });
      }

      const workspaceWhere = getWorkspaceWhere(request);
      if (!workspaceWhere) {
        return v2Error(request, reply, 400, { code: V2_ERROR_CODES.TEAM_CONTEXT_REQUIRED, message: 'teamId is required' });
      }

      const endpoint = await prisma.endpoint.findFirst({ where: { id, ...workspaceWhere } });
      if (!endpoint) {
        return v2Error(request, reply, 404, { code: V2_ERROR_CODES.NOT_FOUND, message: 'Endpoint not found' });
      }

      const updated = await prisma.endpoint.update({
        where: { id: endpoint.id },
        data: {
          settings: {
            ...(endpoint.settings as any),
            securityPolicy: parsed.data,
          },
        },
      });

      await emitSecurityAuditEvent(securityAuditContextFromRequest(request, {
        action: 'ENDPOINT_SECURITY_POLICY_UPDATED',
        targetType: 'Endpoint',
        targetId: updated.id,
        result: 'SUCCESS',
        metadata: { teamId: updated.teamId ?? null },
      }));

      const policy = securityPolicySchema.parse((updated.settings as any)?.securityPolicy ?? {});
      const effectivePolicy = resolveEffectiveSecurityPolicy(updated.settings, updated.teamId ?? null);

      return v2Success(reply, {
        endpointId: updated.id,
        securityPolicy: policy,
        effectivePolicy,
        featureFlags: {
          ipAllowlist: Boolean(process.env.FEATURE_IP_ALLOWLIST),
          headerMasking: Boolean(process.env.FEATURE_HEADER_MASKING),
        },
      });
    } catch (error: unknown) {
      return v2Error(request, reply, 500, {
        code: V2_ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to update security policy',
        details: String((error as Error)?.message ?? error),
      });
    }
  });
};
