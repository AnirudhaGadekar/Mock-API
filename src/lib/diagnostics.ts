import { prisma, checkDatabaseHealth } from './db.js';
import { logger } from './logger.js';
import { checkRedisHealth } from './redis.js';
import { getApiKeyCookieOptions } from './auth-cookie.js';

type CheckStatus = 'pass' | 'warn' | 'fail';

type DiagnosticCheck = {
  name: string;
  status: CheckStatus;
  detail: string;
};

type DiagnosticsReport = {
  timestamp: string;
  environment: {
    nodeEnv: string;
    isDeployed: boolean;
    diagnosticMode: boolean;
  };
  config: {
    baseEndpointUrl: string | null;
    frontendUrl: string | null;
    corsOrigin: string | null;
    googleRedirectUri: string | null;
    githubRedirectUri: string | null;
    redisUrlInfo: string | null;
    databaseUrlInfo: string | null;
    cookie: {
      sameSite: 'none' | 'lax';
      secure: boolean;
      hasDomain: boolean;
      maxAge: number;
    };
  };
  checks: DiagnosticCheck[];
  health: {
    database: boolean;
    redis: boolean;
  };
  prismaMigrations: {
    tableReachable: boolean;
    totalMigrations: number | null;
    latestMigration: string | null;
    latestFinishedAt: string | null;
    error?: string;
  };
};

function isDeployedEnvironment(): boolean {
  return (
    process.env.NODE_ENV === 'production' ||
    process.env.RENDER === 'true' ||
    Boolean(process.env.RENDER_EXTERNAL_URL)
  );
}

function unwrapQuotedValue(value: string | undefined): string {
  if (!value) return '';
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    const wrappedByQuotes = (first === '"' && last === '"') || (first === "'" && last === "'");
    if (wrappedByQuotes) {
      return trimmed.slice(1, -1).trim();
    }
  }
  return trimmed;
}

