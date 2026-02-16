/**
 * chaos.routes.ts — Configure chaos engineering per endpoint.
 *
 * GET    /api/v1/chaos/:endpointId  — Get chaos config
 * PUT    /api/v1/chaos/:endpointId  — Set/update chaos config
 * DELETE /api/v1/chaos/:endpointId  — Clear chaos config
 */
import { FastifyPluginAsync } from 'fastify';
import { ChaosConfig, clearChaosConfig, getChaosConfig, setChaosConfig } from '../engine/chaos.js';
import { prisma } from '../lib/db.js';
import { authenticateApiKey, getAuthenticatedUser } from '../middleware/auth.middleware.js';

export const chaosRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', authenticateApiKey);

    async function assertEndpointOwned(endpointId: string, userId: string) {
        const endpoint = await prisma.endpoint.findFirst({
            where: { id: endpointId, userId },
            select: { id: true },
        });
        return !!endpoint;
    }

    // Get chaos config
    fastify.get<{ Params: { endpointId: string } }>('/:endpointId', async (request, reply) => {
        const user = getAuthenticatedUser(request);
        const owned = await assertEndpointOwned(request.params.endpointId, user.id);
        if (!owned) {
            return reply.status(404).send({
                success: false,
                error: { code: 'NOT_FOUND', message: 'Endpoint not found' },
                timestamp: new Date().toISOString(),
            });
        }
        const config = await getChaosConfig(request.params.endpointId);
        return reply.send({
            success: true,
            config,
            timestamp: new Date().toISOString(),
        });
    });

    // Set/update chaos config
    fastify.put<{
        Params: { endpointId: string };
        Body: Partial<ChaosConfig>;
    }>('/:endpointId', async (request, reply) => {
        const body = request.body ?? {};

        const user = getAuthenticatedUser(request);
        const owned = await assertEndpointOwned(request.params.endpointId, user.id);
        if (!owned) {
            return reply.status(404).send({
                success: false,
                error: { code: 'NOT_FOUND', message: 'Endpoint not found' },
                timestamp: new Date().toISOString(),
            });
        }

        // Validate the config
        if (body.delay) {
            if (typeof body.delay.min !== 'number' || typeof body.delay.max !== 'number') {
                return reply.status(400).send({
                    success: false,
                    error: { code: 'BAD_REQUEST', message: 'delay requires min and max (numbers)' },
                });
            }
            if (body.delay.min < 0 || body.delay.max > 30000) {
                return reply.status(400).send({
                    success: false,
                    error: { code: 'BAD_REQUEST', message: 'delay min must be >= 0 and max <= 30000' },
                });
            }
        }

        if (body.timeout) {
            if (typeof body.timeout.probability !== 'number' || body.timeout.probability < 0 || body.timeout.probability > 1) {
                return reply.status(400).send({
                    success: false,
                    error: { code: 'BAD_REQUEST', message: 'timeout.probability must be 0-1' },
                });
            }
        }

        if (body.errorInject) {
            if (typeof body.errorInject.probability !== 'number' || body.errorInject.probability < 0 || body.errorInject.probability > 1) {
                return reply.status(400).send({
                    success: false,
                    error: { code: 'BAD_REQUEST', message: 'errorInject.probability must be 0-1' },
                });
            }
            if (typeof body.errorInject.status !== 'number' || body.errorInject.status < 400 || body.errorInject.status > 599) {
                return reply.status(400).send({
                    success: false,
                    error: { code: 'BAD_REQUEST', message: 'errorInject.status must be 400-599' },
                });
            }
        }

        if (body.rateLimit) {
            if (typeof body.rateLimit.rpm !== 'number' || body.rateLimit.rpm < 1) {
                return reply.status(400).send({
                    success: false,
                    error: { code: 'BAD_REQUEST', message: 'rateLimit.rpm must be >= 1' },
                });
            }
        }

        const config = await setChaosConfig(request.params.endpointId, body);
        return reply.send({
            success: true,
            config,
            timestamp: new Date().toISOString(),
        });
    });

    // Clear chaos config
    fastify.delete<{ Params: { endpointId: string } }>('/:endpointId', async (request, reply) => {
        const user = getAuthenticatedUser(request);
        const owned = await assertEndpointOwned(request.params.endpointId, user.id);
        if (!owned) {
            return reply.status(404).send({
                success: false,
                error: { code: 'NOT_FOUND', message: 'Endpoint not found' },
                timestamp: new Date().toISOString(),
            });
        }
        await clearChaosConfig(request.params.endpointId);
        return reply.send({
            success: true,
            message: 'Chaos config cleared',
            timestamp: new Date().toISOString(),
        });
    });
};
