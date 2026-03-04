import crypto from 'crypto';
import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { authenticateApiKey, getAuthenticatedUser } from '../middleware/auth.middleware.js';

export async function teamRoutes(fastify: FastifyInstance) {
    async function createInvite(teamId: string, userId: string, email: string, role: string) {
        const member = await prisma.teamMember.findUnique({
            where: { userId_teamId: { userId, teamId } }
        });

        if (!member || !['OWNER', 'ADMIN'].includes(member.role)) {
            return { status: 403, body: { error: 'Only owners and admins can create invites' } };
        }

        if (!email || typeof email !== 'string') {
            return { status: 400, body: { error: 'Invite email is required' } };
        }

        const inviteRole: 'ADMIN' | 'MEMBER' | 'VIEWER' =
            typeof role === 'string' && ['ADMIN', 'MEMBER', 'VIEWER'].includes(role)
                ? (role as 'ADMIN' | 'MEMBER' | 'VIEWER')
                : 'MEMBER';
        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7);

        const invite = await prisma.teamInvite.create({
            data: {
                token,
                teamId,
                email,
                role: inviteRole,
                createdById: userId,
                expiresAt
            }
        });

        return {
            status: 200,
            body: {
                token: invite.token,
                inviteUrl: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/join/${invite.token}`
            }
        };
    }

    // ============================================
    // CREATE TEAM
    // ============================================
    fastify.post('/', {
        preHandler: [authenticateApiKey]
    }, async (request: any, reply) => {
        const { name, slug } = request.body ?? {};
        const user = getAuthenticatedUser(request);
        const normalizedName = typeof name === 'string' ? name.trim() : '';
        const normalizedSlug = typeof slug === 'string' ? slug.trim().toLowerCase() : '';

        if (!normalizedName || !normalizedSlug) {
            return reply.code(400).send({ error: 'Name and slug are required' });
        }
        if (normalizedName.length < 2 || normalizedName.length > 80) {
            return reply.code(400).send({ error: 'Team name must be 2-80 characters long' });
        }
        if (!/^[a-z0-9-]{3,50}$/.test(normalizedSlug)) {
            return reply.code(400).send({ error: 'Slug must be 3-50 chars, lowercase letters, numbers, and hyphens only' });
        }

        try {
            const team = await prisma.$transaction(async (tx) => {
                // Create the team
                const newTeam = await tx.team.create({
                    data: {
                        name: normalizedName,
                        slug: normalizedSlug,
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
        const memberships = await prisma.teamMember.findMany({
            where: { userId: user.id },
            include: {
                team: {
                    include: {
                        _count: { select: { members: true, endpoints: true } }
                    }
                }
            }
        });

        return memberships.map((m) => ({
            ...m.team,
            role: m.role,
        }));
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
                invites: {
                    where: {
                        acceptedAt: null,
                        expiresAt: { gt: new Date() },
                    },
                    orderBy: { createdAt: 'desc' },
                    select: {
                        id: true,
                        email: true,
                        role: true,
                        createdAt: true,
                        expiresAt: true,
                        usedCount: true,
                    },
                },
                _count: { select: { endpoints: true } }
            }
        });
        if (!team) {
            return reply.code(404).send({ error: 'Team not found' });
        }
        return {
            ...team,
            invitations: team.invites,
        };
    });

    // ============================================
    // GENERATE INVITE
    // ============================================
    fastify.post('/:teamId/invites', {
        preHandler: [authenticateApiKey]
    }, async (request: any, reply) => {
        const { teamId } = request.params;
        const { email, role } = request.body ?? {};
        const user = getAuthenticatedUser(request);
        const result = await createInvite(teamId, user.id, email, role);
        return reply.code(result.status).send(result.body);
    });

    // Backward-compatible alias used by current frontend
    fastify.post('/:teamId/invite', {
        preHandler: [authenticateApiKey]
    }, async (request: any, reply) => {
        const { teamId } = request.params;
        const { email, role } = request.body ?? {};
        const user = getAuthenticatedUser(request);
        const result = await createInvite(teamId, user.id, email, role);
        return reply.code(result.status).send(result.body);
    });

    // Update member role
    fastify.patch('/:teamId/members/:userId', {
        preHandler: [authenticateApiKey]
    }, async (request: any, reply) => {
        const { teamId, userId: targetUserId } = request.params;
        const { role } = request.body ?? {};
        const user = getAuthenticatedUser(request);

        if (!['ADMIN', 'MEMBER', 'VIEWER'].includes(role)) {
            return reply.code(400).send({ error: 'Invalid role' });
        }

        const actorMember = await prisma.teamMember.findUnique({
            where: { userId_teamId: { userId: user.id, teamId } }
        });

        if (!actorMember || !['OWNER', 'ADMIN'].includes(actorMember.role)) {
            return reply.code(403).send({ error: 'Forbidden' });
        }

        const targetMember = await prisma.teamMember.findUnique({
            where: { userId_teamId: { userId: targetUserId, teamId } }
        });

        if (!targetMember) {
            return reply.code(404).send({ error: 'Member not found' });
        }
        if (targetMember.role === 'OWNER') {
            return reply.code(400).send({ error: 'Cannot change owner role' });
        }

        await prisma.teamMember.update({
            where: { id: targetMember.id },
            data: { role }
        });

        return { success: true };
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
