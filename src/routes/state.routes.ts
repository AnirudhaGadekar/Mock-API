/**
 * Stateful mocking APIs - store/retrieve state per endpoint
 */
import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../lib/db.js';
import { authenticateApiKey, getAuthenticatedUser } from '../middleware/auth.middleware.js';
import { deleteState, getState, listStateKeys, setState } from '../lib/state.js';

export const stateRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', authenticateApiKey);

  /**
   * GET /api/v1/state/:endpointId/:key
   * Get state value
   */
  fastify.get<{ Params: { endpointId: string; key: string } }>('/:endpointId/:key', async (request, reply) => {
    const user = getAuthenticatedUser(request);
    const { endpointId, key } = request.params;

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

    const value = await getState(endpointId, key);
    return reply.send({
      success: true,
      key,
      value,
      timestamp: new Date().toISOString(),
    });
  });

  /**
   * POST /api/v1/state/:endpointId/:key
   * Set state value
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
      const user = getAuthenticatedUser(request);
      const { endpointId, key } = request.params;
      const { value } = request.body;

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

      await setState(endpointId, key, value);
      return reply.status(200).send({
        success: true,
        key,
        message: 'State updated',
        timestamp: new Date().toISOString(),
      });
    }
  );

  /**
   * DELETE /api/v1/state/:endpointId/:key
   * Delete state value
   */
  fastify.delete<{ Params: { endpointId: string; key: string } }>('/:endpointId/:key', async (request, reply) => {
    const user = getAuthenticatedUser(request);
    const { endpointId, key } = request.params;

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

    await deleteState(endpointId, key);
    return reply.status(200).send({
      success: true,
      key,
      message: 'State deleted',
      timestamp: new Date().toISOString(),
    });
  });

  /**
   * GET /api/v1/state/:endpointId
   * List all state keys for endpoint
   */
  fastify.get<{ Params: { endpointId: string } }>('/:endpointId', async (request, reply) => {
    const user = getAuthenticatedUser(request);
    const { endpointId } = request.params;

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

    const keys = await listStateKeys(endpointId);
    return reply.send({
      success: true,
      keys,
      timestamp: new Date().toISOString(),
    });
  });
};
