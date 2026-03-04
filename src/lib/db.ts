import { PrismaClient } from '@prisma/client';
import { logger } from './logger.js';

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

/**
 * PrismaClient singleton with PgBouncer support
 * 
 * Configuration:
 * - Uses transaction pooling mode for PgBouncer
 * - Disables interactive transactions
 * - Single connection per Prisma Client instance
 * 
 * Environment variables:
 * - DATABASE_URL: For app queries (with pgbouncer=true&connection_limit=1)
 * - DIRECT_DATABASE_URL: For migrations (direct connection to database)
 */
export const prisma =
  global.prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? [
      {
        emit: 'event',
        level: 'query',
      },
      {
        emit: 'event',
        level: 'error',
      },
      {
        emit: 'event',
        level: 'warn',
      },
    ] : [
      {
        emit: 'event',
        level: 'error',
      },
      {
        emit: 'event',
        level: 'warn',
      },
    ],
    datasources: {
      db: {
        url: process.env.DATABASE_URL,
      },
    },
    // Production optimizations
    transactionOptions: {
      timeout: 10000,
      isolationLevel: 'ReadCommitted',
    },
  });

// Log queries in development
if (process.env.NODE_ENV === 'development') {
  (prisma as any).$on('query', (e: any) => {
    logger.debug('Prisma Query', {
      query: e.query,
      params: e.params,
      duration: e.duration,
    });
  });
}

// Log errors
(prisma as any).$on('error', (e: any) => {
  logger.error('Prisma Error', {
    message: e.message,
    target: e.target,
  });
});

// Log warnings
(prisma as any).$on('warn', (e: any) => {
  logger.warn('Prisma Warning', {
    message: e.message,
    target: e.target,
  });
});

// Store in global to prevent hot-reload creating multiple instances
if (process.env.NODE_ENV !== 'production') {
  global.prisma = prisma;
}

/**
 * Graceful shutdown handler for database connection
 */
export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
  logger.info('Database connection closed');
}

/**
 * Health check for database connection
 */
export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    logger.error('Database health check failed', { error });
    return false;
  }
}
