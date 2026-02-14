import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { config } from 'dotenv';
import fastify from 'fastify';

import { websocketPlugin } from './engine/websocket.js';
import { startCronJobs } from './lib/cron.js';
import { checkDatabaseHealth, disconnectDatabase } from './lib/db.js';
import { logger } from './lib/logger.js';
import { metricsRegistry } from './lib/metrics.js';
import { checkRedisHealth, disconnectRedis } from './lib/redis.js';
import { registerSwagger } from './lib/swagger.js';
import { initTracing, shutdownTracing } from './lib/tracing.js';
import { registerRateLimiting } from './middleware/rate-limit.middleware.js';
import { tunnelProxyPlugin } from './middleware/tunnel-proxy.js';
import { adminRoutes } from './routes/admin.routes.js';
import { chaosRoutes } from './routes/chaos.routes.js';
import { endpointsRoutes } from "./routes/endpoints.routes.js";
import { historyRoutes } from './routes/history.routes.js';
import { mockRouterPlugin } from './routes/mock.router.js';
import { oasRoutes } from './routes/oas.routes.js';
import { sessionRoutes } from './routes/session.routes.js';
import { stateRoutes } from './routes/state.routes.js';
import { storeRoutes } from './routes/store.routes.js';
import { tunnelRoutes } from './routes/tunnel.routes.js';
import { userRoutes } from './routes/user.routes.js';


config();

/**
 * Validate environment variables at startup (fail fast).
 * This prevents insecure defaults in production.
 */
