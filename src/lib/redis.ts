import { createRequire } from 'module';
import { logger } from './logger.js';

const require = createRequire(import.meta.url);
const Redis = require('ioredis') as any;

type RedisConnectionConfig =
  | {
      mode: 'url';
      url: string;
      useTls: boolean;
    }
  | {
      mode: 'host';
      host: string;
      port: number;
      password?: string;
      db: number;
      useTls: boolean;
    };

type RedisUrlParseResult =
  | {
      ok: true;
      url: string;
      useTls: boolean;
    }
  | {
      ok: false;
      error: string;
    };

declare global {
  // eslint-disable-next-line no-var
  var redis: any | undefined;
}

function unwrapEnvValue(value: string | undefined): string | null {
  if (!value) return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    const unwrapped = trimmed.slice(1, -1).trim();
    return unwrapped || null;
  }

  return trimmed;
}

function parseRedisPort(value: string | undefined): number | null {
  const clean = unwrapEnvValue(value);
  if (!clean) return null;

  const port = Number.parseInt(clean, 10);
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    return null;
  }

  return port;
}

function parseRedisDb(value: string | undefined): number {
  const clean = unwrapEnvValue(value);
  if (!clean) return 0;

  const db = Number.parseInt(clean, 10);
  return Number.isFinite(db) && db >= 0 ? db : 0;
}

function parseRedisUrl(value: string | undefined): RedisUrlParseResult | null {
  const clean = unwrapEnvValue(value);
  if (!clean) return null;

  if (clean.includes('\n') || clean.includes('\r') || clean.includes('\\n')) {
    return { ok: false, error: 'contains newline characters' };
  }

  if (clean === '/') {
    return { ok: false, error: '"/" is not a valid Redis URL or socket path' };
  }

  if (clean.startsWith('/')) {
    return {
      ok: true,
      url: clean,
      useTls: false,
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(clean);
  } catch {
    return { ok: false, error: 'must start with redis:// or rediss:// and include a host' };
  }

  if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') {
    return { ok: false, error: 'must use the redis:// or rediss:// scheme' };
  }

  const hasSocketPath = parsed.pathname && parsed.pathname !== '/';
  if (!parsed.hostname && !hasSocketPath) {
    return { ok: false, error: 'must include a host or socket path' };
  }

  return {
    ok: true,
    url: clean,
    useTls: parsed.protocol === 'rediss:',
  };
}

function hasExplicitRedisHostPort(env: Partial<NodeJS.ProcessEnv>): boolean {
  return Boolean(unwrapEnvValue(env.REDIS_HOST) && parseRedisPort(env.REDIS_PORT) !== null);
}

export function getRedisConfigurationError(env: Partial<NodeJS.ProcessEnv> = process.env): string | null {
  const redisUrl = parseRedisUrl(env.REDIS_URL);
  if (redisUrl?.ok) {
    return null;
  }

  if (hasExplicitRedisHostPort(env)) {
    return null;
  }

  if (redisUrl && !redisUrl.ok) {
    return `Invalid REDIS_URL: ${redisUrl.error}`;
  }

  return 'Redis requires REDIS_URL or both REDIS_HOST and REDIS_PORT';
}

export function resolveRedisConnectionConfig(env: Partial<NodeJS.ProcessEnv> = process.env): RedisConnectionConfig {
  const redisUrl = parseRedisUrl(env.REDIS_URL);
  if (redisUrl?.ok) {
    return {
      mode: 'url',
      url: redisUrl.url,
      useTls: redisUrl.useTls,
    };
  }

  const host = unwrapEnvValue(env.REDIS_HOST);
  const port = parseRedisPort(env.REDIS_PORT);
  if (host && port !== null) {
    return {
      mode: 'host',
      host,
      port,
      password: unwrapEnvValue(env.REDIS_PASSWORD) || undefined,
      db: parseRedisDb(env.REDIS_DB),
      useTls: host !== 'localhost' && host !== '127.0.0.1' && host !== '::1',
    };
  }

  if (redisUrl && !redisUrl.ok) {
    throw new Error(`Invalid REDIS_URL: ${redisUrl.error}`);
  }

  throw new Error('Redis requires REDIS_URL or both REDIS_HOST and REDIS_PORT');
}

