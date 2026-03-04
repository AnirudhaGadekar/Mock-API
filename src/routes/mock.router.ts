import { SpanStatusCode, trace } from '@opentelemetry/api';
import { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';
import { applyChaos } from '../engine/chaos.js';
import { renderBody, type TemplateContext } from '../engine/templating.js';
import { broadcastRequest } from '../engine/websocket.js';
import { prisma } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { redis } from '../lib/redis.js';
import { setState } from '../lib/state.js';
import { checkRateLimit } from '../middleware/rate-limit.middleware.js';
import { requestLoggerPostHook } from '../middleware/request-logger.middleware.js';
import type {
  Endpoint,
  EndpointSettings,
  HeaderRewritingRule,
  MatchedRule,
  Rule,
  RuleCondition,
  RuleResponse
} from '../types/mock.types.js';
import {
  bufferRequestCount,
  cacheSubdomainMapping,
  getEndpointSubdomainCacheKey,
  getNextSequenceIndex
} from '../utils/endpoint.cache.js';
import { assertSafeWebhookUrl } from '../utils/ssrf.js';

const tracer = trace.getTracer('mock-router');

/**
 * Custom error for endpoint not found
 */
class EndpointNotFoundError extends Error {
  constructor(subdomain: string) {
    super(`Endpoint not found: ${subdomain}`);
    this.name = 'EndpointNotFoundError';
  }
}

function getAllowedMockDomains(): string[] {
  const base = (process.env.BASE_MOCK_DOMAIN || 'mockurl.com').toLowerCase();
  const extra = (process.env.ALLOWED_MOCK_DOMAINS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set([base, ...extra]));
}

function hostnameMatchesAllowedMockDomain(hostname: string, domains: string[]): boolean {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1') return true;
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
}

function extractSubdomainFromHostname(hostname: string, domains: string[]): string | null {
  const host = hostname.toLowerCase();
  for (const d of domains) {
    if (host === d) return null;
    const suffix = `.${d}`;
    if (host.endsWith(suffix)) {
      const sub = host.slice(0, -suffix.length);
      return sub.length > 0 ? sub : null;
    }
  }
  return null;
}

/**
 * Extract subdomain from hostname or path
 * Supports both:
 * - Subdomain routing: my-endpoint.mockurl.com
 * - Path routing: mockurl.com/my-endpoint (fallback)
 */
function extractSubdomain(request: FastifyRequest): string | null {
  const hostname = request.hostname;
  const path = request.url.split('?')[0];
  const allowedDomains = getAllowedMockDomains();

  // Subdomain routing (preferred if configured with wildcard)
  if (hostname && hostnameMatchesAllowedMockDomain(hostname, allowedDomains)) {
    const sub = extractSubdomainFromHostname(hostname, allowedDomains);
    if (sub) return sub;
  }

  // Path-based routing with /e/ prefix (e.g., /e/my-endpoint/...)
  const pathParts = path.split('/').filter(Boolean);
  if (pathParts.length >= 2 && pathParts[0] === 'e') {
    return pathParts[1];
  }

  // Fallback path-based routing without prefix (e.g., /my-endpoint/...)
  if (pathParts.length > 0 && pathParts[0].match(/^[a-z0-9-]+$/)) {
    // Only use if not a reserved system path
    const reserved = ['api', 'health', 'metrics', 'auth', 'console', 'invite'];
    if (!reserved.includes(pathParts[0])) {
      return pathParts[0];
    }
  }

  return null;
}

/**
 * Fetch endpoint by subdomain with caching
 */
async function fetchEndpointBySubdomain(subdomain: string): Promise<Endpoint> {
  return tracer.startActiveSpan('fetch-endpoint-by-subdomain', async (span) => {
    try {
      span.setAttribute('endpoint.subdomain', subdomain);

      // FIXED: Use centralized cache key generator
      const cacheKey = getEndpointSubdomainCacheKey(subdomain);
      const cached = await redis.get(cacheKey);

      if (cached) {
        span.setAttribute('cache.hit', true);
        return JSON.parse(cached);
      }

      span.setAttribute('cache.hit', false);

      const endpoint = await prisma.endpoint.findFirst({
        where: {
          name: subdomain,
        },
        select: {
          id: true,
          name: true,
          rules: true,
          userId: true,
          requestCount: true,
          settings: true, // Needed for webhook
        },
      });

      if (!endpoint) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: 'Endpoint not found' });
        throw new EndpointNotFoundError(subdomain);
      }

      // Cache for future requests
      // FIXED: Removed userId from cacheSubdomainMapping args
      await cacheSubdomainMapping(subdomain, endpoint);

      span.setAttribute('endpoint.id', endpoint.id);
      const rulesArr = Array.isArray(endpoint.rules) ? endpoint.rules : [];
      span.setAttribute('endpoint.rules_count', rulesArr.length);

      return endpoint;
    } catch (error) {
      span.recordException(error as Error);
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Apply CORS headers for mock endpoints (wildcard for subdomains)
 * Updated for security: Reflect request origin to support credentials.
 */
function applyCorsHeaders(reply: FastifyReply, request: FastifyRequest): void {
  const origin = request.headers.origin;

  // Reflect the origin if present, otherwise allow all (for tools like curl)
  if (origin) {
    reply.header('Access-Control-Allow-Origin', origin);
    reply.header('Vary', 'Origin'); // Important for caching
  } else {
    reply.header('Access-Control-Allow-Origin', '*');
  }

  reply.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD');
  reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, X-Mock-Response-Status, X-Mock-Response-Delay');
  reply.header('Access-Control-Allow-Credentials', 'true');
  reply.header('Access-Control-Max-Age', '86400'); // 24 hours
}

/**
 * Get pathname from request (no query string)
 */
function getPathname(request: FastifyRequest): string {
  const url = request.url || '';
  return url.split('?')[0] || '/';
}

/**
 * Normalize path for rule matching.
 *
 * - Subdomain routing (e.g. https://my-api.mockurl.com/users): pathname is /users, subdomain is my-api → use /users
 * - Path-based routing (e.g. https://app.com/my-api/users): pathname is /my-api/users, subdomain is my-api → strip /my-api prefix → /users
 *
 * This ensures rules defined as /users or /users/:id match correctly in both modes.
 */
function getPathForRuleMatching(pathname: string, subdomain: string | null): string {
  if (!subdomain) return pathname;

  const pathParts = pathname.split('/').filter(Boolean);

  // Handle /e/[subdomain]/...
  if (pathParts.length >= 2 && pathParts[0] === 'e' && pathParts[1] === subdomain) {
    return '/' + pathParts.slice(2).join('/');
  }

  // Handle /[subdomain]/... (legacy/fallback)
  if (pathParts.length >= 1 && pathParts[0] === subdomain) {
    return '/' + pathParts.slice(1).join('/');
  }

  return pathname;
}

// Types are now imported from '../types/mock.types.js'

import { match as matchPath } from 'path-to-regexp';

// Regex Cache to prevent ReDoS / Re-compilation.
const MAX_REGEX_CACHE_SIZE = 1000;
const pathMatchCache = new Map<string, any>();

/**
 * Check if request path matches rule path (supports :param placeholders).
 * Uses path-to-regexp for standardization.
 */
function pathMatches(rulePath: string, pathname: string): { match: boolean; params: Record<string, string> } {
  let matcher = pathMatchCache.get(rulePath);

  if (!matcher) {
    matcher = matchPath(rulePath, { decode: decodeURIComponent });
    if (pathMatchCache.size >= MAX_REGEX_CACHE_SIZE) {
      const firstKey = pathMatchCache.keys().next().value;
      if (firstKey) pathMatchCache.delete(firstKey);
    }
    pathMatchCache.set(rulePath, matcher);
  }

  const result = matcher(pathname);
  if (!result) return { match: false, params: {} };

  return { match: true, params: result.params as Record<string, string> };
}

/**
 * Check if request matches rule conditions (query params, headers, body contains)
 */
function matchesCondition(condition: RuleCondition | undefined, request: FastifyRequest): boolean {
  if (!condition) return true;
  const query = request.query as Record<string, string | string[]>;
  const headers = request.headers;
  const body = request.body as string | object | undefined;

  if (condition.queryParams) {
    for (const [key, expected] of Object.entries(condition.queryParams)) {
      const actual = query[key];
      if (Array.isArray(actual)) {
        if (!actual.includes(expected)) return false;
      } else if (actual !== expected) return false;
    }
  }

  if (condition.headers) {
    for (const [key, expected] of Object.entries(condition.headers)) {
      const actual = headers[key.toLowerCase()];
      if (Array.isArray(actual)) {
        if (!actual.includes(expected)) return false;
      } else if (actual !== expected) return false;
    }
  }

  if (condition.bodyContains) {
    let bodyStr = '';
    if (typeof body === 'string') bodyStr = body;
    else if (body) bodyStr = JSON.stringify(body);
    if (!bodyStr.includes(condition.bodyContains)) return false;
  }

  if (condition.jwtValidation) {
    const { header = 'authorization', secret, issuer, audience, required = true } = condition.jwtValidation;
    const authHeader = headers[header.toLowerCase()];

    if (!authHeader && required) return false;

    if (authHeader) {
      const token = Array.isArray(authHeader)
        ? authHeader[0].replace(/^Bearer\s+/i, '')
        : authHeader.replace(/^Bearer\s+/i, '');

      try {
        jwt.verify(token, secret, { issuer, audience });
      } catch (err) {
        logger.debug(`JWT Validation failed for mock endpoint: ${err instanceof Error ? err.message : 'Unknown error'}`);
        return false;
      }
    }
  }

  return true;
}

/**
 * Find first rule that matches method, path, and conditions (with sequence support)
 * 
 * Sequence logic: If any rule with matching path/method has sequence=true,
 * cycle through ALL such rules (regardless of conditions), then check if
 * the selected rule matches conditions.
 */
async function findMatchingRule(
  rules: unknown,
  method: string,
  pathname: string,
  request: FastifyRequest,
  endpointId: string
): Promise<MatchedRule | null> {
  const arr = Array.isArray(rules) ? rules : [];

  // First pass: Find all rules with matching path/method (regardless of conditions)
  const pathMethodRules: Array<{ rule: Rule; params: Record<string, string>; index: number }> = [];
  for (let i = 0; i < arr.length; i++) {
    const rule = arr[i] as Rule;
    if (rule.method !== method) continue;
    const { match, params } = pathMatches(rule.path, pathname);
    if (!match) continue;
    pathMethodRules.push({ rule, params, index: i });
  }

  if (pathMethodRules.length === 0) return null;

  // Check if any rule has sequence enabled
  const hasSequence = pathMethodRules.some(r => r.rule.sequence === true);

  if (hasSequence) {
    // Use sequence logic: cycle through all path/method matching rules
    const sequenceCount = pathMethodRules.length;
    // Use rule ID if present for stable key across edits, else use first rule index in array
    const firstRule = pathMethodRules[0].rule;
    const ruleGroupKey =
      typeof firstRule.id === 'string' && firstRule.id
        ? firstRule.id
        : `i${pathMethodRules[0].index}`;
    const sequenceIndex = await getNextSequenceIndex(endpointId, ruleGroupKey, sequenceCount);
    const selected = pathMethodRules[sequenceIndex];

    // Check if selected rule matches conditions
    if (matchesCondition(selected.rule.condition, request)) {
      return { rule: selected.rule, params: selected.params, sequenceIndex };
    }

    // If selected rule doesn't match conditions, try to find next matching rule in sequence
    // This handles cases where some sequence rules have conditions and others don't
    for (let offset = 1; offset < sequenceCount; offset++) {
      const nextIndex = (sequenceIndex + offset) % sequenceCount;
      const nextRule = pathMethodRules[nextIndex];
      if (matchesCondition(nextRule.rule.condition, request)) {
        return { rule: nextRule.rule, params: nextRule.params, sequenceIndex: nextIndex };
      }
    }

    // No sequence rule matches conditions, fall through to non-sequence matching
  }

  // Non-sequence logic: return first rule that matches conditions
  for (const { rule, params } of pathMethodRules) {
    if (matchesCondition(rule.condition, request)) {
      return { rule, params };
    }
  }

  return null;
}

/**
 * Simple template substitution (MockUrl-style): {{req.body}}, {{req.params.id}}, {{JSON.stringify(req.body)}}
 */
function interpolate(
  value: string,
  request: FastifyRequest,
  pathParams: Record<string, string>
): string {
  let out = value;
  const body = request.body as object | undefined;
  // Use try-catch for JSON stringify to avoid circular reference crashes
  let bodyStr = '{}';
  try {
    bodyStr = body !== undefined && body !== null ? JSON.stringify(body) : '{}';
  } catch (e) {
    bodyStr = '[Circular or Invalid JSON]'; // Fallback
  }

  out = out.replace(/\{\{JSON\\.stringify\(req\\.body\)\}\}/g, bodyStr);
  out = out.replace(/\{\{req\\.body\}\}/g, bodyStr);
  for (const [key, val] of Object.entries(pathParams)) {
    out = out.replace(new RegExp(`\\{\\{req\\.params\\.${key}\\}\\}`, 'g'), val);
  }
  if (body && typeof body === 'object') {
    for (const [key, val] of Object.entries(body)) {
      // Avoid circular here too if possible, but simplistic check is hard. 
      // Assuming body is JSON-safe from Fastify.
      const v = typeof val === 'object' ? JSON.stringify(val) : String(val);
      out = out.replace(new RegExp(`\\{\\{req\\.body\\.${key}\\}\\}`, 'g'), v);
    }
  }
  return out;
}

/**
 * Apply header rewriting rules (SET, APPEND, DELETE) to a headers object.
 */
async function applyHeaderRewriting(
  headers: Record<string, string>,
  rules: HeaderRewritingRule[] | undefined,
  ctx: TemplateContext
): Promise<Record<string, string>> {
  if (!rules || !Array.isArray(rules)) return headers;

  const result = { ...headers };
  for (const rule of rules) {
    const key = rule.key.toLowerCase();
    const value = rule.value ? await renderBody(rule.value, ctx) : '';
    const strValue = String(value);

    switch (rule.op) {
      case 'SET':
        result[key] = strValue;
        break;
      case 'APPEND':
        result[key] = result[key] ? `${result[key]}, ${strValue}` : strValue;
        break;
      case 'DELETE':
        delete result[key];
        break;
    }
  }
  return result;
}

/**
 * Apply interpolation + advanced templating (Handlebars + Faker + state).
 * Keeps backwards compatibility for {{req.body}} placeholders, then runs
 * the new template engine on top.
 */
async function applyInterpolation(
  response: RuleResponse,
  request: FastifyRequest,
  pathParams: Record<string, string>
): Promise<RuleResponse> {
  let headers: Record<string, string> = {};
  if (response.headers) {
    for (const [k, v] of Object.entries(response.headers)) {
      headers[k] = typeof v === 'string' ? interpolate(v, request, pathParams) : String(v);
    }
  }

  const endpoint = (request as FastifyRequest & { endpoint?: Endpoint }).endpoint;
  const templateCtx: TemplateContext = {
    req: {
      method: request.method,
      path: request.url,
      body: request.body,
      headers: Object.fromEntries(
        Object.entries(request.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : String(v)]),
      ),
      query: request.query as Record<string, string>,
      params: pathParams,
      ip: request.ip,
    },
    endpointId: endpoint?.id,
  };

  // Apply rule-level header rewriting
  if (response.headerRewriting) {
    headers = await applyHeaderRewriting(headers, response.headerRewriting, templateCtx);
  }

  // Apply global endpoint header rewriting if applicable
  const settings = endpoint?.settings as EndpointSettings | undefined;
  if (settings?.globalHeaderRewriting) {
    headers = await applyHeaderRewriting(headers, settings.globalHeaderRewriting, templateCtx);
  }

  let body = response.body;

  if (typeof body === 'string') {
    // Legacy interpolation ({{req.body}} etc.)
    const legacy = interpolate(body, request, pathParams);
    // Advanced templating: Handlebars + Faker + state
    body = await renderBody(legacy, templateCtx);
  } else if (body && typeof body === 'object') {
    body = await renderBody(body, templateCtx);
  }

  return { ...response, body, headers: Object.keys(headers).length ? headers : undefined };
}

/**
 * Trigger webhook (async, non-blocking)
 */
async function triggerWebhook(url: string, request: FastifyRequest, response: RuleResponse): Promise<void> {
  const safeUrl = await assertSafeWebhookUrl(url);
  const payload = {
    timestamp: new Date().toISOString(),
    endpointId: request.endpoint?.id,
    method: request.method,
    path: request.url,
    query: request.query,
    headers: request.headers,
    body: request.body,
    response: {
      status: response.status,
      headers: response.headers,
      body: response.body,
    },
  };
  await fetch(safeUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(5000),
    redirect: 'error',
  });
}

