import 'dotenv/config';
import { fileURLToPath } from 'url';

import fastifyCookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import fastifyJwt from '@fastify/jwt';
import fastify from 'fastify';

import { websocketPlugin } from './engine/websocket.js';
import { startCronJobs } from './lib/cron.js';
import { checkDatabaseHealth, disconnectDatabase } from './lib/db.js';
import { isDiagnosticModeEnabled, logStartupDiagnostics } from './lib/diagnostics.js';
import { logger } from './lib/logger.js';
import { metricsRegistry } from './lib/metrics.js';
import { checkRedisHealth, disconnectRedis } from './lib/redis.js';
import { registerSwagger } from './lib/swagger.js';
import { initTracing, shutdownTracing } from './lib/tracing.js';
import { registerRateLimiting } from './middleware/rate-limit.middleware.js';
import { tunnelProxyPlugin } from './middleware/tunnel-proxy.js';
import { adminRoutes } from './routes/admin.routes.js';
import { aiRulesRoutes } from './routes/ai-rules.routes.js';
import { authRoutes } from './routes/auth.js';
import { chaosRoutes } from './routes/chaos.routes.js';
import { endpointsRoutes } from "./routes/endpoints.routes.js";
import { historyRoutes } from './routes/history.routes.js';
import { inviteRoutes } from './routes/invites.js';
import { mockRouterPlugin } from './routes/mock.router.js';
import { oasRoutes } from './routes/oas.routes.js';
import { oauthRoutes } from './routes/oauth.js';
import { otpRoutes } from './routes/otp.routes.js';
import { sessionRoutes } from './routes/session.routes.js';
import { stateRoutes } from './routes/state.routes.js';
import { storeRoutes } from './routes/store.routes.js';
import { teamRoutes } from './routes/teams.js';
import tunnelWsRoute from './routes/tunnel-ws.js';
import { tunnelRoutes } from './routes/tunnel.routes.js';
import { userRoutes } from './routes/user.routes.js';
import { workspaceRoutes } from './routes/workspace.js';

function isDeployedEnvironment(): boolean {
  return (
    process.env.NODE_ENV === 'production' ||
    process.env.RENDER === 'true' ||
    Boolean(process.env.RENDER_EXTERNAL_URL)
  );
}

function isLocalhostLikeHost(hostOrUrl: string | undefined): boolean {
  if (!hostOrUrl) return false;

  let candidate = hostOrUrl.trim();
  if (!candidate) return false;
  if (!candidate.includes('://')) {
    candidate = `http://${candidate}`;
  }

  try {
    const parsed = new URL(candidate);
    const host = parsed.hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.localhost');
  } catch {
    return false;
  }
}

/**
 * Validate environment variables at startup (fail fast).
 * This prevents insecure defaults in production.
 */
function validateEnvironment() {
  // Provide sensible defaults for optional or derivable variables
  if (!process.env.JWT_EXPIRES_IN) {
    process.env.JWT_EXPIRES_IN = '7d';
    logger.info('ℹ️  Using default JWT_EXPIRES_IN: 7d');
  }

  if (!process.env.PORT) {
    process.env.PORT = '10000';
    logger.info('ℹ️  Using default PORT: 10000');
  }

  const jwtSecret = process.env.JWT_SECRET || '';
  const jwtComplexityScore =
    (/[a-z]/.test(jwtSecret) ? 1 : 0) +
    (/[A-Z]/.test(jwtSecret) ? 1 : 0) +
    (/\d/.test(jwtSecret) ? 1 : 0) +
    (/[^a-zA-Z0-9]/.test(jwtSecret) ? 1 : 0);
  const jwtSecretStrong = jwtSecret.length >= 32 && jwtComplexityScore >= 3;

  let authMode = process.env.AUTH_MODE?.trim().toLowerCase();
  const isProd = process.env.NODE_ENV === 'production';
  const isDeployed = isDeployedEnvironment();

  if (isProd && !authMode) {
    authMode = 'otp';
    process.env.AUTH_MODE = 'otp';
    logger.warn('⚠️  AUTH_MODE was not set in production. Defaulting to AUTH_MODE=otp.');
  }

  // --- MANDATORY STARTUP VALIDATION (Enterprise Security) ---
  if (isProd && authMode !== 'otp') {
    throw new Error(`❌ SECURITY ERROR: Production cannot run with AUTH_MODE=${authMode}. Set AUTH_MODE=otp.`);
  }

  if (!isProd && authMode === 'dev-bypass') {
    logger.warn('⚠️  [DEV-BYPASS] Auth bypass mode is ACTIVE. OTPs will be logged to console and returned in responses. DO NOT use in production.');
  }

  if (isProd) {
    if (!jwtSecretStrong) {
      throw new Error('❌ Production requires JWT_SECRET with at least 32 chars and strong complexity');
    }
    if (!process.env.BASE_MOCK_DOMAIN) {
      logger.warn('⚠️  Production: BASE_MOCK_DOMAIN not set, using default');
    }
  }

  const baseEndpointUrl = process.env.BASE_ENDPOINT_URL?.trim();
  if (isDeployed && baseEndpointUrl && isLocalhostLikeHost(baseEndpointUrl)) {
    logger.error('CONFIG ERROR: BASE_ENDPOINT_URL is localhost in a deployed environment. Use your public domain (for example, https://mock-url-9rwn.onrender.com/e).', {
      BASE_ENDPOINT_URL: baseEndpointUrl,
      NODE_ENV: process.env.NODE_ENV,
      RENDER: process.env.RENDER,
      RENDER_EXTERNAL_URL: process.env.RENDER_EXTERNAL_URL,
    });
  }

  const required = [
    'JWT_SECRET',
    'DATABASE_URL',
    'OTP_SECRET',
    'API_KEY_SECRET',
  ];

  const missing = required.filter((key) => !process.env[key]);

  // Check Redis: Either REDIS_URL or (HOST + PORT)
  const hasRedis = process.env.REDIS_URL || (process.env.REDIS_HOST && process.env.REDIS_PORT);
  if (!hasRedis) {
    missing.push('REDIS_URL (or REDIS_HOST and REDIS_PORT)');
  }

  if (missing.length > 0) {
    throw new Error(
      `❌ Missing required environment variables: ${missing.join(', ')}\n` +
      'Please check your .env file or Render environment settings.',
    );
  }

  if (!jwtSecretStrong) {
    logger.warn('⚠️  JWT_SECRET is weak. Use at least 32 chars with mixed complexity.');
  }

  // Validate numeric env vars
  if (isNaN(Number(process.env.PORT))) {
    throw new Error('❌ PORT must be a valid number');
  }

  if (process.env.REDIS_PORT && isNaN(Number(process.env.REDIS_PORT))) {
    throw new Error('❌ REDIS_PORT must be a valid number');
  }
  if (process.env.BODY_LIMIT && isNaN(Number(process.env.BODY_LIMIT))) {
    throw new Error('❌ BODY_LIMIT must be a valid number');
  }

  logger.info('✅ Environment validation passed');
}

