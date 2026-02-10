# MockUrl Backend - Changes Checklist

**Date:** February 10, 2026  
**Priority Order:** 🔴 Critical → 🟠 High → 🟡 Medium → 🟢 Low

---

## 🔴 CRITICAL PRIORITY (Fix Immediately)

### 1. Remove Hardcoded Secrets & Add Environment Validation

**File: `src/lib/auth.ts`**
```typescript
// REMOVE THIS (Line ~6-7):
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// REPLACE WITH:
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN;

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be set and at least 32 characters long');
}
if (!JWT_EXPIRES_IN) {
  throw new Error('JWT_EXPIRES_IN must be set');
}
```

**File: `src/index.ts` (or create new `src/config/validate-env.ts`)**
```typescript
// ADD THIS NEW FUNCTION at the top, before buildApp():

function validateEnvironment() {
  const required = [
    'JWT_SECRET',
    'DATABASE_URL',
    'DIRECT_DATABASE_URL',
    'REDIS_HOST',
    'REDIS_PORT',
    'PORT',
    'HOST',
  ];
  
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n` +
      'Please check your .env file'
    );
  }
  
  // Validate JWT secret strength
  if (process.env.JWT_SECRET!.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters for security');
  }
  
  // Validate numeric env vars
  if (isNaN(Number(process.env.PORT))) {
    throw new Error('PORT must be a valid number');
  }
  
  console.log('✅ Environment validation passed');
}

// THEN CALL IT in start() function (Line ~979):
async function start() {
  try {
    validateEnvironment(); // ADD THIS LINE FIRST
    await initTracing();
    const app = await buildApp();
    // ... rest of code
```

**File: `.gitignore`**
```bash
# VERIFY these lines exist:
.env
.env.local
.env.*.local

# If .env was previously committed, run:
# git rm --cached .env
# git commit -m "Remove .env from repository"
```

**Action: Generate new strong secrets**
```bash
# Run these commands to generate new secrets:
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
# Use output for JWT_SECRET in production .env
```

---

### 2. Add Input Validation with Zod Schemas

**File: `package.json`**
```json
// ADD to dependencies (if not already there):
{
  "dependencies": {
    "zod": "^3.25.76"  // ✅ Already present, good!
  }
}
```

**File: Create new `src/schemas/endpoint.schema.ts`**
```typescript
import { z } from 'zod';

export const createEndpointSchema = z.object({
  name: z.string()
    .min(1, 'Name is required')
    .max(100, 'Name too long')
    .regex(/^[a-zA-Z0-9-_]+$/, 'Name can only contain alphanumeric, dash, underscore'),
  
  rules: z.array(z.object({
    method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']),
    path: z.string()
      .regex(/^\/[a-zA-Z0-9-_/{}]*$/, 'Invalid path format'),
    conditions: z.array(z.object({
      type: z.enum(['header', 'query', 'body', 'state']),
      key: z.string(),
      operator: z.enum(['equals', 'contains', 'regex', 'exists']),
      value: z.any().optional(),
    })).optional(),
    response: z.object({
      status: z.number().min(100).max(599),
      body: z.any(),
      headers: z.record(z.string()).optional(),
      delay: z.number().min(0).max(30000).optional(),
    }),
  })).max(100, 'Too many rules (max 100)'),
  
  settings: z.object({
    webhookUrl: z.string().url().optional(),
    logRequests: z.boolean().optional(),
  }).optional(),
});

export const updateEndpointSchema = z.object({
  name: z.string()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z0-9-_]+$/)
    .optional(),
  rules: createEndpointSchema.shape.rules.optional(),
  settings: createEndpointSchema.shape.settings.optional(),
});

export type CreateEndpointInput = z.infer<typeof createEndpointSchema>;
export type UpdateEndpointInput = z.infer<typeof updateEndpointSchema>;
```

**File: Create new `src/schemas/state.schema.ts`**
```typescript
import { z } from 'zod';

export const stateValueSchema = z.any().refine(
  (val) => {
    try {
      const str = JSON.stringify(val);
      return str.length < 100 * 1024; // 100KB max
    } catch {
      return false;
    }
  },
  { message: 'State value too large (max 100KB)' }
);

export const stateKeySchema = z.string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9-_:.]+$/, 'Invalid state key format');

export const endpointIdSchema = z.string()
  .uuid('Invalid endpoint ID format');
```

**File: `src/routes/endpoints.routes.ts`**
```typescript
// ADD at top:
import { createEndpointSchema, updateEndpointSchema } from '../schemas/endpoint.schema.js';

