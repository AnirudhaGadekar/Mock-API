import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/db.js';
import { emitSecurityAuditEvent, securityAuditContextFromRequest } from '../../lib/security-audit.js';
import { V2_ERROR_CODES } from '../../lib/v2-error-codes.js';
import { v2Error, v2Success } from '../../lib/v2-response.js';
import { authenticateV2ApiKey, requireV2Scopes } from '../../middleware/auth-v2.middleware.js';

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

const recorderProposalSchema = z.object({
  id: z.string(),
  recorderSessionId: z.string(),
  endpointId: z.string(),
  method: z.string(),
  normalizedPath: z.string(),
  responseStatus: z.number(),
  count: z.number(),
  confidence: z.number(),
  status: z.string(),
  createdAt: z.string(),
  decidedAt: z.string().nullable(),
  metadata: z.object({
    workspaceId: z.string(),
  }),
  proposedRule: z.unknown(),
  sample: z.unknown().optional(),
});

const listProposalsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().datetime().optional(),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
});

const listProposalsResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    proposals: z.array(recorderProposalSchema),
    nextCursor: z.string().datetime().nullable(),
    hasMore: z.boolean(),
  }),
  timestamp: z.string(),
});

const approveProposalBodySchema = z.object({
  mode: z.enum(['append', 'replace']).default('append'),
});