function isLocalhostLike(hostOrUrl: string | undefined): boolean {
  if (!hostOrUrl) return false;
  let candidate = unwrapQuotedValue(hostOrUrl);
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

function parseHost(urlValue: string | undefined): string | null {
  const clean = unwrapQuotedValue(urlValue);
  if (!clean) return null;
  try {
    const parsed = new URL(clean.includes('://') ? clean : `https://${clean}`);
    return parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
}

function summarizeConnectionUrl(rawValue: string | undefined): string | null {
  const clean = unwrapQuotedValue(rawValue);
  if (!clean) return null;
  try {
    const parsed = new URL(clean);
    const user = parsed.username ? '***' : '';
    const pass = parsed.password ? ':***' : '';
    const auth = user || pass ? `${user}${pass}@` : '';
    const dbName = parsed.pathname || '/';
    return `${parsed.protocol}//${auth}${parsed.host}${dbName}`;
  } catch {
    return 'invalid_url';
  }
}

function hasSuspiciousRedisUrl(rawValue: string | undefined): boolean {
  if (!rawValue) return false;
  return rawValue.includes('\n') || rawValue.includes('\r') || rawValue.includes('\\n');
}

export function isDiagnosticModeEnabled(): boolean {
  return process.env.DIAGNOSTIC_MODE === 'true';
}

export async function collectDiagnosticsReport(): Promise<DiagnosticsReport> {
  const isDeployed = isDeployedEnvironment();
  const baseEndpointUrl = unwrapQuotedValue(process.env.BASE_ENDPOINT_URL);
  const frontendUrl = unwrapQuotedValue(process.env.FRONTEND_URL);
  const corsOrigin = unwrapQuotedValue(process.env.CORS_ORIGIN);
  const googleRedirectUri = unwrapQuotedValue(process.env.GOOGLE_REDIRECT_URI);
  const githubRedirectUri = unwrapQuotedValue(process.env.GITHUB_REDIRECT_URI);
  const redisUrl = process.env.REDIS_URL;
  const cookie = getApiKeyCookieOptions();

  const checks: DiagnosticCheck[] = [];
  const backendHost = parseHost(baseEndpointUrl || process.env.RENDER_EXTERNAL_URL);

  if (!baseEndpointUrl) {
    checks.push({
      name: 'BASE_ENDPOINT_URL',
      status: isDeployed ? 'fail' : 'warn',
      detail: 'BASE_ENDPOINT_URL is empty',
    });
  } else if (isDeployed && isLocalhostLike(baseEndpointUrl)) {
    checks.push({
      name: 'BASE_ENDPOINT_URL',
      status: 'fail',
      detail: `Deployed environment cannot use localhost (${baseEndpointUrl})`,
    });
  } else {
    checks.push({ name: 'BASE_ENDPOINT_URL', status: 'pass', detail: baseEndpointUrl });
  }

  if (!frontendUrl) {
    checks.push({
      name: 'FRONTEND_URL',
      status: isDeployed ? 'warn' : 'pass',
      detail: 'FRONTEND_URL not explicitly set',
    });
  } else if (isDeployed && isLocalhostLike(frontendUrl)) {
    checks.push({
      name: 'FRONTEND_URL',
      status: 'fail',
      detail: `Deployed environment cannot use localhost (${frontendUrl})`,
    });
  } else {
    checks.push({ name: 'FRONTEND_URL', status: 'pass', detail: frontendUrl });
  }

  if (!corsOrigin) {
    checks.push({ name: 'CORS_ORIGIN', status: 'warn', detail: 'CORS_ORIGIN is empty' });
  } else if (frontendUrl && !corsOrigin.split(',').map((o) => o.trim()).includes(frontendUrl)) {
    checks.push({
      name: 'CORS_ORIGIN',
      status: 'warn',
      detail: 'FRONTEND_URL is not present in CORS_ORIGIN list',
    });
  } else {
    checks.push({ name: 'CORS_ORIGIN', status: 'pass', detail: corsOrigin });
  }

  const oauthTargets: Array<{ key: 'GOOGLE_REDIRECT_URI' | 'GITHUB_REDIRECT_URI'; value: string }> = [];
  if (googleRedirectUri) oauthTargets.push({ key: 'GOOGLE_REDIRECT_URI', value: googleRedirectUri });
  if (githubRedirectUri) oauthTargets.push({ key: 'GITHUB_REDIRECT_URI', value: githubRedirectUri });

  for (const oauth of oauthTargets) {
    if (isDeployed && isLocalhostLike(oauth.value)) {
      checks.push({
        name: oauth.key,
        status: 'fail',
        detail: `${oauth.key} points to localhost (${oauth.value})`,
      });
      continue;
    }

    const redirectHost = parseHost(oauth.value);
    if (backendHost && redirectHost && redirectHost !== backendHost) {
      checks.push({
        name: oauth.key,
        status: 'warn',
        detail: `${oauth.key} host (${redirectHost}) does not match backend host (${backendHost})`,
      });
      continue;
    }

    checks.push({ name: oauth.key, status: 'pass', detail: oauth.value });
  }

  if (hasSuspiciousRedisUrl(redisUrl)) {
    checks.push({
      name: 'REDIS_URL',
      status: 'fail',
      detail: 'REDIS_URL contains newline or escaped newline characters',
    });
  } else if (redisUrl) {
    checks.push({
      name: 'REDIS_URL',
      status: 'pass',
      detail: summarizeConnectionUrl(redisUrl) || 'configured',
    });
  } else {
    checks.push({
      name: 'REDIS_URL',
      status: process.env.REDIS_HOST ? 'pass' : 'warn',
      detail: process.env.REDIS_HOST ? 'using REDIS_HOST/REDIS_PORT mode' : 'not set',
    });
  }

  if (isDeployed && (!cookie.secure || cookie.sameSite !== 'none')) {
    checks.push({
      name: 'AUTH_COOKIE_POLICY',
      status: 'fail',
      detail: `Production cookie policy invalid (secure=${cookie.secure}, sameSite=${cookie.sameSite})`,
    });
  } else {
    checks.push({
      name: 'AUTH_COOKIE_POLICY',
      status: 'pass',
      detail: `secure=${cookie.secure}, sameSite=${cookie.sameSite}`,
    });
  }

  const [databaseHealthy, redisHealthy] = await Promise.all([checkDatabaseHealth(), checkRedisHealth()]);

  checks.push({
    name: 'DATABASE_HEALTH',
    status: databaseHealthy ? 'pass' : 'fail',
    detail: databaseHealthy ? 'Database ping OK' : 'Database ping failed',
  });
  checks.push({
    name: 'REDIS_HEALTH',
    status: redisHealthy ? 'pass' : 'fail',
    detail: redisHealthy ? 'Redis ping OK' : 'Redis ping failed',
  });

  let prismaMigrations: DiagnosticsReport['prismaMigrations'] = {
    tableReachable: false,
    totalMigrations: null,
    latestMigration: null,
    latestFinishedAt: null,
  };

  try {
    const migrationCountRows = await prisma.$queryRaw<Array<{ count: bigint | number }>>`
      SELECT COUNT(*)::bigint AS count FROM "_prisma_migrations"
    `;
    const latestMigrationRows = await prisma.$queryRaw<Array<{ migration_name: string; finished_at: Date | null }>>`
      SELECT migration_name, finished_at
      FROM "_prisma_migrations"
      ORDER BY finished_at DESC NULLS LAST
      LIMIT 1
    `;

    const totalRaw = migrationCountRows[0]?.count ?? 0;
    const totalMigrations = typeof totalRaw === 'bigint' ? Number(totalRaw) : Number(totalRaw);
    const latest = latestMigrationRows[0];

    prismaMigrations = {
      tableReachable: true,
      totalMigrations,
      latestMigration: latest?.migration_name ?? null,
      latestFinishedAt: latest?.finished_at ? new Date(latest.finished_at).toISOString() : null,
    };

    checks.push({
      name: 'PRISMA_MIGRATIONS',
      status: totalMigrations > 0 ? 'pass' : 'warn',
      detail: `table reachable, total migrations: ${totalMigrations}`,
    });
  } catch (error: unknown) {
    const err = error as Error;
    prismaMigrations = {
      tableReachable: false,
      totalMigrations: null,
      latestMigration: null,
      latestFinishedAt: null,
      error: err.message,
    };
    checks.push({
      name: 'PRISMA_MIGRATIONS',
      status: 'fail',
      detail: `cannot read _prisma_migrations table: ${err.message}`,
    });
  }

  return {
    timestamp: new Date().toISOString(),
    environment: {
      nodeEnv: process.env.NODE_ENV || 'undefined',
      isDeployed,
      diagnosticMode: isDiagnosticModeEnabled(),
    },
    config: {
      baseEndpointUrl: baseEndpointUrl || null,
      frontendUrl: frontendUrl || null,
      corsOrigin: corsOrigin || null,
      googleRedirectUri: googleRedirectUri || null,
      githubRedirectUri: githubRedirectUri || null,
      redisUrlInfo: summarizeConnectionUrl(redisUrl),
      databaseUrlInfo: summarizeConnectionUrl(process.env.DATABASE_URL),
      cookie: {
        sameSite: cookie.sameSite,
        secure: cookie.secure,
        hasDomain: Boolean(cookie.domain),
        maxAge: cookie.maxAge,
      },
    },
    checks,
    health: {
      database: databaseHealthy,
      redis: redisHealthy,
    },
    prismaMigrations,
  };
}

export async function logStartupDiagnostics(): Promise<void> {
  const report = await collectDiagnosticsReport();
  logger.warn('DIAGNOSTIC_MODE enabled: runtime diagnostics report', {
    timestamp: report.timestamp,
    environment: report.environment,
    config: report.config,
  });
  for (const check of report.checks) {
    const message = `[diag:${check.status}] ${check.name} - ${check.detail}`;
    if (check.status === 'fail') {
      logger.error(message);
    } else if (check.status === 'warn') {
      logger.warn(message);
    } else {
      logger.info(message);
    }
  }
}