// MODIFY create endpoint route (look for fastify.post):
fastify.post('/', {
  schema: {
    body: createEndpointSchema,  // ADD THIS
  },
  preHandler: authenticateApiKey,
  handler: async (request, reply) => {
    // Now TypeScript knows request.body matches CreateEndpointInput
    const user = getAuthenticatedUser(request);
    const { name, rules, settings } = request.body;
    // ... rest of handler
  }
});

// MODIFY update endpoint route:
fastify.put('/:id', {
  schema: {
    body: updateEndpointSchema,  // ADD THIS
  },
  preHandler: authenticateApiKey,
  handler: async (request, reply) => {
    // ... handler code
  }
});
```

**File: `src/routes/state.routes.ts`**
```typescript
// ADD at top:
import { stateValueSchema, stateKeySchema, endpointIdSchema } from '../schemas/state.schema.js';

// MODIFY POST /state/:endpointId/:key (around line 1995):
fastify.post<{ Params: { endpointId: string; key: string }; Body: { value: unknown } }>(
  '/:endpointId/:key',
  {
    schema: {
      params: z.object({
        endpointId: endpointIdSchema,
        key: stateKeySchema,
      }),
      body: z.object({
        value: stateValueSchema,
      }),
    },
  },
  async (request, reply) => {
    // Validation happens automatically
    // ... rest of handler
  }
);
```

---

### 3. Fix State Management Security

**File: `src/lib/state.ts`**
```typescript
// REPLACE entire file content with:
import { redis } from './redis.js';
import { logger } from './logger.js';
import { z } from 'zod';

const STATE_TTL = 7 * 24 * 60 * 60; // 7 days

// Validation schemas
const endpointIdRegex = /^[a-zA-Z0-9-]+$/;
const stateKeyRegex = /^[a-zA-Z0-9-_:.]+$/;

function validateEndpointId(endpointId: string): void {
  if (!endpointIdRegex.test(endpointId)) {
    throw new Error('Invalid endpoint ID format');
  }
}

function validateStateKey(key: string): void {
  if (!stateKeyRegex.test(key)) {
    throw new Error('Invalid state key format');
  }
  if (key.length > 100) {
    throw new Error('State key too long (max 100 characters)');
  }
}

function validateStateValue(value: unknown): void {
  const serialized = JSON.stringify(value);
  if (serialized.length > 100 * 1024) { // 100KB
    throw new Error('State value too large (max 100KB)');
  }
}

/**
 * Get state for endpoint
 */
export async function getState(endpointId: string, key: string): Promise<unknown> {
  try {
    validateEndpointId(endpointId);
    validateStateKey(key);
    
    const stateKey = `state:${endpointId}:${key}`;
    const value = await redis.get(stateKey);
    
    if (!value) {
      return null;
    }
    
    try {
      return JSON.parse(value);
    } catch (parseError) {
      logger.error({ parseError, endpointId, key }, 'Failed to parse state value');
      return null;
    }
  } catch (error) {
    logger.error({ error, endpointId, key }, 'Failed to get state');
    throw error; // Re-throw instead of swallowing
  }
}

/**
 * Set state for endpoint
 */
export async function setState(endpointId: string, key: string, value: unknown): Promise<void> {
  try {
    validateEndpointId(endpointId);
    validateStateKey(key);
    validateStateValue(value);
    
    const stateKey = `state:${endpointId}:${key}`;
    const serialized = JSON.stringify(value);
    
    await redis.setex(stateKey, STATE_TTL, serialized);
    logger.debug({ endpointId, key, size: serialized.length }, 'State set successfully');
  } catch (error) {
    logger.error({ error, endpointId, key }, 'Failed to set state');
    throw error;
  }
}

/**
 * Delete state for endpoint
 */
export async function deleteState(endpointId: string, key: string): Promise<void> {
  try {
    validateEndpointId(endpointId);
    validateStateKey(key);
    
    const stateKey = `state:${endpointId}:${key}`;
    await redis.del(stateKey);
    logger.debug({ endpointId, key }, 'State deleted successfully');
  } catch (error) {
    logger.error({ error, endpointId, key }, 'Failed to delete state');
    throw error;
  }
}

/**
 * Get all state keys for endpoint
 */