export const v2RecorderRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', authenticateV2ApiKey);

  // Simple health endpoint for Recorder feature
  fastify.get('/', {
    preHandler: [requireV2Scopes(['traffic:read'])],
    schema: {
      tags: ['v2 Recorder'],
      summary: 'Recorder feature status',
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({
            enabled: z.literal(true),
          }),
          timestamp: z.string(),
        }),
      },
    },
  }, async (_request, reply) => {
    return v2Success(reply, { enabled: true });
  });

  // List proposals for a given recorder session, with cursor-based pagination
  fastify.get('/:id/proposals', {
    preHandler: [requireV2Scopes(['traffic:read'])],
    schema: {
      tags: ['v2 Recorder'],
      summary: 'List rule proposals for a recorder session',
      params: z.object({ id: z.string() }),
      querystring: listProposalsQuerySchema,
      response: {
        200: listProposalsResponseSchema,
        400: v2ErrorSchema,
        401: v2ErrorSchema,
        403: v2ErrorSchema,
        404: v2ErrorSchema,
        500: v2ErrorSchema,
      },
    },
  }, async (request: any, reply) => {
    try {
      const sessionId = String(request.params?.id ?? '');
      if (!sessionId) {
        return v2Error(request, reply, 400, {
          code: V2_ERROR_CODES.VALIDATION_ERROR,
          message: 'Missing recorderSession id',
        });
      }

      const parsedQuery = listProposalsQuerySchema.safeParse(request.query);
      if (!parsedQuery.success) {
        return v2Error(request, reply, 400, {
          code: V2_ERROR_CODES.VALIDATION_ERROR,
          message: 'Invalid query',
          details: parsedQuery.error.flatten(),
        });
      }
      const { limit, cursor, status } = parsedQuery.data;

      // Ensure session exists (scoped by workspace where possible)
      const session = await prisma.recorderSession.findUnique({
        where: { id: sessionId },
        include: { workspace: true },
      });
      if (!session) {
        return v2Error(request, reply, 404, {
          code: V2_ERROR_CODES.NOT_FOUND,
          message: 'Recorder session not found',
        });
      }

      const where: any = { recorderSessionId: sessionId };
      if (status) {
        where.status = status;
      }
      if (cursor) {
        const cursorDate = new Date(cursor);
        if (!Number.isFinite(cursorDate.getTime())) {
          return v2Error(request, reply, 400, {
            code: V2_ERROR_CODES.VALIDATION_ERROR,
            message: 'Invalid cursor',
          });
        }
        where.createdAt = { lt: cursorDate };
      }

      const rows = await prisma.recorderProposal.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit + 1,
      });

      const hasMore = rows.length > limit;
      const pageRows = hasMore ? rows.slice(0, limit) : rows;
      const nextCursor = hasMore ? pageRows[pageRows.length - 1]!.createdAt.toISOString() : null;

      const proposals = pageRows.map((row) => ({
        id: row.id,
        recorderSessionId: row.recorderSessionId,
        endpointId: row.endpointId,
        method: row.method,
        normalizedPath: row.normalizedPath,
        responseStatus: row.responseStatus,
        count: row.count,
        confidence: row.confidence,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
        decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
        metadata: {
          workspaceId: row.workspaceId,
        },
        proposedRule: row.proposedRule,
        sample: row.sample,
      }));

      return v2Success(reply, {
        proposals,
        nextCursor,
        hasMore,
      });
    } catch (error: unknown) {
      return v2Error(request, reply, 500, {
        code: V2_ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to list recorder proposals',
        details: String((error as Error)?.message ?? error),
      });
    }
  });

  // Approve a specific proposal and write its rule into Endpoint.rules
  fastify.post('/:id/proposals/:proposalId/approve', {
    preHandler: [requireV2Scopes(['endpoints:write'])],
    schema: {
      tags: ['v2 Recorder'],
      summary: 'Approve a recorder proposal and publish rule',
      params: z.object({ id: z.string(), proposalId: z.string() }),
      body: approveProposalBodySchema,
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({
            endpointId: z.string(),
            proposalId: z.string(),
            mode: z.enum(['append', 'replace']),
          }),
          timestamp: z.string(),
        }),
        400: v2ErrorSchema,
        401: v2ErrorSchema,
        403: v2ErrorSchema,
        404: v2ErrorSchema,
        500: v2ErrorSchema,
      },
    },
  }, async (request: any, reply) => {
    try {
      const sessionId = String(request.params?.id ?? '');
      const proposalId = String(request.params?.proposalId ?? '');
      if (!sessionId || !proposalId) {
        return v2Error(request, reply, 400, {
          code: V2_ERROR_CODES.VALIDATION_ERROR,
          message: 'Missing recorderSession id or proposalId',
        });
      }

      const bodyParsed = approveProposalBodySchema.safeParse(request.body ?? {});
      if (!bodyParsed.success) {
        return v2Error(request, reply, 400, {
          code: V2_ERROR_CODES.VALIDATION_ERROR,
          message: 'Invalid body',
          details: bodyParsed.error.flatten(),
        });
      }
      const mode = bodyParsed.data.mode;

      // Ensure proposal exists and belongs to this session
      const proposal = await (prisma as any).recorderProposal.findFirst({
        where: { id: proposalId, recorderSessionId: sessionId },
      });
      if (!proposal) {
        return v2Error(request, reply, 404, {
          code: V2_ERROR_CODES.NOT_FOUND,
          message: 'Recorder proposal not found',
        });
      }

      // Load endpoint
      const endpoint = await (prisma as any).endpoint.findUnique({
        where: { id: proposal.endpointId },
      });
      if (!endpoint) {
        return v2Error(request, reply, 404, {
          code: V2_ERROR_CODES.NOT_FOUND,
          message: 'Endpoint not found for proposal',
        });
      }

      const existingRules = Array.isArray(endpoint.rules) ? (endpoint.rules as any[]) : [];
      const proposedRule = proposal.proposedRule as any;
      const nextRules = mode === 'replace'
        ? [proposedRule]
        : [...existingRules, proposedRule];

      const txClient = prisma as any;
      const [updatedEndpoint] = await txClient.$transaction([
        txClient.endpoint.update({
          where: { id: endpoint.id },
          data: { rules: nextRules },
        }),
        txClient.recorderProposal.update({
          where: { id: proposal.id },
          data: {
            status: 'APPROVED',
            decidedAt: new Date(),
            decidedByUserId: (request as any).user?.id ?? null,
          },
        }),
      ]);

      await emitSecurityAuditEvent(securityAuditContextFromRequest(request, {
        action: 'RECORDER_PROPOSAL_APPROVED',
        targetType: 'Endpoint',
        targetId: endpoint.id,
        result: 'SUCCESS',
        metadata: {
          recorderSessionId: sessionId,
          proposalId: proposal.id,
          mode,
        },
      }));

      return v2Success(reply, {
        endpointId: updatedEndpoint.id,
        proposalId: proposal.id,
        mode,
      });
    } catch (error: unknown) {
      return v2Error(request, reply, 500, {
        code: V2_ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to approve recorder proposal',
        details: String((error as Error)?.message ?? error),
      });
    }
  });
};

