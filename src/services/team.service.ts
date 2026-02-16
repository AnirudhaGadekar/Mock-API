import { TeamRole } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { prisma } from '../lib/db.js';
// import { emailService } from './email.service.js'; // TODO: Implement Email Service
import { ApiError } from '../lib/errors.js';

// Mock Email Service for now
const emailService = {
    sendTeamInvitation: async (email: string, teamName: string, inviterName: string, token: string) => {
        console.log(`[Email Mock] Sending invite to ${email} for team ${teamName} from ${inviterName}. Token: ${token}`);
    }
};

interface RolePermissions {
    canEdit: boolean;
    canInvite: boolean;
    canManageMembers: boolean;
}

const ROLE_PERMISSIONS: Record<TeamRole, RolePermissions> = {
    OWNER: { canEdit: true, canInvite: true, canManageMembers: true },
    ADMIN: { canEdit: true, canInvite: true, canManageMembers: true },
    MEMBER: { canEdit: true, canInvite: false, canManageMembers: false },
    VIEWER: { canEdit: false, canInvite: false, canManageMembers: false },
};

export const teamService = {
    async createTeam(name: string, slug: string, ownerId: string) {
        // Check slug uniqueness
        const existing = await prisma.team.findUnique({ where: { slug } });
        if (existing) {
            throw new ApiError('Team slug already exists', { statusCode: 409, code: 'CONFLICT' });
        }

        return prisma.$transaction(async (tx: any) => {
            const team = await tx.team.create({
                data: {
                    name,
                    slug,
                    ownerId,
                },
            });

            await tx.teamMember.create({
                data: {
                    teamId: team.id,
                    userId: ownerId,
                    role: 'OWNER',
                },
            });

            return team;
        });
    },

    async inviteMember(teamId: string, email: string, role: TeamRole, invitedById: string) {
        // Verify inviter permissions
        const inviter = await prisma.teamMember.findUnique({
            where: { teamId_userId: { teamId, userId: invitedById } },
            include: { user: true }
        });

        if (!inviter) throw new ApiError('Not a team member', { statusCode: 403, code: 'FORBIDDEN' });
        if (!ROLE_PERMISSIONS[inviter.role].canInvite) {
            throw new ApiError('Insufficient permissions', { statusCode: 403, code: 'FORBIDDEN' });
        }

        // Check if user is already a member
        const existingUser = await prisma.user.findUnique({ where: { email } });
        if (existingUser) {
            const alreadyMember = await prisma.teamMember.findUnique({
                where: { teamId_userId: { teamId, userId: existingUser.id } },
            });
            if (alreadyMember) throw new ApiError('User is already a team member', { statusCode: 409, code: 'CONFLICT' });
        }

        // Generate token
        const token = randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

        const invitation = await prisma.teamInvitation.create({
            data: {
                teamId,
                email,
                role,
                token,
                invitedById,
                expiresAt,
            },
            include: { team: true },
        });


        await emailService.sendTeamInvitation(email, invitation.team.name, inviter.user.email, token);

        const inviteLink = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/teams/invitations/${token}`;

        return { ...invitation, inviteLink };
    },

    async acceptInvitation(token: string, userId: string) {
        const invitation = await prisma.teamInvitation.findUnique({
            where: { token },
        });

        if (!invitation) throw new ApiError('Invalid invitation', { statusCode: 404, code: 'NOT_FOUND' });
        if (invitation.acceptedAt) throw new ApiError('Invitation already accepted', { statusCode: 409, code: 'CONFLICT' });
        if (invitation.expiresAt < new Date()) throw new ApiError('Invitation expired', { statusCode: 410, code: 'GONE' });

        const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

        // Simple email check - in production verify emails match strictly if required
        if (user.email.toLowerCase() !== invitation.email.toLowerCase()) {
            throw new ApiError('Email mismatch', { statusCode: 403, code: 'FORBIDDEN' });
        }

        await prisma.$transaction([
            prisma.teamMember.create({
                data: {
                    teamId: invitation.teamId,
                    userId,
                    role: invitation.role,
                },
            }),
            prisma.teamInvitation.update({
                where: { id: invitation.id },
                data: { acceptedAt: new Date() },
            }),
        ]);
    },

    async updateMemberRole(teamId: string, targetUserId: string, newRole: TeamRole, requesterId: string) {
        const requester = await prisma.teamMember.findUnique({
            where: { teamId_userId: { teamId, userId: requesterId } },
        });

        if (!requester || !ROLE_PERMISSIONS[requester.role].canManageMembers) {
            throw new ApiError('Insufficient permissions', { statusCode: 403, code: 'FORBIDDEN' });
        }

        const target = await prisma.teamMember.findUnique({
            where: { teamId_userId: { teamId, userId: targetUserId } },
        });

        if (!target) throw new ApiError('Member not found', { statusCode: 404, code: 'NOT_FOUND' });
        if (target.role === 'OWNER') {
            throw new ApiError('Cannot change owner role', { statusCode: 403, code: 'FORBIDDEN' });
        }

        return prisma.teamMember.update({
            where: { teamId_userId: { teamId, userId: targetUserId } },
            data: { role: newRole },
        });
    },

    async removeMember(teamId: string, targetUserId: string, requesterId: string) {
        const requester = await prisma.teamMember.findUnique({
            where: { teamId_userId: { teamId, userId: requesterId } },
        });

        if (!requester || !ROLE_PERMISSIONS[requester.role].canManageMembers) {
            throw new ApiError('Insufficient permissions', { statusCode: 403, code: 'FORBIDDEN' });
        }

        const target = await prisma.teamMember.findUnique({
            where: { teamId_userId: { teamId, userId: targetUserId } },
        });

        if (!target) throw new ApiError('Member not found', { statusCode: 404, code: 'NOT_FOUND' });
        if (target.role === 'OWNER') {
            throw new ApiError('Cannot remove team owner', { statusCode: 403, code: 'FORBIDDEN' });
        }
        if (targetUserId === requesterId) {
            throw new ApiError('Use leave endpoint to remove yourself', { statusCode: 400, code: 'BAD_REQUEST' });
        }

        await prisma.teamMember.delete({
            where: { teamId_userId: { teamId, userId: targetUserId } },
        });
    },

    async getUserTeams(userId: string) {
        return prisma.team.findMany({
            where: { members: { some: { userId } } },
            include: { members: { include: { user: { select: { id: true, email: true } } } } },
        });
    },

    async getTeamDetails(teamId: string, userId: string) {
        // Check membership
        const member = await prisma.teamMember.findUnique({
            where: { teamId_userId: { teamId, userId } },
        });

        if (!member) throw new ApiError('Access denied', { statusCode: 403, code: 'FORBIDDEN' });

        const team = await prisma.team.findUniqueOrThrow({
            where: { id: teamId },
            include: {
                members: { include: { user: { select: { id: true, email: true } } } },
                endpoints: true,
                invitations: {
                    where: { acceptedAt: null, expiresAt: { gt: new Date() } }
                },
            },
        });

        return { ...team, userRole: member.role };
    },

    async getUserRole(teamId: string, userId: string): Promise<TeamRole | null> {
        const member = await prisma.teamMember.findUnique({
            where: { teamId_userId: { teamId, userId } },
        });
        return member?.role ?? null;
    },
};