export async function listStateKeys(endpointId: string): Promise<string[]> {
  try {
    validateEndpointId(endpointId);
    
    const pattern = `state:${endpointId}:*`;
    const keys = await redis.keys(pattern);
    return keys.map((k) => k.replace(`state:${endpointId}:`, ''));
  } catch (error) {
    logger.error({ error, endpointId }, 'Failed to list state keys');
    throw error;
  }
}
```

---

### 4. Fix Memory Leak in Request Logging

**File: `src/middleware/request-logger.middleware.ts`**
```typescript
// FIND these constants (around line 263):
const BODY_TRUNCATE = 1024 * 1024; // 1MB

// REPLACE WITH:
const MAX_BODY_LOG_SIZE = 10 * 1024; // 10KB - much safer for logging
const MAX_BODY_STORAGE_SIZE = 100 * 1024; // 100KB - for database storage

// FIND the logRequest function and ADD truncation:
async function logRequest(data: RequestLogData) {
  // ADD this helper function:
  const truncateBody = (body: string | null | undefined): string | null => {
    if (!body) return null;
    if (body.length <= MAX_BODY_LOG_SIZE) return body;
    return body.substring(0, MAX_BODY_LOG_SIZE) + '... [TRUNCATED]';
  };

  // MODIFY the data before saving:
  const logData = {
    ...data,
    body: truncateBody(data.body),
    responseBody: truncateBody(data.responseBody),
  };

  try {
    await prisma.requestLog.create({ data: logData });
  } catch (error) {
    logger.error({ error }, 'Failed to log request');
    // Don't throw - logging failures shouldn't break requests
  }
}

// FIND where request body is read and ADD size check:
// Look for request.body parsing code and add:
if (JSON.stringify(request.body || '').length > MAX_BODY_STORAGE_SIZE) {
  logger.warn({ 
    method: request.method, 
    url: request.url 
  }, 'Request body too large for logging');
  // Don't store the body, just log metadata
  body = '[BODY TOO LARGE]';
}
```

---

## 🟠 HIGH PRIORITY (Fix This Week)

### 5. Add Missing Database Indexes

**File: `prisma/schema.prisma`**
```prisma
// FIND the Endpoint model and ADD these indexes:
model Endpoint {
  id        String   @id @default(uuid()) @db.Uuid
  userId    String   @db.Uuid
  name      String
  rules     Json     @default("[]")
  settings  Json     @default("{}")
  deletedAt DateTime?  // ADD THIS FIELD if not present
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  user        User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  requestLogs RequestLog[]

  @@unique([userId, name])
  @@index([userId])
  @@index([name])
  @@index([deletedAt])                    // ✅ ADD THIS
  @@index([updatedAt])                    // ✅ ADD THIS
  @@index([userId, deletedAt])            // ✅ ADD THIS (composite)
  @@index([userId, updatedAt])            // ✅ ADD THIS (composite)
  @@map("endpoints")
}

// ALSO ADD to RequestLog model:
model RequestLog {
  id              String   @id @default(uuid()) @db.Uuid
  endpointId      String   @db.Uuid
  timestamp       DateTime @default(now())
  method          String
  path            String
  query           Json?
  headers         Json?
  body            String?
  ip              String?
  userAgent       String?
  responseStatus  Int?
  responseHeaders Json?
  responseBody    String?
  latencyMs       Int?

  endpoint Endpoint @relation(fields: [endpointId], references: [id], onDelete: Cascade)

  @@index([endpointId, timestamp(sort: Desc)])
  @@index([endpointId])
  @@index([path])
  @@index([timestamp])
  @@index([timestamp(sort: Desc)])        // ✅ ADD THIS for cleanup queries
  @@index([method, path])                 // ✅ ADD THIS for analytics
  @@map("request_logs")
}
```

**Then run migration:**
```bash
npm run prisma:migrate dev --name add_performance_indexes
```

---

### 6. Fix Rate Limiting Security

**File: `src/middleware/rate-limit.middleware.ts`**
```typescript
// ADD at top:
import crypto from 'crypto';

// FIND rateLimitConfig.generalApi (around line 121):
generalApi: {
  max: 500,
  timeWindow: '1 hour',
  keyGenerator: (req: any) => req.ip,  // ❌ REPLACE THIS
  // ...
}

// REPLACE keyGenerator with:
keyGenerator: (req: any) => {
  const ip = req.ip;
  const userAgent = req.headers['user-agent'] || 'unknown';
  
  // Check for authenticated requests
  const authHeader = req.headers['authorization'];
  if (authHeader) {
    const [type, token] = authHeader.split(' ');
    if (type === 'Bearer' || type === 'ApiKey') {
      // Use token for authenticated users
      return `auth:${crypto.createHash('sha256').update(token).digest('hex')}`;
    }
  }
  
  // For anonymous: combine IP + User-Agent to prevent header spoofing
  const fingerprint = crypto
    .createHash('sha256')
    .update(`${ip}:${userAgent}`)
    .digest('hex');
  
  return `anon:${fingerprint}`;
},

