
import { TeamRole } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { prisma } from '../lib/db';
// import { emailService } from './email.service'; // TODO: Implement Email Service
import { AppError } from '../lib/errors';

// Mock Email Service for now
const emailService = {
    sendTeamInvitation: async (email: string, teamName: string, inviterName: string, token: string) => {
        console.log(`[Email Mock] Sending invite to ${email} for team ${teamName} from ${inviterName}. Token: ${token}`);
    }
};

const ROLE_PERMISSIONS: Record<TeamRole, { canEdit: boolean; canInvite: boolean; canManageMembers: boolean }> = {
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
            throw new AppError('Team slug already exists', 409);
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

        if (!inviter) throw new AppError('Not a team member', 403);
        if (!ROLE_PERMISSIONS[inviter.role].canInvite) {
            throw new AppError('Insufficient permissions', 403);
        }

        // Check if user is already a member
        const existingUser = await prisma.user.findUnique({ where: { email } });
        if (existingUser) {
            const alreadyMember = await prisma.teamMember.findUnique({
                where: { teamId_userId: { teamId, userId: existingUser.id } },
            });
            if (alreadyMember) throw new AppError('User is already a team member', 409);
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

        return invitation;
    },

    async acceptInvitation(token: string, userId: string) {
        const invitation = await prisma.teamInvitation.findUnique({
            where: { token },
        });

        if (!invitation) throw new AppError('Invalid invitation', 404);
        if (invitation.acceptedAt) throw new AppError('Invitation already accepted', 409);
        if (invitation.expiresAt < new Date()) throw new AppError('Invitation expired', 410);

        const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

        // Simple email check - in production verify emails match strictly if required
        if (user.email.toLowerCase() !== invitation.email.toLowerCase()) {
            throw new AppError('Email mismatch', 403);
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
            throw new AppError('Insufficient permissions', 403);
        }

        const target = await prisma.teamMember.findUnique({
            where: { teamId_userId: { teamId, userId: targetUserId } },
        });

        if (!target) throw new AppError('Member not found', 404);
        if (target.role === 'OWNER') {
            throw new AppError('Cannot change owner role', 403);
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
            throw new AppError('Insufficient permissions', 403);
        }

        const target = await prisma.teamMember.findUnique({
            where: { teamId_userId: { teamId, userId: targetUserId } },
        });

        if (!target) throw new AppError('Member not found', 404);
        if (target.role === 'OWNER') {
            throw new AppError('Cannot remove team owner', 403);
        }
        if (targetUserId === requesterId) {
            throw new AppError('Use leave endpoint to remove yourself', 400);
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

        if (!member) throw new AppError('Access denied', 403);

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
