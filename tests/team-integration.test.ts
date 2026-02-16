import crypto from 'crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/db.js';
import { generateApiKey, hashApiKey } from '../src/utils/apiKey.js';

describe('Team Integration Tests', () => {
    let testUser: any;
    let apiKey: string;

    beforeAll(async () => {
        try {
            // Setup a test user
            apiKey = generateApiKey();
            const apiKeyHash = hashApiKey(apiKey);
            testUser = await prisma.user.create({
                data: {
                    email: `test-${crypto.randomBytes(4).toString('hex')}@example.com`,
                    apiKeyHash,
                    // authProvider: 'LOCAL', // Removing for type test
                    name: 'Test User'
                }
            });
            console.log('Test user created:', testUser.id);
        } catch (err) {
            console.error('FAILED beforeAll setup:', err);
            throw err;
        }
    });

    it('should allow creating a team', async () => {
        const teamName = 'Engineering Team';
        const slug = `eng-${crypto.randomBytes(4).toString('hex')}`;

        const team = await prisma.team.create({
            data: {
                name: teamName,
                slug,
                ownerId: testUser.id,
                members: {
                    create: {
                        userId: testUser.id,
                        role: 'OWNER'
                    }
                }
            },
            include: {
                members: true
            }
        });

        expect(team.name).toBe(teamName);
        expect(team.ownerId).toBe(testUser.id);
        expect(team.members).toHaveLength(1);
        expect(team.members[0].userId).toBe(testUser.id);
        expect(team.members[0].role).toBe('OWNER');
    });

    it('should fail to create team with duplicate slug', async () => {
        const slug = 'shared-slug';
        await prisma.team.create({
            data: {
                name: 'Team 1',
                slug,
                ownerId: testUser.id
            }
        });

        await expect(prisma.team.create({
            data: {
                name: 'Team 2',
                slug,
                ownerId: testUser.id
            }
        })).rejects.toThrow();
    });

    it('should handle team invitations', async () => {
        const team = await prisma.team.create({
            data: {
                name: 'Invite Team',
                slug: `invite-${crypto.randomBytes(4).toString('hex')}`,
                ownerId: testUser.id
            }
        });

        const token = crypto.randomBytes(32).toString('hex');
        const invite = await prisma.teamInvite.create({
            data: {
                token,
                teamId: team.id,
                createdById: testUser.id,
                expiresAt: new Date(Date.now() + 86400000) // 1 day
            }
        });

        expect(invite.token).toBe(token);
        expect(invite.teamId).toBe(team.id);
    });
});
