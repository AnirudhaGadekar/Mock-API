import crypto from 'crypto';
import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { authenticateApiKey, getAuthenticatedUser } from '../middleware/auth.middleware.js';

export async function teamRoutes(fastify: FastifyInstance) {

    // ============================================
    // CREATE TEAM
    // ============================================
    fastify.post('/', {
        preHandler: [authenticateApiKey]
    }, async (request: any, reply) => {
        const { name, slug } = request.body;
        const user = getAuthenticatedUser(request);

        if (!name || !slug) {
            return reply.code(400).send({ error: 'Name and slug are required' });
        }

        try {
            const team = await prisma.$transaction(async (tx) => {
                // Create the team
                const newTeam = await tx.team.create({
                    data: {
                        name,
                        slug,
                        ownerId: user.id
                    }
                });

                // Add creator as OWNER
                await tx.teamMember.create({
                    data: {
                        teamId: newTeam.id,
                        userId: user.id,
                        role: 'OWNER'
                    }
                });

                return newTeam;
            });

            return team;
        } catch (error: any) {
            if (error.code === 'P2002') {
                return reply.code(409).send({ error: 'Team slug already exists' });
            }
            logger.error('Failed to create team', { error });
            return reply.code(500).send({ error: 'Failed to create team' });
        }
    });

    // ============================================
    // LIST MY TEAMS
    // ============================================
    fastify.get('/', {
        preHandler: [authenticateApiKey]
    }, async (request: any, _reply) => {
        const user = getAuthenticatedUser(request);

        const teams = await prisma.team.findMany({
            where: {
                members: {
                    some: { userId: user.id }
                }
            },
            include: {
                _count: { select: { members: true, endpoints: true } }
            }
        });

        return teams;
    });

    // ============================================
    // GET TEAM DETAILS
    // ============================================
    fastify.get('/:teamId', {
        preHandler: [authenticateApiKey]
    }, async (request: any, reply) => {
        const { teamId } = request.params;
        const user = getAuthenticatedUser(request);

        const member = await prisma.teamMember.findUnique({
            where: { userId_teamId: { userId: user.id, teamId } }
        });

        if (!member) {
            return reply.code(403).send({ error: 'Forbidden: Not a member of this team' });
        }

        const team = await prisma.team.findUnique({
            where: { id: teamId },
            include: {
                members: { include: { user: { select: { id: true, email: true, name: true, picture: true } } } },
                _count: { select: { endpoints: true } }
            }
        });

        return team;
    });

    // ============================================
    // GENERATE INVITE
    // ============================================
    fastify.post('/:teamId/invites', {
        preHandler: [authenticateApiKey]
    }, async (request: any, reply) => {
        const { teamId } = request.params;
        const user = getAuthenticatedUser(request);

        // Check if user is OWNER or ADMIN
        const member = await prisma.teamMember.findUnique({
            where: { userId_teamId: { userId: user.id, teamId } }
        });

        if (!member || !['OWNER', 'ADMIN'].includes(member.role)) {
            return reply.code(403).send({ error: 'Only owners and admins can create invites' });
        }

        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7); // 7 days expiry

        const invite = await prisma.teamInvite.create({
            data: {
                token,
                teamId,
                email: 'invited@mockurl.local', // Placeholder or add to request body
                createdById: user.id,
                expiresAt
            }
        });

        return {
            token: invite.token,
            inviteUrl: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/join/${invite.token}`
        };
    });

    // ============================================
    // REMOVE MEMBER
    // ============================================
    fastify.delete('/:teamId/members/:userId', {
        preHandler: [authenticateApiKey]
    }, async (request: any, reply) => {
        const { teamId, userId: targetUserId } = request.params;
        const user = getAuthenticatedUser(request);

        const actorMember = await prisma.teamMember.findUnique({
            where: { userId_teamId: { userId: user.id, teamId } }
        });

        if (!actorMember || !['OWNER', 'ADMIN'].includes(actorMember.role)) {
            return reply.code(403).send({ error: 'Forbidden' });
        }

        const targetMember = await prisma.teamMember.findUnique({
            where: { userId_teamId: { userId: targetUserId, teamId } }
        });

        if (!targetMember) return reply.code(404).send({ error: 'Member not found' });

        // Cannot remove owner
        if (targetMember.role === 'OWNER') {
            return reply.code(400).send({ error: 'Cannot remove the team owner' });
        }

        await prisma.teamMember.delete({
            where: { id: targetMember.id }
        });

        return { success: true };
    });

    // ============================================
    // DELETE TEAM
    // ============================================
    fastify.delete('/:teamId', {
        preHandler: [authenticateApiKey]
    }, async (request: any, reply) => {
        const { teamId } = request.params;
        const user = getAuthenticatedUser(request);

        const team = await prisma.team.findUnique({ where: { id: teamId } });
        if (!team) return reply.code(404).send({ error: 'Team not found' });

        if (team.ownerId !== user.id) {
            return reply.code(403).send({ error: 'Only the team owner can delete the team' });
        }

        await prisma.team.delete({ where: { id: teamId } });

        return { success: true };
    });
}