const PORT = Number(process.env.PORT || 10000);
// Render requires binding to 0.0.0.0. We force this to avoid EADDRNOTAVAIL errors
// if HOST is set to an external IP address.
const HOST = '0.0.0.0';

import { serializerCompiler, validatorCompiler, ZodTypeProvider } from 'fastify-type-provider-zod';

async function buildApp() {
  const bodyLimit = Number(process.env.BODY_LIMIT ?? 1048576);
  const app = fastify({
    logger: false,
    trustProxy: true,
    requestIdHeader: 'x-request-id',
    disableRequestLogging: true,
    bodyLimit,
  }).withTypeProvider<ZodTypeProvider>();

  // Register Zod compilers
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);


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

  // Auth Plugins
  await app.register(fastifyJwt, {
    secret: process.env.JWT_SECRET || 'super-secret-key-at-least-32-chars-long'
  });
  await app.register(fastifyCookie, {
    secret: process.env.JWT_SECRET, // share secret or use separate
    hook: 'onRequest'
  });

  // Health checks
  app.get('/', async function (_request, reply) {
    return reply.status(200).send({
      success: true,
      service: 'MockUrl API',
      status: 'ok',
      docs: '/api/docs',
      health: '/health',
      frontend: process.env.FRONTEND_URL || null,
      timestamp: new Date().toISOString(),
    });
  });

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

  // WebSocket support (must be registered before routes using it)
  await app.register(import('@fastify/websocket'));

  // WebSocket plugin (must be before routes)
  await app.register(websocketPlugin);
  await app.register(tunnelWsRoute);

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
  await app.register(teamRoutes, { prefix: '/api/v1/teams' });
  await app.register(authRoutes, { prefix: '/api/v1/auth' });
  await app.register(otpRoutes, { prefix: '/api/v1/auth' });
  await app.register(oauthRoutes, { prefix: '/api/v1/oauth' });
  await app.register(inviteRoutes, { prefix: '/api/v1/invites' });
  await app.register(workspaceRoutes, { prefix: '/api/v1/workspace' });
  await app.register(tunnelProxyPlugin);
  await app.register(mockRouterPlugin);

  // AI Routes
  await app.register(aiRulesRoutes, { prefix: '/api/v1/ai' });

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

    const exposeStackTrace = process.env.EXPOSE_STACK_TRACE === 'true';

    return reply.status(500).send({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: exposeStackTrace ? err.message : 'Internal server error',
        ...(exposeStackTrace && { stack: err.stack }),
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
    if (isDiagnosticModeEnabled()) {
      await logStartupDiagnostics();
    }

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
      if (process.env.NODE_ENV !== 'test') process.exit(1);
    });

    process.on('unhandledRejection', (reason: unknown) => {
      logger.error('Unhandled Rejection', reason as Error);
      if (process.env.NODE_ENV !== 'test') process.exit(1);
    });
  } catch (err: unknown) {
    logger.error('Startup failed', err as Error);
    if (process.env.NODE_ENV !== 'test') process.exit(1);
  }
}

// Only start when executed as the actual entrypoint module.
function isMainModule(): boolean {
  if (!process.argv[1]) return false;
  try {
    return fileURLToPath(import.meta.url) === process.argv[1];
  } catch {
    return false;
  }
}

if (isMainModule()) {
  start();
}


export { buildApp, start };

