/**
 * store.routes.ts — Enhanced stateful store API.
 *
 * POST   /api/v1/store/:endpointId/push     — Push item to collection
 * POST   /api/v1/store/:endpointId/get       — Get value at path
 * POST   /api/v1/store/:endpointId/set       — Set value at path
 * POST   /api/v1/store/:endpointId/list      — List/filter/sort collection
 * POST   /api/v1/store/:endpointId/count     — Count items in collection
 * POST   /api/v1/store/:endpointId/remove    — Remove value at path
 * GET    /api/v1/store/:endpointId           — Get entire store
 * DELETE /api/v1/store/:endpointId           — Clear entire store
 */
import { FastifyPluginAsync } from 'fastify';
import { statefulStore } from '../engine/stateful-store.js';
import { authenticateApiKey } from '../middleware/auth.middleware.js';

export const storeRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', authenticateApiKey);

    // Push an item to a collection
    fastify.post<{
        Params: { endpointId: string };
        Body: { collection: string; item: unknown };
    }>('/:endpointId/push', async (request, reply) => {
        const { endpointId } = request.params;
        const { collection, item } = request.body ?? {};

        if (!collection || item === undefined) {
            return reply.status(400).send({
                success: false,
                error: { code: 'BAD_REQUEST', message: 'collection and item are required' },
            });
        }

        const result = await statefulStore.push(endpointId, collection, item);
        return reply.send({
            success: true,
            result,
            timestamp: new Date().toISOString(),
        });
    });

    // Get a value at a path
    fastify.post<{
        Params: { endpointId: string };
        Body: { path: string };
    }>('/:endpointId/get', async (request, reply) => {
        const { endpointId } = request.params;
        const { path } = request.body ?? {};

        if (!path) {
            return reply.status(400).send({
                success: false,
                error: { code: 'BAD_REQUEST', message: 'path is required' },
            });
        }

        const value = await statefulStore.get(endpointId, path);
        return reply.send({
            success: true,
            value,
            timestamp: new Date().toISOString(),
        });
    });

    // Set a value at a path
    fastify.post<{
        Params: { endpointId: string };
        Body: { path: string; value: unknown };
    }>('/:endpointId/set', async (request, reply) => {
        const { endpointId } = request.params;
        const { path, value } = request.body ?? {};

        if (!path) {
            return reply.status(400).send({
                success: false,
                error: { code: 'BAD_REQUEST', message: 'path is required' },
            });
        }

        await statefulStore.set(endpointId, path, value);
        return reply.send({
            success: true,
            message: `Set ${path}`,
            timestamp: new Date().toISOString(),
        });
    });

    // List collection with filter/sort/pagination
    fastify.post<{
        Params: { endpointId: string };
        Body: { collection: string; filter?: string; sort?: string; limit?: number; offset?: number };
    }>('/:endpointId/list', async (request, reply) => {
        const { endpointId } = request.params;
        const { collection, filter, sort, limit, offset } = request.body ?? {};

        if (!collection) {
            return reply.status(400).send({
                success: false,
                error: { code: 'BAD_REQUEST', message: 'collection is required' },
            });
        }

        const result = await statefulStore.list(endpointId, collection, { filter, sort, limit, offset });
        return reply.send({
            success: true,
            ...result,
            timestamp: new Date().toISOString(),
        });
    });

    // Count items in collection
    fastify.post<{
        Params: { endpointId: string };
        Body: { collection: string; filter?: string };
    }>('/:endpointId/count', async (request, reply) => {
        const { endpointId } = request.params;
        const { collection, filter } = request.body ?? {};

        if (!collection) {
            return reply.status(400).send({
                success: false,
                error: { code: 'BAD_REQUEST', message: 'collection is required' },
            });
        }

        const count = await statefulStore.count(endpointId, collection, filter);
        return reply.send({
            success: true,
            count,
            timestamp: new Date().toISOString(),
        });
    });

    // Remove value at path
    fastify.post<{
        Params: { endpointId: string };
        Body: { path: string };
    }>('/:endpointId/remove', async (request, reply) => {
        const { endpointId } = request.params;
        const { path } = request.body ?? {};

        if (!path) {
            return reply.status(400).send({
                success: false,
                error: { code: 'BAD_REQUEST', message: 'path is required' },
            });
        }

        const deleted = await statefulStore.remove(endpointId, path);
        return reply.send({
            success: true,
            deleted,
            timestamp: new Date().toISOString(),
        });
    });

    // Get entire store
    fastify.get<{ Params: { endpointId: string } }>('/:endpointId', async (request, reply) => {
        const { endpointId } = request.params;
        const store = await statefulStore.getAll(endpointId);
        return reply.send({
            success: true,
            store,
            timestamp: new Date().toISOString(),
        });
    });

    // Clear entire store
    fastify.delete<{ Params: { endpointId: string } }>('/:endpointId', async (request, reply) => {
        const { endpointId } = request.params;
        await statefulStore.clear(endpointId);
        return reply.send({
            success: true,
            message: 'Store cleared',
            timestamp: new Date().toISOString(),
        });
    });
};