function validateEnvironment() {
  const required = [
    'JWT_SECRET',
    'JWT_EXPIRES_IN',
    'DATABASE_URL',
    'DIRECT_DATABASE_URL',
    'REDIS_HOST',
    'REDIS_PORT',
    'PORT',
  ];

  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n` +
      'Please check your .env file',
    );
  }

  // Validate JWT secret strength
  if ((process.env.JWT_SECRET || '').length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters for security');
  }

  // Validate numeric env vars
  if (isNaN(Number(process.env.PORT))) {
    throw new Error('PORT must be a valid number');
  }

  if (isNaN(Number(process.env.REDIS_PORT))) {
    throw new Error('REDIS_PORT must be a valid number');
  }

  logger.info('✅ Environment validation passed');
}

const PORT = Number(process.env.PORT || 10000);
// Render requires binding to 0.0.0.0. We force this to avoid EADDRNOTAVAIL errors
// if HOST is set to an external IP address.
const HOST = '0.0.0.0';

async function buildApp() {
  const app = fastify({
    logger: false,
    trustProxy: true,
    requestIdHeader: 'x-request-id',
    disableRequestLogging: true,
  });


  // Security + CORS
  await app.register(helmet, {});
  await app.register(cors, {
    origin: (origin, cb) => {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return cb(null, true);

      const allowedOrigins = process.env.CORS_ORIGIN?.split(',') || [];

      // If CORS_ORIGIN is not set or contains '*', we allow all (Reflect Origin)
      // This is safe for development/mocks but should be restricted in prod if possible.
      // However, for a mock tool, we usually want to allow anyone to call it.
      if (allowedOrigins.length === 0 || allowedOrigins.includes('*')) {
        return cb(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        return cb(null, true);
      }

      return cb(new Error('Not allowed by CORS'), false);
    },
    credentials: true,
  });

  await registerRateLimiting(app, {});

  // Health checks
  app.get('/healthz', async function (_request, reply) {
    return reply.send({ status: 'ok', uptime: process.uptime() });
  });

  app.get('/health', async function (_request, reply) {
    try {
      await checkDatabaseHealth();
      await checkRedisHealth();
      return reply.status(200).send({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        services: { database: 'up', redis: 'up' },
      });
    } catch (err: unknown) {
      logger.error('Health check failed', err as Error);
      return reply.status(503).send({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: 'Service unavailable',
      });
    }
  });

  app.get('/healthz/live', async function (_request, reply) {
    return reply.send({ status: 'ok', uptime: process.uptime() });
  });

  app.get('/healthz/ready', async function (_request, reply) {
    try {
      const dbHealthy = await checkDatabaseHealth();
      const redisHealthy = await checkRedisHealth();

      if (dbHealthy && redisHealthy) {
        return reply.send({ status: 'ready' });
      }

      return reply.status(503).send({
        status: 'not ready',
        checks: { database: dbHealthy, redis: redisHealthy },
      });
    } catch (_err: unknown) {
      return reply.status(503).send({
        status: 'not ready',
        error: 'Health check failed',
      });
    }
  });

  app.get('/metrics', async function (_request, reply) {
    const metrics = await metricsRegistry.metrics();
    reply
      .header('Content-Type', metricsRegistry.contentType)
      .status(200)
      .send(metrics);
  });

  // Logging hooks
  app.addHook('onRequest', async function (request) {
    logger.info('Incoming request', {
      method: request.method,
      url: request.url,
      ip: request.ip,
      requestId: request.id,
    });
  });

  app.addHook('onResponse', async function (request, reply) {
    logger.info('Request completed', {
      method: request.method,
      url: request.url,
      statusCode: reply.statusCode,
      responseTime: `${reply.elapsedTime.toFixed(2)}ms`,
      requestId: request.id,
    });
  });

  // WebSocket plugin (must be before routes)
  await app.register(websocketPlugin);

  // Swagger Documentation
  await registerSwagger(app);

  // API routes (session is unauthenticated — must be first)
  await app.register(sessionRoutes, { prefix: '/api/v1/session' });

  await app.register(endpointsRoutes, { prefix: '/api/v1/endpoints' });
  await app.register(historyRoutes, { prefix: '/api/v1/history' });
  await app.register(adminRoutes, { prefix: '/api/v1/admin' });
  await app.register(userRoutes, { prefix: '/api/v1/user' });
  await app.register(stateRoutes, { prefix: '/api/v1/state' });
  await app.register(storeRoutes, { prefix: '/api/v1/store' });
  await app.register(chaosRoutes, { prefix: '/api/v1/chaos' });
  await app.register(oasRoutes, { prefix: '/api/v1' });
  await app.register(tunnelRoutes, { prefix: '/api/v1/tunnel' });
  await app.register(tunnelProxyPlugin);
  await app.register(mockRouterPlugin);

  // Error handler
  app.setErrorHandler((error: unknown, request, reply) => {
    const err = error as Error;

    logger.error('Unhandled error', {
      message: err.message,
      stack: err.stack || 'No stack',
      url: request.url,
      method: request.method,
      requestId: request.id,
    });

    const isDev = process.env.NODE_ENV === 'development';

    return reply.status(500).send({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: isDev ? err.message : 'Internal server error',
        ...(isDev && { stack: err.stack }),
      },
      timestamp: new Date().toISOString(),
    });
  });

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: `Route ${request.method} ${request.url} not found`,
      },
      timestamp: new Date().toISOString(),
    });
  });

  return app;
}

async function start() {
  try {
    validateEnvironment(); // ✅ Critical: validate env before starting anything

    await initTracing();
    const app = await buildApp();

    await app.listen({ port: PORT, host: HOST });
    logger.info(`Server listening on http://${HOST}:${PORT}`);

    // Start cron jobs (log cleanup)
    startCronJobs();

    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}, shutting down...`);
      await app.close();
      await disconnectDatabase();
      await disconnectRedis();
      await shutdownTracing();
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    process.on('uncaughtException', (err: unknown) => {
      logger.error('Uncaught Exception', err as Error);
      process.exit(1);
    });

    process.on('unhandledRejection', (reason: unknown) => {
      logger.error('Unhandled Rejection', reason as Error);
      process.exit(1);
    });
  } catch (err: unknown) {
    logger.error('Startup failed', err as Error);
    process.exit(1);
  }
}

start();

export { buildApp, start };