// ALSO UPDATE endpointCreate config (around line 99):
endpointCreate: {
  max: 100,
  timeWindow: '1 minute',
  keyGenerator: (req: any) => {
    const user = req.user;
    if (user) {
      return `user:${user.id}`;
    }
    // Fallback to fingerprint
    const ip = req.ip;
    const userAgent = req.headers['user-agent'] || 'unknown';
    const fingerprint = crypto
      .createHash('sha256')
      .update(`${ip}:${userAgent}`)
      .digest('hex');
    return `anon:${fingerprint}`;
  },
  // ... rest
}
```

---

### 7. Optimize Redis Rate Limiting with Lua Script

**File: Create new `src/lib/rate-limit-scripts.ts`**
```typescript
/**
 * Lua script for atomic rate limiting
 */
export const rateLimitLuaScript = `
  local key = KEYS[1]
  local window = tonumber(ARGV[1])
  local limit = tonumber(ARGV[2])
  
  local current = redis.call('INCR', key)
  
  if current == 1 then
    redis.call('EXPIRE', key, window)
  end
  
  local ttl = redis.call('TTL', key)
  if ttl == -1 then
    redis.call('EXPIRE', key, window)
    ttl = window
  end
  
  return {current, ttl}
`;
```

**File: `src/middleware/rate-limit.middleware.ts`**
```typescript
// ADD at top:
import { rateLimitLuaScript } from '../lib/rate-limit-scripts.js';

// FIND the RedisRateLimitStore.incr method (around line 23):
// REPLACE the entire incr method implementation:

async incr(key: string, callback: (err: Error | null, result?: { current: number; ttl: number }) => void): Promise<void> {
  try {
    const redisKey = this.getKey('default', key);
    
    // Use Lua script for atomic operation (1 round-trip instead of 3)
    const result = await redis.eval(
      rateLimitLuaScript,
      1,
      redisKey,
      60,   // window in seconds
      100   // limit (should be configurable)
    ) as [number, number];
    
    const [current, ttl] = result;
    
    callback(null, { current, ttl });
  } catch (error) {
    logger.error({ error, key }, 'Rate limit store error');
    callback(error as Error);
  }
}

// DO THE SAME for the child.incr method (around line 60)
```

---

### 8. Add Webhook Retry Logic

**File: `package.json`**
```json
// ADD to dependencies:
{
  "dependencies": {
    "p-retry": "^6.2.0"
  }
}
```

**File: Create new `src/lib/webhook.ts`**
```typescript
import pRetry from 'p-retry';
import { logger } from './logger.js';

interface WebhookPayload {
  endpoint: {
    id: string;
    name: string;
  };
  request: {
    method: string;
    path: string;
    headers: Record<string, string>;
    body: any;
  };
  response: {
    status: number;
    body: any;
  };
  timestamp: string;
}

export async function triggerWebhook(
  url: string,
  payload: WebhookPayload
): Promise<void> {
  return pRetry(
    async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout
      
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'MockUrl-Webhook/1.0',
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
          throw new Error(`Webhook failed with status ${response.status}`);
        }
        
        logger.debug({ url, status: response.status }, 'Webhook delivered successfully');
      } catch (error) {
        clearTimeout(timeoutId);
        throw error;
      }
    },
    {
      retries: 3,
      factor: 2,
      minTimeout: 1000,
      maxTimeout: 10000,
      onFailedAttempt: (error) => {
        logger.warn({
          url,
          attempt: error.attemptNumber,
          retriesLeft: error.retriesLeft,
          error: error.message,
        }, 'Webhook retry attempt');
      },
    }
  );
}
```

**File: `src/routes/mock.router.ts`**
```typescript
// ADD at top:
import { triggerWebhook } from '../lib/webhook.js';

// FIND where webhook is triggered (around line 1884):
// REPLACE:
if (settings?.webhookUrl) {
  triggerWebhook(settings.webhookUrl, request, res).catch((err) => {
    logger.error({ err, webhookUrl: settings.webhookUrl }, 'Webhook trigger failed');
  });
}