/**
 * Redis client singleton with automatic reconnection
 * 
 * Features:
 * - Connection pooling
 * - Automatic reconnection with backoff
 * - Health monitoring
 * - Graceful shutdown
 */
const getRedisClient = () => {
  const options = {
    retryStrategy(times: number) {
      const delay = Math.min(times * 50, 2000);
      logger.warn(`Redis reconnecting attempt ${times}, delay: ${delay}ms`);
      return delay;
    },
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    enableOfflineQueue: true,
    lazyConnect: false,
    // Production optimizations
    connectTimeout: 10000,
    commandTimeout: 5000,
    retryDelayOnFailover: 100,
  };

  const parsedRedisUrl = parseRedisUrl(process.env.REDIS_URL);
  if (parsedRedisUrl && !parsedRedisUrl.ok && hasExplicitRedisHostPort(process.env)) {
    logger.warn(`Redis: Ignoring REDIS_URL and falling back to REDIS_HOST/REDIS_PORT (${parsedRedisUrl.error})`);
  }

  const config = resolveRedisConnectionConfig();
  if (config.mode === 'url') {
    logger.info('Redis: Using REDIS_URL for connection');
    return new Redis(config.url, {
      ...options,
      tls: config.useTls ? {} : undefined,
    });
  }

  logger.info(`Redis: Attempting connection to ${config.host}:${config.port}`);
  return new Redis({
    host: config.host,
    port: config.port,
    password: config.password,
    db: config.db,
    tls: config.useTls ? {} : undefined,
    ...options,
  });
};

const redisClientsWithHandlers = new WeakSet<object>();
let _redis: any = global.redis;

function attachEventHandlers(client: any) {
  if (!client || redisClientsWithHandlers.has(client)) {
    return;
  }
  redisClientsWithHandlers.add(client);

  client.on('connect', () => {
    logger.info('Redis connection established');
  });

  client.on('ready', () => {
    logger.info('Redis client ready');
  });

  client.on('error', (error: any) => {
    logger.error('Redis connection error', { error: error.message });
  });

  client.on('close', () => {
    logger.warn('Redis connection closed');
  });

  client.on('reconnecting', (delay: number) => {
    logger.info(`Redis reconnecting in ${delay}ms`);
  });
}

if (_redis) {
  attachEventHandlers(_redis);
}

function ensureRedis(): any {
  // ioredis: status can be 'ready'|'connect'|'reconnecting'|'end' etc.
  if (!_redis || _redis.status === 'end') {
    _redis = getRedisClient();
    attachEventHandlers(_redis);
    if (process.env.NODE_ENV !== 'production') {
      global.redis = _redis;
    }
  }
  return _redis;
}

// Export a proxy so code keeps using `redis.*`, but we can recover if some test calls `redis.quit()`.
export const redis: any = new Proxy({}, {
  get(_target, prop: string) {
    const client = ensureRedis();
    const value = client[prop];
    if (typeof value === 'function') {
      return value.bind(client);
    }
    return value;
  },
});

// Store in global to prevent hot-reload creating multiple instances
if (_redis && process.env.NODE_ENV !== 'production') {
  global.redis = _redis;
}

/**
 * Graceful shutdown handler for Redis connection
 */
export async function disconnectRedis(): Promise<void> {
  if (!_redis) {
    return;
  }

  const client = ensureRedis();
  await client.quit();
  logger.info('Redis connection closed gracefully');
}

/**
 * Health check for Redis connection
 */
export async function checkRedisHealth(): Promise<boolean> {
  try {
    const client = ensureRedis();
    const result = await client.ping();
    return result === 'PONG';
  } catch (error) {
    logger.error('Redis health check failed', { error });
    return false;
  }
}
