import winston from 'winston';

const logLevel = process.env.LOG_LEVEL || 'info';

/**
 * Production-ready Winston logger with JSON formatting
 * 
 * Features:
 * - Structured JSON logging for production
 * - Human-readable format for development
 * - Timestamp with timezone
 * - Error stack traces
 */
export const logger = winston.createLogger({
  level: logLevel,
  format: winston.format.combine(
    winston.format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss.SSS',
    }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
  ),
  defaultMeta: {
    service: 'MockUrl',
    environment: process.env.NODE_ENV,
  },
  transports: [
    new winston.transports.Console({
      format:
        process.env.NODE_ENV === 'development'
          ? winston.format.combine(
              winston.format.colorize(),
              winston.format.printf(({ timestamp, level, message, ...meta }) => {
                const metaStr = Object.keys(meta).length
                  ? `\n${JSON.stringify(meta, null, 2)}`
                  : '';
                return `${timestamp} [${level}]: ${message}${metaStr}`;
              })
            )
          : winston.format.json(),
    }),
  ],
});

/**
 * Stream for Fastify integration
 */
export const loggerStream = {
  write: (message: string) => {
    logger.info(message.trim());
  },
};

/**
 * Log request with structured data
 */
export function logRequest(data: {
  method: string;
  url: string;
  statusCode: number;
  responseTime: number;
  userAgent?: string;
  ip?: string;
}) {
  logger.info('HTTP Request', data);
}

/**
 * Log error with context
 */
export function logError(error: Error, context?: Record<string, unknown>) {
  logger.error('Error occurred', {
    message: error.message,
    stack: error.stack,
    ...context,
  });
}