// WITH:
if (settings?.webhookUrl) {
  const webhookPayload = {
    endpoint: {
      id: endpoint.id,
      name: endpoint.name,
    },
    request: {
      method: request.method,
      path: request.url,
      headers: sanitizeHeaders(request.headers),
      body: request.body,
    },
    response: {
      status: res.status,
      body: res.body,
    },
    timestamp: new Date().toISOString(),
  };
  
  // Fire and forget with retry logic
  triggerWebhook(settings.webhookUrl, webhookPayload).catch((err) => {
    logger.error({ 
      err: err.message, 
      webhookUrl: settings.webhookUrl,
      endpointId: endpoint.id 
    }, 'Webhook delivery failed after retries');
  });
}

// ADD helper function:
function sanitizeHeaders(headers: Record<string, any>): Record<string, string> {
  const sanitized = { ...headers };
  delete sanitized.authorization;
  delete sanitized.cookie;
  delete sanitized['x-api-key'];
  return sanitized;
}
```

---

## 🟡 MEDIUM PRIORITY (Fix This Month)

### 9. Fix Cache Race Conditions

**File: `src/utils/endpoint.cache.ts`**
```typescript
// FIND invalidateEndpointCache function (around line 300):
// REPLACE entire function:

export async function invalidateEndpointCache(endpointId: string): Promise<void> {
  return tracer.startActiveSpan('invalidate-endpoint-cache', async (span) => {
    try {
      // Use version-based invalidation instead of deleting keys
      const versionKey = `endpoint:version:${endpointId}`;
      const newVersion = await redis.incr(versionKey);
      
      span.setAttribute('endpoint.id', endpointId);
      span.setAttribute('cache.new_version', newVersion);
      
      logger.debug({ endpointId, version: newVersion }, 'Invalidated endpoint cache');
    } catch (error) {
      span.recordException(error as Error);
      logger.error({ error, endpointId }, 'Failed to invalidate endpoint cache');
    } finally {
      span.end();
    }
  });
}

// FIND cacheEndpointDetail function:
// REPLACE with version-aware caching:

export async function cacheEndpointDetail(
  endpointId: string,
  data: any
): Promise<void> {
  return tracer.startActiveSpan('cache-endpoint-detail', async (span) => {
    try {
      const versionKey = `endpoint:version:${endpointId}`;
      const version = await redis.get(versionKey) || '0';
      
      const key = `${getEndpointDetailCacheKey(endpointId)}:v${version}`;
      await redis.setex(key, ENDPOINT_DETAIL_TTL, JSON.stringify(data));
      
      span.setAttribute('cache.key', key);
      span.setAttribute('cache.version', version);
      
      logger.debug({ endpointId, version }, 'Cached endpoint detail');
    } catch (error) {
      span.recordException(error as Error);
      logger.error({ error, endpointId }, 'Failed to cache endpoint detail');
    } finally {
      span.end();
    }
  });
}

// FIND getCachedEndpointDetail function:
// REPLACE with version-aware retrieval:

export async function getCachedEndpointDetail(endpointId: string): Promise<any | null> {
  return tracer.startActiveSpan('get-cached-endpoint-detail', async (span) => {
    try {
      const versionKey = `endpoint:version:${endpointId}`;
      const version = await redis.get(versionKey) || '0';
      
      const key = `${getEndpointDetailCacheKey(endpointId)}:v${version}`;
      const cached = await redis.get(key);
      
      span.setAttribute('cache.hit', !!cached);
      span.setAttribute('cache.version', version);
      
      if (cached) {
        logger.debug({ endpointId, version }, 'Cache hit');
        return JSON.parse(cached);
      }
      
      logger.debug({ endpointId, version }, 'Cache miss');
      return null;
    } catch (error) {
      span.recordException(error as Error);
      logger.error({ error, endpointId }, 'Failed to get cached endpoint');
      return null;
    } finally {
      span.end();
    }
  });
}
```

---

### 10. Add Transaction Support for Critical Operations

**File: `src/routes/endpoints.routes.ts`**
```typescript
// FIND the create endpoint handler:
// WRAP critical operations in transaction:

