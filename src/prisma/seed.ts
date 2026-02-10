import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

function generateApiKey(): string {
  return crypto.randomBytes(32).toString('hex');
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
  const user1 = await prisma.user.create({
    data: {
      email: 'alice@example.com',
      apiKey: generateApiKey(),
    },
  });

  const user2 = await prisma.user.create({
    data: {
      email: 'bob@example.com',
      apiKey: generateApiKey(),
    },
  });

  console.log('✅ Created test users:');
  console.log(`   User 1: ${user1.email} (API Key: ${user1.apiKey})`);
  console.log(`   User 2: ${user2.email} (API Key: ${user2.apiKey})`);

  // Optional: Create sample endpoints for testing
  const endpoint1 = await prisma.endpoint.create({
    data: {
      userId: user1.id,
      name: 'my-api',
      rules: [],
      settings: {},
    },
  });

  console.log(`✅ Created sample endpoint: ${endpoint1.name}`);
  console.log(`   Access at: ${process.env.BASE_ENDPOINT_URL || 'http://localhost:3000/e'}/${endpoint1.name}`);

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
