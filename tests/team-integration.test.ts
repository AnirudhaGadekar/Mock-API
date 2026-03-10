import crypto from 'crypto';
import { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/index.js';
import { prisma } from '../src/lib/db.js';
import { redis } from '../src/lib/redis.js';
import { generateApiKey, hashApiKey } from '../src/utils/apiKey.js';

describe('Team Route Integration Tests', () => {
  let app: FastifyInstance;
  let ownerApiKey: string;
  let ownerId: string;
  let memberApiKey: string;
  let memberId: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    ownerApiKey = generateApiKey();
    const owner = await prisma.user.create({
      data: {
        email: `owner-${crypto.randomBytes(4).toString('hex')}@example.com`,
        apiKeyHash: hashApiKey(ownerApiKey),
        name: 'Owner',
      },
    });
    ownerId = owner.id;

    memberApiKey = generateApiKey();
    const member = await prisma.user.create({
      data: {
        email: `member-${crypto.randomBytes(4).toString('hex')}@example.com`,
        apiKeyHash: hashApiKey(memberApiKey),
        name: 'Member',
      },
    });
    memberId = member.id;
  });

  beforeEach(async () => {
    await redis.flushdb();
    await prisma.teamInvite.deleteMany({ where: { createdById: ownerId } });
    await prisma.teamMember.deleteMany({ where: { OR: [{ userId: ownerId }, { userId: memberId }] } });
    await prisma.team.deleteMany({ where: { ownerId } });
  });

  afterAll(async () => {
    await prisma.teamInvite.deleteMany({ where: { createdById: ownerId } });
    await prisma.teamMember.deleteMany({ where: { OR: [{ userId: ownerId }, { userId: memberId }] } });
    await prisma.team.deleteMany({ where: { ownerId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, memberId] } } });

    await app.close();
    await prisma.$disconnect();
    await redis.quit();
  });

  it('creates team and owner membership via API', async () => {
    const slug = `eng-${crypto.randomBytes(4).toString('hex')}`;
    const res = await app.inject({
      method: 'POST',
      url: '/api/v2/teams',
      headers: { 'x-api-key': ownerApiKey },
      payload: { name: 'Engineering Team', slug },
    });

    expect(res.statusCode).toBe(200);
    const team = res.json();
    expect(team.slug).toBe(slug);

    const membership = await prisma.teamMember.findUnique({
      where: { userId_teamId: { userId: ownerId, teamId: team.id } },
    });

    expect(membership).toBeTruthy();
    expect(membership?.role).toBe('OWNER');
  });

  it('rejects workspace switch to team for non-member user', async () => {
    const team = await prisma.team.create({
      data: {
        name: 'Private Team',
        slug: `private-${crypto.randomBytes(4).toString('hex')}`,
        ownerId,
      },
    });
    await prisma.teamMember.create({
      data: { teamId: team.id, userId: ownerId, role: 'OWNER' },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v2/workspace/switch',
      headers: { 'x-api-key': memberApiKey },
      payload: { type: 'team', teamId: team.id },
    });

    expect(res.statusCode).toBe(403);
  });

  it('allows workspace switch for valid team member', async () => {
    const team = await prisma.team.create({
      data: {
        name: 'Shared Team',
        slug: `shared-${crypto.randomBytes(4).toString('hex')}`,
        ownerId,
      },
    });
    await prisma.teamMember.createMany({
      data: [
        { teamId: team.id, userId: ownerId, role: 'OWNER' },
        { teamId: team.id, userId: memberId, role: 'MEMBER' },
      ],
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v2/workspace/switch',
      headers: { 'x-api-key': memberApiKey },
      payload: { type: 'team', teamId: team.id },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.workspace.type).toBe('team');
    expect(body.workspace.teamId).toBe(team.id);
  });
});
