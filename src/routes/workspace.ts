import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { authenticateApiKey, extractApiKey, invalidateUserCache } from '../middleware/auth.middleware.js';

export async function workspaceRoutes(fastify: FastifyInstance) {

    // ============================================
    // SWITCH WORKSPACE
    // ============================================
    fastify.post('/switch', {
        preHandler: [authenticateApiKey]
    }, async (request: any, reply) => {
        const { type, teamId } = request.body ?? {}; // type: 'personal' | 'team'
        const userId = request.user.id;

        if (!['personal', 'team'].includes(type)) {
            return reply.code(400).send({ error: 'Invalid workspace type' });
        }

        if (type === 'team' && (!teamId || typeof teamId !== 'string')) {
            return reply.code(400).send({ error: 'Team ID required for team workspace' });
        }

        try {
            if (type === 'team') {
                const member = await prisma.teamMember.findUnique({
                    where: {
                        userId_teamId: { userId, teamId }
                    }
                });

                if (!member) {
                    return reply.code(403).send({ error: 'Not a member of this team' });
                }
            }

            await prisma.user.update({
                where: { id: userId },
                data: {
                    currentWorkspaceType: type.toUpperCase(),
                    currentTeamId: type === 'team' ? teamId : null
                }
            });

            // Clear cache for current session
            const apiKey = extractApiKey(request);
            if (apiKey) {
                await invalidateUserCache(apiKey);
            }

            return {
                success: true,
                workspace: {
                    type,
                    teamId: type === 'team' ? teamId : null
                }
            };
        } catch (error) {
            logger.error('Failed to switch workspace', { error });
            return reply.code(500).send({ error: 'Failed to switch workspace' });
        }
    });

    // ============================================
    // GET CURRENT WORKSPACE
    // ============================================
    fastify.get('/current', {
        preHandler: [authenticateApiKey]
    }, async (request: any, reply) => {
        const userId = request.user.id;
        try {
            const user = await prisma.user.findUnique({
                where: { id: userId },
                select: {
                    currentWorkspaceType: true,
                    currentTeamId: true
                }
            });

            return {
                type: user!.currentWorkspaceType.toLowerCase(),
                teamId: user!.currentTeamId
            };
        } catch (error) {
            logger.error('Failed to get workspace', { error });
            return reply.code(500).send({ error: 'Failed to get workspace' });
        }
    });
}
