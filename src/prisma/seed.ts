import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import { hashApiKey } from '../utils/apiKey.js';

const prisma = new PrismaClient();

function generateApiKey(): string {
  return crypto.randomBytes(32).toString('hex');
}

function getSeedEndpointBaseUrl(): string {
  const configuredBase = process.env.BASE_ENDPOINT_URL?.trim();
  if (configuredBase) {
    return configuredBase.replace(/\/+$/, '');
  }

  if (process.env.NODE_ENV === 'production' || process.env.RENDER === 'true' || process.env.RENDER_EXTERNAL_URL) {
    const deployedBase = process.env.RENDER_EXTERNAL_URL || 'https://mock-url-9rwn.onrender.com';
    return `${deployedBase.replace(/\/+$/, '')}/e`;
  }

  return 'http://localhost:3000/e';
}

async function main() {
  console.log('🌱 Starting database seed...');

  // Clean existing data in development
  if (process.env.NODE_ENV === 'development') {
    await prisma.requestLog.deleteMany();
    await prisma.endpoint.deleteMany();
    await prisma.user.deleteMany();
    console.log('🧹 Cleaned existing data');
  }

  // Create test users
  const rawKey1 = generateApiKey();
  const user1 = await prisma.user.create({
    data: {
      email: 'alice@example.com',
      apiKeyHash: hashApiKey(rawKey1),
    },
  });

  const rawKey2 = generateApiKey();
  const user2 = await prisma.user.create({
    data: {
      email: 'bob@example.com',
      apiKeyHash: hashApiKey(rawKey2),
    },
  });

  console.log('✅ Created test users:');
  console.log(`   User 1: ${user1.email} (API Key: ${rawKey1})`);
  console.log(`   User 2: ${user2.email} (API Key: ${rawKey2})`);

  // Ensure canonical personal workspaces exist (required by Endpoint.workspaceId)
  const ws1 = await prisma.workspace.upsert({
    where: { id: `ws_personal_${user1.id}` },
    update: { updatedAt: new Date() },
    create: {
      id: `ws_personal_${user1.id}`,
      type: 'PERSONAL',
      personalOwnerUserId: user1.id,
    },
  });

  // Optional: Create sample endpoints for testing
  const endpoint1 = await prisma.endpoint.create({
    data: {
      userId: user1.id,
      workspaceId: ws1.id,
      name: 'my-api',
      slug: 'my-api',
      rules: [],
      settings: {},
    },
  });

  console.log(`✅ Created sample endpoint: ${endpoint1.name}`);
  console.log(`   Access at: ${getSeedEndpointBaseUrl()}/${endpoint1.name}`);

  console.log('\n🎉 Seed completed successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