fastify.post('/', {
  schema: { body: createEndpointSchema },
  preHandler: authenticateApiKey,
  handler: async (request, reply) => {
    const user = getAuthenticatedUser(request);
    const { name, rules, settings } = request.body;
    
    try {
      // Use transaction for atomicity
      const endpoint = await prisma.$transaction(async (tx) => {
        // Create endpoint
        const newEndpoint = await tx.endpoint.create({
          data: {
            userId: user.id,
            name,
            rules: rules || [],
            settings: settings || {},
          },
        });
        
        // Initialize state (if this fails, endpoint creation rolls back)
        try {
          await setState(newEndpoint.id, 'initialized', true);
          await setState(newEndpoint.id, 'request_count', 0);
        } catch (stateError) {
          logger.error({ stateError, endpointId: newEndpoint.id }, 'Failed to initialize state');
          throw new Error('Failed to initialize endpoint state');
        }
        
        return newEndpoint;
      });
      
      // Invalidate cache after successful creation
      await invalidateUserEndpointsCache(user.id);
      
      return reply.status(201).send({
        success: true,
        endpoint,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error({ error, userId: user.id }, 'Failed to create endpoint');
      return reply.status(500).send({
        success: false,
        error: {
          code: 'ENDPOINT_CREATE_FAILED',
          message: 'Failed to create endpoint',
        },
        timestamp: new Date().toISOString(),
      });
    }
  }
});
```

**Note:** If using PgBouncer in transaction mode, you may need to:
1. Use `DIRECT_DATABASE_URL` for transactions
2. Or switch critical operations to use a direct connection pool

**File: `src/lib/db.ts`**
```typescript
// ADD a separate client for transactions:

export const prismaForTransactions = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DIRECT_DATABASE_URL, // Direct connection, not PgBouncer
    },
  },
});

// Use prismaForTransactions for operations that need transactions
```

---

### 11. Add Comprehensive Error Handling

**File: Create new `src/lib/errors.ts`**
```typescript
export class AppError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500,
    public isOperational: boolean = true
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR', 400);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(`${resource} not found`, 'NOT_FOUND', 404);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = 'Unauthorized') {
    super(message, 'UNAUTHORIZED', 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = 'Forbidden') {
    super(message, 'FORBIDDEN', 403);
  }
}

export class RateLimitError extends AppError {
  constructor(public retryAfter: number) {
    super('Rate limit exceeded', 'RATE_LIMIT_EXCEEDED', 429);
  }
}

export class StateError extends AppError {
  constructor(message: string, public cause?: Error) {
    super(message, 'STATE_ERROR', 500);
  }
}

export class DatabaseError extends AppError {
  constructor(message: string, public cause?: Error) {
    super(message, 'DATABASE_ERROR', 500);
  }
}
```

**File: `src/lib/state.ts`**
```typescript
// UPDATE to use custom errors:
import { StateError } from './errors.js';

export async function getState(endpointId: string, key: string): Promise<unknown> {
  try {
    validateEndpointId(endpointId);
    validateStateKey(key);
    // ... rest of code
  } catch (error) {
    if (error instanceof Error && error.message.includes('Invalid')) {
      throw new ValidationError(error.message);
    }
    logger.error({ error, endpointId, key }, 'Failed to get state');
    throw new StateError('Failed to retrieve state', error as Error);
  }
}
```

---

### 12. Add TypeScript Strict Settings

**File: `tsconfig.json`**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "lib": ["ES2022"],
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "allowJs": false,
    "outDir": "./dist",
    "rootDir": "./src",
    "removeComments": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    
    // ✅ KEEP EXISTING:
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "skipLibCheck": true,
    "allowSyntheticDefaultImports": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": false,
    
    // ✅ ADD THESE:
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "strictBindCallApply": true,
    "strictPropertyInitialization": true,
    "noImplicitThis": true,
    "alwaysStrict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noPropertyAccessFromIndexSignature": true,
    
    "types": ["node", "vitest/globals"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts", "**/*.spec.ts"]
}
```

---

### 13. Create Constants File

