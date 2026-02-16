import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticateApiKey } from '../middleware/auth.middleware.js';
import { teamService } from '../services/team.service.js';

export async function teamRoutes(fastify: FastifyInstance) {
    // Apply authentication to all routes
    fastify.addHook('preHandler', authenticateApiKey);

    // POST /api/teams - Create Team
    fastify.post('/', {
        schema: {
            body: z.object({
                name: z.string().min(1),
                slug: z.string().min(3).regex(/^[a-z0-9-]+$/),
            }),
        },
    }, async (request, reply) => {
        // @ts-ignore
        const { name, slug } = request.body;
        // @ts-ignore
        const team = await teamService.createTeam(name, slug, request.user.id);
        return reply.status(201).send(team);
    });

    // GET /api/teams - List User's Teams
    fastify.get('/', async (request) => {
        // @ts-ignore
        return teamService.getUserTeams(request.user.id);
    });

    // GET /api/teams/:teamId - Get Team Details
    fastify.get('/:teamId', async (request) => {
        // @ts-ignore
        return teamService.getTeamDetails((request.params as any).teamId, request.user.id);
    });

    // POST /api/teams/:teamId/invite - Invite Member
    fastify.post('/:teamId/invite', {
        schema: {
            body: z.object({
                email: z.string().email(),
                role: z.enum(['ADMIN', 'MEMBER', 'VIEWER']),
            }),
        },
    }, async (request, reply) => {
        // @ts-ignore
        const { email, role } = request.body;
        // @ts-ignore
        const invitation = await teamService.inviteMember((request.params as any).teamId, email, role, request.user.id);
        return reply.status(201).send(invitation);
    });

    // POST /api/teams/invitations/:token/accept - Accept Invite
    fastify.post('/invitations/:token/accept', async (request) => {
        // @ts-ignore
        await teamService.acceptInvitation((request.params as any).token, request.user.id);
        return { ok: true };
    });

    // PATCH /api/teams/:teamId/members/:userId - Update Member Role
    fastify.patch('/:teamId/members/:userId', {
        schema: {
            body: z.object({
                role: z.enum(['ADMIN', 'MEMBER', 'VIEWER']),
            }),
        },
    }, async (request) => {
        // @ts-ignore
        const { role } = request.body;
        // @ts-ignore
        const { teamId, userId } = request.params as any;
        // @ts-ignore
        await teamService.updateMemberRole(teamId, userId, role, request.user.id);
        return { ok: true };
    });

    // DELETE /api/teams/:teamId/members/:userId - Remove Member
    fastify.delete('/:teamId/members/:userId', async (request, reply) => {
        // @ts-ignore
        const { teamId, userId } = request.params as any;
        // @ts-ignore
        await teamService.removeMember(teamId, userId, request.user.id);
        return reply.status(204).send();
    });
}
