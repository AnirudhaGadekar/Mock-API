/**
 * GET /api/v2/user/me – current user (auth required)
 */
import { FastifyPluginAsync } from 'fastify';
import { authenticateApiKey, getAuthenticatedUser } from '../middleware/auth.middleware.js';

export const userRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', authenticateApiKey);

  fastify.get('/me', async (request, reply) => {
    const user = getAuthenticatedUser(request);
    return reply.send({
      success: true,
      user: {
        id: user.id,
        email: user.email,
      },
      timestamp: new Date().toISOString(),
    });
  });
};