**File: Create new `src/config/constants.ts`**
```typescript
/**
 * Application-wide constants
 */

// Cache TTLs (in seconds)
export const CacheTTL = {
  ENDPOINT_LIST: 5 * 60,           // 5 minutes
  ENDPOINT_DETAIL: 10 * 60,        // 10 minutes
  STATE_VALUE: 7 * 24 * 60 * 60,   // 7 days
  USER_SESSION: 24 * 60 * 60,      // 24 hours
} as const;

// Size limits
export const Limits = {
  MAX_REQUEST_BODY_SIZE: 1024 * 1024,      // 1MB - incoming requests
  MAX_LOG_BODY_SIZE: 10 * 1024,            // 10KB - what we log
  MAX_STATE_VALUE_SIZE: 100 * 1024,        // 100KB - state storage
  MAX_RULES_PER_ENDPOINT: 100,             // Maximum rules
  MAX_ENDPOINTS_PER_USER: 1000,            // User quota
  MAX_WEBHOOK_PAYLOAD_SIZE: 256 * 1024,    // 256KB - webhook body
} as const;

// Rate limiting
export const RateLimits = {
  ENDPOINT_CREATE_MAX: 100,
  ENDPOINT_CREATE_WINDOW: 60,              // seconds
  GENERAL_API_MAX: 500,
  GENERAL_API_WINDOW: 3600,                // 1 hour in seconds
  MOCK_REQUEST_MAX: 1000,
  MOCK_REQUEST_WINDOW: 60,
} as const;

// Retry configuration
export const RetryConfig = {
  WEBHOOK_MAX_RETRIES: 3,
  WEBHOOK_MIN_TIMEOUT: 1000,               // 1 second
  WEBHOOK_MAX_TIMEOUT: 10000,              // 10 seconds
  WEBHOOK_BACKOFF_FACTOR: 2,
} as const;

// Timeouts (in milliseconds)
export const Timeouts = {
  WEBHOOK_REQUEST: 5000,                   // 5 seconds
  DATABASE_QUERY: 10000,                   // 10 seconds
  REDIS_OPERATION: 5000,                   // 5 seconds
} as const;

// Validation regex
export const ValidationRegex = {
  ENDPOINT_NAME: /^[a-zA-Z0-9-_]+$/,
  ENDPOINT_PATH: /^\/[a-zA-Z0-9-_/{}]*$/,
  STATE_KEY: /^[a-zA-Z0-9-_:.]+$/,
  UUID: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
} as const;

// Headers to sanitize
export const SENSITIVE_HEADERS = [
  'authorization',
  'x-api-key',
  'cookie',
  'x-auth-token',
] as const;

// Log retention
export const LogRetention = {
  REQUEST_LOGS_DAYS: 10,
  ERROR_LOGS_DAYS: 30,
} as const;
```

**Then update files to use constants:**

**File: `src/lib/state.ts`**
```typescript
import { CacheTTL, Limits, ValidationRegex } from '../config/constants.js';

// Replace:
const STATE_TTL = 7 * 24 * 60 * 60;
// With:
const STATE_TTL = CacheTTL.STATE_VALUE;

// Replace regex:
const stateKeyRegex = /^[a-zA-Z0-9-_:.]+$/;
// With:
const stateKeyRegex = ValidationRegex.STATE_KEY;

// Replace size check:
if (serialized.length > 100 * 1024) {
// With:
if (serialized.length > Limits.MAX_STATE_VALUE_SIZE) {
```

---

## 🟢 LOW PRIORITY (Nice to Have)

### 14. Add Health Check Granularity

**File: `src/lib/db.ts`**
```typescript
// ADD timing to health check:
export async function checkDatabaseHealth(): Promise<{ healthy: boolean; responseTime: number }> {
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    const responseTime = Date.now() - start;
    return { healthy: true, responseTime };
  } catch (error) {
    logger.error('Database health check failed', { error });
    return { healthy: false, responseTime: Date.now() - start };
  }
}
```

**File: `src/lib/redis.ts`**
```typescript
// ADD timing to health check:
export async function checkRedisHealth(): Promise<{ healthy: boolean; responseTime: number }> {
  const start = Date.now();
  try {
    const result = await redis.ping();
    const responseTime = Date.now() - start;
    return { healthy: result === 'PONG', responseTime };
  } catch (error) {
    logger.error('Redis health check failed', { error });
    return { healthy: false, responseTime: Date.now() - start };
  }
}
```

**File: `src/index.ts`**
```typescript
// UPDATE /health endpoint:
app.get('/health', async function(request, reply) {
  _ = request;
  try {
    const [dbHealth, redisHealth] = await Promise.all([
      checkDatabaseHealth(),
      checkRedisHealth(),
    ]);
    
    const isHealthy = dbHealth.healthy && redisHealth.healthy;
    
    return reply.status(isHealthy ? 200 : 503).send({
      status: isHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || 'unknown',
      uptime: process.uptime(),
      checks: {
        database: {
          healthy: dbHealth.healthy,
          responseTime: `${dbHealth.responseTime}ms`,
        },
        redis: {
          healthy: redisHealth.healthy,
          responseTime: `${redisHealth.responseTime}ms`,
        },
      },
    });
  } catch (err: unknown) {
    logger.error('Health check failed', err as Error);
    return reply.status(503).send({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'Health check failed',
    });
  }
});
```

---

### 15. Add Prometheus Metrics (Optional)

