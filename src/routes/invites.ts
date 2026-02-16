import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { authenticateApiKey, getAuthenticatedUser } from '../middleware/auth.middleware.js';

export async function inviteRoutes(fastify: FastifyInstance) {

    // ============================================
    // VALIDATE INVITE TOKEN
    // ============================================
    fastify.get('/:token', async (request: any, reply) => {
        const { token } = request.params;

        try {
            const invite = await prisma.teamInvite.findUnique({
                where: { token },
                include: {
                    team: { select: { id: true, name: true, slug: true } },
                    createdBy: { select: { id: true, email: true, name: true } }
                }
            });

            if (!invite) {
                return reply.code(404).send({ error: 'Invitation not found or invalid' });
            }

            if (invite.expiresAt < new Date()) {
                return reply.code(410).send({ error: 'Invitation has expired' });
            }

            if (invite.maxUses && invite.usedCount >= invite.maxUses) {
                return reply.code(410).send({ error: 'Invitation has reached maximum usage' });
            }

            return {
                team: invite.team,
                invitedBy: invite.createdBy,
                expiresAt: invite.expiresAt
            };
        } catch (error) {
            logger.error('Failed to validate invite', { error });
            return reply.code(500).send({ error: 'Failed to validate invitation' });
        }
    });

    // ============================================
    // ACCEPT INVITE
    // ============================================
    fastify.post('/:token/accept', {
        preHandler: [authenticateApiKey]
    }, async (request: any, reply) => {
        const { token } = request.params;
        const user = getAuthenticatedUser(request);

        try {
            const invite = await prisma.teamInvite.findUnique({
                where: { token }
            });

            if (!invite) {
                return reply.code(404).send({ error: 'Invalid invitation' });
            }

            if (invite.expiresAt < new Date()) {
                return reply.code(410).send({ error: 'Invitation expired' });
            }

            // Check if user is already a member
            const existingMember = await prisma.teamMember.findUnique({
                where: {
                    userId_teamId: {
                        userId: user.id,
                        teamId: invite.teamId
                    }
                }
            });

            if (existingMember) {
                return reply.code(400).send({ error: 'You are already a member of this team' });
            }

            // Add member and increment invite usage
            await prisma.$transaction([
                prisma.teamMember.create({
                    data: {
                        teamId: invite.teamId,
                        userId: user.id,
                        role: 'MEMBER'
                    }
                }),
                prisma.teamInvite.update({
                    where: { id: invite.id },
                    data: { usedCount: { increment: 1 } }
                })
            ]);

            logger.info('User joined team via invite', { userId: user.id, teamId: invite.teamId });

            return { success: true, teamId: invite.teamId };
        } catch (error) {
            logger.error('Failed to accept invite', { error });
            return reply.code(500).send({ error: 'Failed to join team' });
        }
    });
}
