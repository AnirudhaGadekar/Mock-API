/**
 * Cron jobs for maintenance tasks
 */
import { prisma } from './db.js';
import { logger } from './logger.js';

const RETENTION_DAYS = 10;

/**
 * Delete request logs older than retention period (10 days)
 */
export async function cleanupOldLogs(): Promise<void> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);

  try {
    const result = await prisma.requestLog.deleteMany({
      where: {
        timestamp: {
          lt: cutoffDate,
        },
      },
    });

    logger.info({ deletedCount: result.count, cutoffDate }, 'Cleaned up old request logs');
  } catch (error) {
    logger.error({ error }, 'Failed to cleanup old logs');
  }
}

/**
 * Start cron jobs (runs cleanup daily at 2 AM)
 */
export function startCronJobs(): void {
  const cleanupInterval = 24 * 60 * 60 * 1000; // 24 hours
  const initialDelay = getMillisecondsUntilNextRun(2, 0); // 2 AM

  setTimeout(() => {
    cleanupOldLogs();
    setInterval(cleanupOldLogs, cleanupInterval);
  }, initialDelay);

  logger.info({ nextCleanup: new Date(Date.now() + initialDelay) }, 'Cron jobs started');
}

/**
 * Calculate milliseconds until next run at specified hour:minute
 */
function getMillisecondsUntilNextRun(hour: number, minute: number): number {
  const now = new Date();
  const next = new Date();
  next.setHours(hour, minute, 0, 0);
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime() - now.getTime();
}