**File: `package.json`**
```json
{
  "dependencies": {
    "prom-client": "^15.1.0"
  }
}
```

**File: Create new `src/lib/metrics.ts`**
```typescript
import client from 'prom-client';

export const register = new client.Registry();

// Default metrics (CPU, memory, etc.)
client.collectDefaultMetrics({ register });

// HTTP request duration
export const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.001, 0.01, 0.1, 0.5, 1, 2, 5],
  registers: [register],
});

// Mock request counter
export const mockRequestsTotal = new client.Counter({
  name: 'mock_requests_total',
  help: 'Total number of mock requests served',
  labelNames: ['endpoint_id', 'method', 'status_code'],
  registers: [register],
});

// Database query duration
export const dbQueryDuration = new client.Histogram({
  name: 'db_query_duration_seconds',
  help: 'Duration of database queries in seconds',
  labelNames: ['operation', 'table'],
  buckets: [0.001, 0.01, 0.05, 0.1, 0.5, 1],
  registers: [register],
});

// Cache hit rate
export const cacheHits = new client.Counter({
  name: 'cache_hits_total',
  help: 'Total cache hits',
  labelNames: ['cache_type'],
  registers: [register],
});

export const cacheMisses = new client.Counter({
  name: 'cache_misses_total',
  help: 'Total cache misses',
  labelNames: ['cache_type'],
  registers: [register],
});
```

**File: `src/index.ts`**
```typescript
// ADD at top:
import { register } from './lib/metrics.js';

// ADD metrics endpoint:
app.get('/metrics', async function(request, reply) {
  _ = request;
  reply.header('Content-Type', register.contentType);
  return register.metrics();
});
```

---

### 16. Optimize Dockerfile

**File: Create/Update `Dockerfile`**
```dockerfile
# Multi-stage build for production optimization
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies first (better caching)
COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci --only=production && \
    npm cache clean --force

# Copy source and build
COPY . .
RUN npm run build

# Generate Prisma Client
RUN npx prisma generate

# ============================================
# Production stage - minimal image
# ============================================
FROM node:20-alpine

WORKDIR /app

# Install only runtime dependencies
RUN apk add --no-cache \
    tini \
    dumb-init

# Copy built artifacts
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/prisma ./prisma

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

USER nodejs

EXPOSE 3000

# Use tini to handle signals properly
ENTRYPOINT ["/sbin/tini", "--"]

CMD ["node", "dist/index.js"]

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/healthz/live', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"
```

---

## Summary Checklist

### Immediate (Critical) - Today ✅
- [ ] Remove hardcoded secrets from `src/lib/auth.ts`
- [ ] Add environment validation in `src/index.ts`
- [ ] Create input validation schemas in `src/schemas/`
- [ ] Apply schemas to routes in `src/routes/endpoints.routes.ts` and `src/routes/state.routes.ts`
- [ ] Fix state validation in `src/lib/state.ts`
- [ ] Reduce body logging size in `src/middleware/request-logger.middleware.ts`

### This Week (High Priority) ✅
- [ ] Add database indexes in `prisma/schema.prisma` + migrate
- [ ] Fix rate limit key generator in `src/middleware/rate-limit.middleware.ts`
- [ ] Create Lua script for Redis in `src/lib/rate-limit-scripts.ts`
- [ ] Add webhook retry logic in `src/lib/webhook.ts`
- [ ] Update mock router to use new webhook function

### This Month (Medium Priority) ✅
- [ ] Fix cache race conditions in `src/utils/endpoint.cache.ts`
- [ ] Add transaction support in `src/routes/endpoints.routes.ts`
- [ ] Create error classes in `src/lib/errors.ts`
- [ ] Update TypeScript config for strict mode
- [ ] Create constants file in `src/config/constants.ts`

### Nice to Have (Low Priority) ✅
- [ ] Enhance health checks with timing
- [ ] Add Prometheus metrics (optional)
- [ ] Optimize Dockerfile

---

## Testing After Changes

After making changes, run:

```bash
# 1. Install any new dependencies
npm install

# 2. Run database migrations (for index changes)
npm run prisma:migrate dev

# 3. Run type checking
npm run type-check  # or npx tsc --noEmit

# 4. Run tests
npm test

# 5. Test health endpoints
curl http://localhost:3000/health
curl http://localhost:3000/healthz/ready

# 6. Test with authentication
curl -H "Authorization: Bearer YOUR_TOKEN" http://localhost:3000/api/v1/endpoints
```

---

**Questions? Need help with any specific change? Let me know!**
