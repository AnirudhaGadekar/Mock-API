
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const endpoints = await prisma.endpoint.findMany({
        select: {
            id: true,
            name: true,
            createdAt: true,
            user: {
                select: {
                    email: true,
                }
            }
        },
        orderBy: {
            createdAt: 'desc'
        },
        take: 5
    });

    console.log('Last 5 endpoints:', JSON.stringify(endpoints, null, 2));
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
