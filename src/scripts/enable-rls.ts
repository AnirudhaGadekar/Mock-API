
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    // console.log removed on all tables...');

    const tables = [
        'users',
        'endpoints',
        'request_logs',
        'teams',
        'team_members',
        'team_invitations'
    ];

    for (const table of tables) {
        try {
            await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;`);
            // console.log removed
        } catch (error) {
            console.error(`❌ Failed to enable RLS for ${table}:`, error);
        }
    }

    // console.log removed
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