/**
 * Default response when no rule matches (MockUrl-style fallback)
 */
function generateDefaultResponse(endpoint: { id: string; name: string; rules: unknown }, _request: FastifyRequest) {
  const rulesArr = Array.isArray(endpoint.rules) ? endpoint.rules : [];
  return {
    message: 'Mock endpoint active',
    activeRules: rulesArr.length,
    endpointId: endpoint.id,
    timestamp: new Date().toISOString(),
  };
}

function applyChaosResponseHeaders(reply: FastifyReply, chaosApplied: string[], delayedMs?: number): void {
  reply.header('X-Mock-Chaos-Applied', chaosApplied.length > 0 ? chaosApplied.join(',') : 'none');
  if (delayedMs !== undefined) {
    reply.header('X-Mock-Chaos-Delay-Ms', String(delayedMs));
  }
}

/**
 * Production mock router plugin
 * Handles all requests to mock endpoints (subdomain routing)
 */
export const mockRouterPlugin: FastifyPluginAsync = async (fastify, _opts) => {
  /**
   * PreHandler: Extract subdomain and load endpoint
   */
  fastify.addHook('preHandler', async (request, reply) => {
    return tracer.startActiveSpan('mock-router-prehandler', async (span) => {
      try {
        // Skip API routes completely - let them be handled by their respective routers
        if (request.url.startsWith('/api/')) {
          return;
        }
        
        // Extract subdomain from hostname or URL
        const subdomain = extractSubdomain(request);

        if (!subdomain) {
          span.setAttribute('error', 'no_subdomain');
          return reply.status(404).send({
            success: false,
            error: {
              code: 'INVALID_ENDPOINT',
              message: 'No endpoint subdomain detected. Use format: https://your-endpoint.mockurl.com',
            },
            timestamp: new Date().toISOString(),
          });
        }

        span.setAttribute('endpoint.subdomain', subdomain);

        // Fetch endpoint (with caching)
        const endpoint = await fetchEndpointBySubdomain(subdomain);

        // Rate limit per endpoint/IP (100 req/min free tier)
        const rateLimit = await checkRateLimit(`endpoint:${endpoint.id}:${request.ip}`, 100, 60);

        if (!rateLimit.allowed) {
          span.setAttribute('rate_limited', true);
          return reply.status(429).send({
            success: false,
            error: {
              code: 'RATE_LIMIT_EXCEEDED',
              message: 'Too many requests to this endpoint. Please try again later.',
              retryAfter: Math.ceil((rateLimit.resetAt.getTime() - Date.now()) / 1000),
            },
            timestamp: new Date().toISOString(),
          });
        }

        request.endpoint = endpoint;
        request._requestLogStart = Date.now();
        const pathname = getPathname(request);
        request._pathForRules = getPathForRuleMatching(pathname, subdomain);
        applyCorsHeaders(reply, request);

        // FIXED: Use buffered counter
        bufferRequestCount(endpoint.id);

        span.setAttribute('endpoint.id', endpoint.id);
      } catch (error) {
        span.recordException(error as Error);

        if (error instanceof EndpointNotFoundError) {
          return reply.status(404).send({
            success: false,
            error: {
              code: 'ENDPOINT_NOT_FOUND',
              message: 'This mock endpoint does not exist or has been deleted.',
            },
            timestamp: new Date().toISOString(),
          });
        }

        logger.error('Mock router prehandler error', { error });
        return reply.status(500).send({
          success: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Failed to process mock request',
          },
          timestamp: new Date().toISOString(),
        });
      } finally {
        span.end();
      }
    });
  });

  // Log all mock responses after they are sent
  fastify.addHook('onSend', requestLoggerPostHook);

  // Mock router handles all non-API routes
  fastify.route({
    method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'],
    url: '/*',
    handler: async (request, reply) => {
      // Skip API routes - let them be handled by their respective routers
      if (request.url.startsWith('/api/')) {
        return reply.code(404).send({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: `Route ${request.method} ${request.url} not found`,
          },
          timestamp: new Date().toISOString(),
        });
      }
      return tracer.startActiveSpan('mock-request-handler', async (span) => {
        const startTime = Date.now();

        try {
          const endpoint = request.endpoint;

          if (!endpoint) {
            throw new Error('Endpoint not attached to request');
          }

          span.setAttribute('endpoint.id', endpoint.id);
          span.setAttribute('request.method', request.method);
          span.setAttribute('request.path', request.url);

          // Determine the path for rule matching
          const pathname = request._pathForRules ?? getPathname(request);

          const matched = await findMatchingRule(endpoint.rules, request.method, pathname, request, endpoint.id);

          reply.header('X-Mock-Active', 'true');
          reply.header('X-Mock-Endpoint-Id', endpoint.id);
          const rulesLen = Array.isArray(endpoint.rules) ? endpoint.rules.length : 0;
          reply.header('X-Mock-Rules-Count', String(rulesLen));

          if (matched) {
            const { rule, params } = matched;

            // Apply chaos layer first – may short-circuit with timeout/error/rate-limit
            const chaos = await applyChaos(endpoint.id, request.ip, reply);
            if (chaos.rateLimited || chaos.timedOut || chaos.errorInjected) {
              span.setAttribute('chaos.applied', chaos.applied.join(','));
              span.setAttribute('chaos.rate_limited', chaos.rateLimited ?? false);
              span.setAttribute('chaos.timed_out', chaos.timedOut ?? false);
              span.setAttribute('chaos.error_injected', chaos.errorInjected ?? false);
              // Chaos engine already sent a response
              return;
            }
            applyChaosResponseHeaders(reply, chaos.applied, chaos.delayed);

            const res = await applyInterpolation(rule.response, request, params);

            // Support state updates from body: if body has _setState, update state
            const body = request.body as { _setState?: Record<string, unknown> } | undefined;
            if (body?._setState && endpoint.id) {
              for (const [key, value] of Object.entries(body._setState)) {
                await setState(endpoint.id, key, value);
              }
            }

            // Apply delay if specified (0-30s)
            if (res.delay && res.delay > 0 && res.delay <= 30000) {
              await new Promise((resolve) => setTimeout(resolve, res.delay));
              span.setAttribute('rule.delay_ms', res.delay);
            }

            // Trigger webhook if configured (async, non-blocking)
            const settings = endpoint.settings as EndpointSettings | undefined;
            if (settings?.webhookUrl) {
              triggerWebhook(settings.webhookUrl, request, res).catch((err) => {
                logger.error('Webhook trigger failed', { err, webhookUrl: settings.webhookUrl });
              });
            }

            if (res.headers) {
              for (const [k, v] of Object.entries(res.headers)) {
                reply.header(k, v);
              }
            }
            const latency = Date.now() - startTime;
            span.setAttribute('request.latency_ms', latency);
            span.setAttribute('rule.matched', true);
            if (matched.sequenceIndex !== undefined) {
              span.setAttribute('rule.sequence_index', matched.sequenceIndex);
            }

            const status = res.status;
            const payload = res.body;

            // Broadcast to WebSocket live stream
            try {
              broadcastRequest({
                type: 'request',
                id: request.id,
                endpointId: endpoint.id,
                endpointName: endpoint.name,
                timestamp: new Date().toISOString(),
                method: request.method,
                path: request.url,
                query: request.query as Record<string, unknown>,
                headers: Object.fromEntries(
                  Object.entries(request.headers).map(([k, v]) => [
                    k,
                    Array.isArray(v) ? v.join(',') : String(v),
                  ]),
                ),
                body: request.body,
                ip: request.ip,
                userAgent: (request.headers['user-agent'] as string) ?? undefined,
                responseStatus: status,
                responseBody: payload,
                latencyMs: latency,
                chaosApplied: chaos.applied,
              });
            } catch {
              // WebSocket broadcast should be best-effort only
            }

            return reply.status(status).send(payload);
          }

          // Apply chaos layer to default response too
          const chaos = await applyChaos(endpoint.id, request.ip, reply);
          if (chaos.rateLimited || chaos.timedOut || chaos.errorInjected) {
            return;
          }
          applyChaosResponseHeaders(reply, chaos.applied, chaos.delayed);

          // Proxy / Fallback Logic
          const settings = endpoint.settings as EndpointSettings | undefined;
          const upstreams = settings?.upstreams || (settings?.targetUrl ? [settings.targetUrl] : []);

          if (upstreams.length > 0) {
            try {
              let proxyPath = request._pathForRules || request.url.split('?')[0];
              const query = request.url.split('?')[1];
              const pathWithQuery = query ? `${proxyPath}?${query}` : proxyPath;

              let currentBody: any = request.body;
              let currentHeaders: Record<string, string> = Object.fromEntries(
                Object.entries(request.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : String(v)])
              );

              // Remove hop-by-hop headers
              const hopHeaders = ['host', 'connection', 'content-length', 'transfer-encoding', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailers', 'upgrade'];
              for (const h of hopHeaders) delete currentHeaders[h];

              // Inject trace ID
              const traceId = crypto.randomUUID();
              currentHeaders['x-mock-trace-id'] = traceId;

              let finalRes: Response | null = null;
              let lastStatus = 502;
              let lastBody: any = null;

              // Upstream Chaining Logic
              for (const upstream of upstreams) {
                const targetUrl = upstream.replace(/\/$/, '') + pathWithQuery;

                const proxyRes = await fetch(targetUrl, {
                  method: request.method,
                  headers: currentHeaders,
                  body: ['GET', 'HEAD'].includes(request.method) ? undefined : JSON.stringify(currentBody),
                  redirect: 'follow',
                });

                const proxyBodyText = await proxyRes.text();
                let proxyBody: unknown = proxyBodyText;
                try { proxyBody = JSON.parse(proxyBodyText); } catch { /* keep as string */ }

                lastStatus = proxyRes.status;
                lastBody = proxyBody;
                finalRes = proxyRes;

                // For chaining, we use the output of the first as input for the next if we wanted a TRUE chain.
                // But usually "chaining" in proxy terms means trying next if one fails, or passing through multiple middlewares.
                // The prompt says "Middleware Upstreams—forwarding requests through a chain of servers".
                // This implies the response of N-1 is the request to N.
                if (proxyRes.ok) {
                  currentBody = proxyBody;
                  // Merge headers for next hop? Or just replace?
                  // Usually you'd want to keep some context.
                  currentHeaders['x-mock-chain-hop'] = upstream;
                } else {
                  // If an upstream fails in the chain, we might want to stop? 
                  // Or treat it as the final result.
                  break;
                }
              }

              if (finalRes) {
                const latency = Date.now() - startTime;
                span.setAttribute('proxy.chain_length', upstreams.length);
                span.setAttribute('proxy.status', lastStatus);

                // Broadcast
                try {
                  broadcastRequest({
                    type: 'request',
                    id: request.id,
                    endpointId: endpoint.id,
                    endpointName: endpoint.name,
                    timestamp: new Date().toISOString(),
                    method: request.method,
                    path: proxyPath,
                    query: request.query as Record<string, unknown>,
                    headers: request.headers as Record<string, string>,
                    body: request.body,
                    ip: request.ip,
                    userAgent: (request.headers['user-agent'] as string) ?? undefined,
                    responseStatus: lastStatus,
                    responseBody: lastBody,
                    latencyMs: latency,
                    chaosApplied: chaos.applied.length > 0 ? [...chaos.applied, 'proxy'] : ['proxy'],
                  });
                } catch (err) {
                  logger.debug('Broadcast failed', { err });
                }

                // Forward final response headers
                finalRes.headers.forEach((v, k) => {
                  if (!['content-encoding', 'content-length', 'transfer-encoding'].includes(k.toLowerCase())) {
                    reply.header(k, v);
                  }
                });

                // APPLY GLOBAL HEADER REWRITING (Proxy pathway)
                if (settings?.globalHeaderRewriting) {
                  const rwCtx: TemplateContext = {
                    req: {
                      method: request.method,
                      path: proxyPath,
                      body: request.body,
                      headers: Object.fromEntries(Object.entries(request.headers).map(([k, v]) => [k, String(v)])),
                      query: request.query as Record<string, string>,
                      params: {}
                    },
                    endpointId: endpoint.id
                  };

                  // Fastify doesn't make it easy to list set headers easily via reply.getHeaders() is available in some versions
                  // or we can just apply our logic to a shadow representation.
                  // Since we already set them above, let's just use a clean slate for the 'global' ones.
                  // Actually, it's safer to just apply the rewrites to the reply directly if we had an 'applyToReply' helper.
                  // Let's just re-apply specifically for global.
                  const proxyHeaders: Record<string, string> = {};
                  finalRes.headers.forEach((v, k) => { proxyHeaders[k] = v; });

                  const rewritten = await applyHeaderRewriting(proxyHeaders, settings.globalHeaderRewriting as any[], rwCtx);
                  for (const [k, v] of Object.entries(rewritten)) {
                    reply.header(k, v);
                  }
                }

                reply.header('x-mock-trace-id', traceId);

                return reply.status(lastStatus).send(lastBody);
              }
            } catch (err) {
              logger.error('Proxy chain failed', { err, upstreams });
              return reply.status(502).send({
                error: 'Bad Gateway',
                message: 'Failed to proxy request through upstream chain',
                details: (err as Error).message
              });
            }
          }

          const defaultResponse = generateDefaultResponse(endpoint, request);
          const latency = Date.now() - startTime;
          span.setAttribute('request.latency_ms', latency);
          span.setAttribute('rule.matched', false);

          logger.debug(
            'Mock request processed',
            { endpointId: endpoint.id, method: request.method, path: request.url, latency }
          );

          // Broadcast default response too, for completeness
          try {
            broadcastRequest({
              type: 'request',
              id: request.id,
              endpointId: endpoint.id,
              endpointName: endpoint.name,
              timestamp: new Date().toISOString(),
              method: request.method,
              path: request.url,
              query: request.query as Record<string, unknown>,
              headers: Object.fromEntries(
                Object.entries(request.headers).map(([k, v]) => [
                  k,
                  Array.isArray(v) ? v.join(',') : String(v),
                ]),
              ),
              body: request.body,
              ip: request.ip,
              userAgent: (request.headers['user-agent'] as string) ?? undefined,
              responseStatus: 200,
              responseBody: defaultResponse,
              latencyMs: latency,
              chaosApplied: chaos.applied,
            });
          } catch (broadcastErr) {
            logger.debug('WebSocket broadcast failed for default response', { err: broadcastErr, endpointId: endpoint.id });
          }

          return reply.status(200).send(defaultResponse);
        } catch (error) {
          span.recordException(error as Error);
          span.setStatus({ code: SpanStatusCode.ERROR });

          logger.error('Mock request handler error', { error });

          return reply.status(500).send({
            success: false,
            error: {
              code: 'MOCK_ERROR',
              message: 'Failed to process mock request',
            },
            timestamp: new Date().toISOString(),
          });
        } finally {
          span.end();
        }
      });
    },
  });

  logger.info('Mock router plugin registered');
};

export default mockRouterPlugin;
