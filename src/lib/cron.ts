/**
 * Cron jobs for maintenance tasks
 */
import { flushRequestCounts } from '../utils/endpoint.cache.js';
import { prisma } from './db.js';
import { logger } from './logger.js';

const RETENTION_DAYS = 1; // User requested 1 day for minimal DB load
const ENDPOINT_INACTIVITY_DAYS = 1; // Aggressive cleanup for free tier/live demo
const FLUSH_INTERVAL_MS = 10000; // 10 seconds

/**
 * Delete request logs older than retention period (1 day)
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

    logger.info('Cleaned up old request logs', { deletedCount: result.count, cutoffDate });
  } catch (error) {
    logger.error('Failed to cleanup old logs', { error });
  }
}

/**
 * Delete inactive endpoints (older than 1 day with no activity)
 */
export async function cleanupInactiveEndpoints(): Promise<void> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - ENDPOINT_INACTIVITY_DAYS);

  try {
    const result = await prisma.endpoint.deleteMany({
      where: {
        lastActiveAt: {
          lt: cutoffDate,
        },
      },
    });

    if (result.count > 0) {
      logger.info('Cleaned up inactive endpoints', { deletedCount: result.count, cutoffDate });
    }
  } catch (error) {
    logger.error('Failed to cleanup inactive endpoints', { error });
  }
}

/**
 * Start cron jobs
 */
export function startCronJobs(): void {
  // 1. Log & Endpoint Cleanup (Daily at 2 AM)
  const cleanupInterval = 24 * 60 * 60 * 1000; // 24 hours
  const initialDelay = getMillisecondsUntilNextRun(2, 0); // 2 AM

  setTimeout(() => {
    cleanupOldLogs();
    cleanupInactiveEndpoints();
    setInterval(() => {
      cleanupOldLogs();
      cleanupInactiveEndpoints();
    }, cleanupInterval);
  }, initialDelay);

  // 2. Request Count Flusher (Every 10 seconds)
  // This is critical for preventing DB write locking
  setInterval(() => {
    flushRequestCounts(prisma).catch((err) => {
      logger.error('Failed to run flushRequestCounts job', { err });
    });
  }, FLUSH_INTERVAL_MS);

  logger.info('Cron jobs started', {
    nextCleanup: new Date(Date.now() + initialDelay),
    flushIntervalMs: FLUSH_INTERVAL_MS
  });
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
