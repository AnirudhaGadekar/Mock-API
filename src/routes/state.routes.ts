/**
 * Stateful mocking APIs - store/retrieve state per endpoint.
 *
 * Changes vs original:
 * - Zod validation on all params (endpointId as UUID, key format/length)
 * - Zod validation on POST body (value size + serializability)
 * - Errors from state.ts are now caught and returned as proper HTTP responses
 * - Consistent error shape across all routes
 */
import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { deleteState, getState, listStateKeys, setState } from '../lib/state.js';
import { authenticateApiKey, getAuthenticatedUser } from '../middleware/auth.middleware.js';

// ─── Validation Schemas ───────────────────────────────────────────────────────

const endpointIdSchema = z
  .string()
  .uuid('endpointId must be a valid UUID');

const stateKeySchema = z
  .string()
  .min(1, 'State key is required')
  .max(100, 'State key too long — max 100 characters')
  .regex(
    /^[a-zA-Z0-9-_:.]+$/,
    'Invalid state key — allowed characters: a-z, A-Z, 0-9, -, _, :, .',
  );

const stateValueSchema = z.unknown().superRefine((val, ctx) => {
  let serialized: string;
  try {
    serialized = JSON.stringify(val);
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Value must be JSON-serializable' });
    return;
  }
  if (serialized.length > 100 * 1024) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Value too large — max 100KB',
    });
  }
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function validationError(reply: any, message: string, details?: unknown) {
  return reply.status(400).send({
    success: false,
    error: { code: 'VALIDATION_ERROR', message, details },
    timestamp: new Date().toISOString(),
  });
}

function notFoundError(reply: any) {
  return reply.status(404).send({
    success: false,
    error: { code: 'NOT_FOUND', message: 'Endpoint not found' },
    timestamp: new Date().toISOString(),
  });
}

function internalError(reply: any, message = 'Internal server error') {
  return reply.status(500).send({
    success: false,
    error: { code: 'INTERNAL_ERROR', message },
    timestamp: new Date().toISOString(),
  });
}

// ─── Route Plugin ─────────────────────────────────────────────────────────────

export const stateRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', authenticateApiKey);

  /**
   * GET /api/v1/state/:endpointId/:key
   * Get a single state value.
   */
  fastify.get<{ Params: { endpointId: string; key: string } }>(
    '/:endpointId/:key',
    async (request, reply) => {
      // Validate params
      const endpointIdResult = endpointIdSchema.safeParse(request.params.endpointId);
      if (!endpointIdResult.success) {
        return validationError(reply, endpointIdResult.error.errors[0].message);
      }

      const keyResult = stateKeySchema.safeParse(request.params.key);
      if (!keyResult.success) {
        return validationError(reply, keyResult.error.errors[0].message);
      }

      const user = getAuthenticatedUser(request);
      const { endpointId, key } = request.params;

      const endpoint = await prisma.endpoint.findFirst({
        where: { id: endpointId, userId: user.id, deletedAt: null },
      });
      if (!endpoint) return notFoundError(reply);

      try {
        const value = await getState(endpointId, key);
        return reply.status(200).send({
          success: true,
          key,
          value,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Failed to get state';
        return internalError(reply, msg);
      }
    },
  );

  /**
   * POST /api/v1/state/:endpointId/:key
   * Set a state value.
   */
  fastify.post<{ Params: { endpointId: string; key: string }; Body: { value: unknown } }>(
    '/:endpointId/:key',
    {
      schema: {
        body: {
          type: 'object',
          required: ['value'],
          properties: {
            value: {},
          },
        },
      },
    },
    async (request, reply) => {
      // Validate params
      const endpointIdResult = endpointIdSchema.safeParse(request.params.endpointId);
      if (!endpointIdResult.success) {
        return validationError(reply, endpointIdResult.error.errors[0].message);
      }

      const keyResult = stateKeySchema.safeParse(request.params.key);
      if (!keyResult.success) {
        return validationError(reply, keyResult.error.errors[0].message);
      }

      // Validate value
      const valueResult = stateValueSchema.safeParse(request.body.value);
      if (!valueResult.success) {
        return validationError(reply, valueResult.error.errors[0].message);
      }

      const user = getAuthenticatedUser(request);
      const { endpointId, key } = request.params;
      const { value } = request.body;

      const endpoint = await prisma.endpoint.findFirst({
        where: { id: endpointId, userId: user.id, deletedAt: null },
      });
      if (!endpoint) return notFoundError(reply);

      try {
        await setState(endpointId, key, value);
        return reply.status(200).send({
          success: true,
          key,
          message: 'State updated',
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Failed to set state';
        // Re-surface validation errors from state.ts as 400
        if (error instanceof Error && msg.startsWith('Invalid') || msg.includes('too large') || msg.includes('too long')) {
          return validationError(reply, msg);
        }
        return internalError(reply, msg);
      }
    },
  );

  /**
   * DELETE /api/v1/state/:endpointId/:key
   * Delete a state value.
   */
  fastify.delete<{ Params: { endpointId: string; key: string } }>(
    '/:endpointId/:key',
    async (request, reply) => {
      // Validate params
      const endpointIdResult = endpointIdSchema.safeParse(request.params.endpointId);
      if (!endpointIdResult.success) {
        return validationError(reply, endpointIdResult.error.errors[0].message);
      }

      const keyResult = stateKeySchema.safeParse(request.params.key);
      if (!keyResult.success) {
        return validationError(reply, keyResult.error.errors[0].message);
      }

      const user = getAuthenticatedUser(request);
      const { endpointId, key } = request.params;

      const endpoint = await prisma.endpoint.findFirst({
        where: { id: endpointId, userId: user.id, deletedAt: null },
      });
      if (!endpoint) return notFoundError(reply);

      try {
        await deleteState(endpointId, key);
        return reply.status(200).send({
          success: true,
          key,
          message: 'State deleted',
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Failed to delete state';
        return internalError(reply, msg);
      }
    },
  );

  /**
   * GET /api/v1/state/:endpointId
   * List all state keys for an endpoint.
   */
  fastify.get<{ Params: { endpointId: string } }>(
    '/:endpointId',
    async (request, reply) => {
      // Validate params
      const endpointIdResult = endpointIdSchema.safeParse(request.params.endpointId);
      if (!endpointIdResult.success) {
        return validationError(reply, endpointIdResult.error.errors[0].message);
      }

      const user = getAuthenticatedUser(request);
      const { endpointId } = request.params;

      const endpoint = await prisma.endpoint.findFirst({
        where: { id: endpointId, userId: user.id, deletedAt: null },
      });
      if (!endpoint) return notFoundError(reply);

      try {
        const keys = await listStateKeys(endpointId);
        return reply.status(200).send({
          success: true,
          keys,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Failed to list state keys';
        return internalError(reply, msg);
      }
    },
  );
};