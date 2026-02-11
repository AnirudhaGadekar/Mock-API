import { SpanStatusCode, trace } from '@opentelemetry/api';
import { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { getState, setState } from '../lib/state.js';
import { checkRateLimit } from '../middleware/rate-limit.middleware.js';
import { requestLoggerPostHook } from '../middleware/request-logger.middleware.js';
import { cacheSubdomainMapping } from '../utils/endpoint.cache.js';

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

/**
 * Extract subdomain from hostname or path
 * Supports both:
 * - Subdomain routing: my-endpoint.mockurl.com
 * - Path routing: mockurl.com/my-endpoint (fallback)
 */
function extractSubdomain(request: FastifyRequest): string | null {
  const hostname = request.hostname;
  
  // Subdomain routing (production)
  if (hostname && hostname.includes('.mockurl.com')) {
    const parts = hostname.split('.');
    if (parts.length >= 3) {
      // Extract subdomain (everything before .mockurl.com)
      return parts.slice(0, -2).join('.');
    }
  }

  // Path-based routing (development): /my-endpoint/... → subdomain = my-endpoint
  const pathParts = request.url.split('?')[0].split('/').filter(Boolean);
  if (pathParts.length > 0 && pathParts[0].match(/^[a-z0-9-]+$/)) {
    return pathParts[0];
  }

  return null;
}

/**
 * Fetch endpoint by subdomain with caching
 */
async function fetchEndpointBySubdomain(subdomain: string): Promise<any> {
  return tracer.startActiveSpan('fetch-endpoint-by-subdomain', async (span) => {
    try {
      span.setAttribute('endpoint.subdomain', subdomain);

      // Try to get from cache first (without userId - will validate later)
      // For now, we'll cache per subdomain only
      const cacheKey = `endpoint:subdomain:${subdomain}`;
      
      // Since we don't have userId yet, we'll query database
      // In production, you might extract userId from request context or token
      const endpoint = await prisma.endpoint.findFirst({
        where: {
          name: subdomain,
          deletedAt: null,
        },
        select: {
          id: true,
          name: true,
          rules: true,
          userId: true,
          requestCount: true,
        },
      });

      if (!endpoint) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: 'Endpoint not found' });
        throw new EndpointNotFoundError(subdomain);
      }

      // Cache for future requests
      await cacheSubdomainMapping(subdomain, endpoint.userId, endpoint);

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
 * Increment request counter (async, non-blocking)
 */
async function incrementRequestCounter(endpointId: string): Promise<void> {
  // Fire-and-forget counter update
  prisma.endpoint
    .update({
      where: { id: endpointId },
      data: { requestCount: { increment: 1 } },
    })
    .catch((error) => {
      logger.error({ error, endpointId }, 'Failed to increment request counter');
    });
}

/**
 * Apply CORS headers for mock endpoints (wildcard for subdomains)
 */
function applyCorsHeaders(reply: FastifyReply): void {
  reply.header('Access-Control-Allow-Origin', '*');
  reply.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD');
  reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
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

type RuleResponse = { status: number; body?: unknown; headers?: Record<string, string>; delay?: number };
type RuleCondition = { queryParams?: Record<string, string>; headers?: Record<string, string>; bodyContains?: string };
type Rule = { path: string; method: string; response: RuleResponse; condition?: RuleCondition; sequence?: boolean };

/**
 * Check if request path matches rule path (supports :param placeholders)
 */
function pathMatches(rulePath: string, pathname: string): { match: boolean; params: Record<string, string> } {
  const params: Record<string, string> = {};
  const pattern = rulePath.replace(/:[^/]+/g, (seg) => {
    const name = seg.slice(1);
    params[name] = '';
    return '([^/]+)';
  });
  const regex = new RegExp(`^${pattern}$`);
  const m = pathname.match(regex);
  if (!m) return { match: false, params: {} };
  const keys = Object.keys(params);
  m.slice(1).forEach((val, i) => {
    if (keys[i]) params[keys[i]] = val;
  });
  return { match: true, params };
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

  return true;
}

/**
 * Find first rule that matches method, path, and conditions (with sequence support)
 */
function findMatchingRule(
  rules: unknown,
  method: string,
  pathname: string,
  request: FastifyRequest,
  endpointId: string
): { rule: Rule; params: Record<string, string>; sequenceIndex?: number } | null {
  const arr = Array.isArray(rules) ? rules : [];
  const matchingRules: Array<{ rule: Rule; params: Record<string, string> }> = [];

  for (const r of arr) {
    const rule = r as Rule;
    if (rule.method !== method) continue;
    const { match, params } = pathMatches(rule.path, pathname);
    if (!match) continue;
    if (!matchesCondition(rule.condition, request)) continue;
    matchingRules.push({ rule, params });
  }

  if (matchingRules.length === 0) return null;

  const first = matchingRules[0];
  if (first.rule.sequence && matchingRules.length > 1) {
    const key = `sequence:${endpointId}:${first.rule.path}:${first.rule.method}`;
    const index = (global as any).__sequenceCounters ||= {};
    index[key] = (index[key] || 0) % matchingRules.length;
    const selected = matchingRules[index[key]];
    index[key]++;
    return { ...selected, sequenceIndex: index[key] - 1 };
  }

  return first;
}

/**
 * Simple template substitution (Beeceptor-style): {{req.body}}, {{req.params.id}}, {{JSON.stringify(req.body)}}
 */
function interpolate(
  value: string,
  request: FastifyRequest,
  pathParams: Record<string, string>
): string {
  let out = value;
  const body = request.body as object | undefined;
  const bodyStr = body !== undefined && body !== null ? JSON.stringify(body) : '{}';
  out = out.replace(/\{\{JSON\.stringify\(req\.body\)\}\}/g, bodyStr);
  out = out.replace(/\{\{req\.body\}\}/g, bodyStr);
  for (const [key, val] of Object.entries(pathParams)) {
    out = out.replace(new RegExp(`\\{\\{req\.params\\.${key}\\}\\}`, 'g'), val);
  }
  if (body && typeof body === 'object') {
    for (const [key, val] of Object.entries(body)) {
      const v = typeof val === 'object' ? JSON.stringify(val) : String(val);
      out = out.replace(new RegExp(`\\{\\{req\.body\\.${key}\\}\\}`, 'g'), v);
    }
  }
  return out;
}

/**
 * Apply interpolation to response body/headers (only to string values)
 */
async function applyInterpolation(
  response: RuleResponse,
  request: FastifyRequest,
  pathParams: Record<string, string>
): Promise<RuleResponse> {
  const headers: Record<string, string> = {};
  if (response.headers) {
    for (const [k, v] of Object.entries(response.headers)) {
      headers[k] = typeof v === 'string' ? interpolate(v, request, pathParams) : String(v);
    }
  }
  let body = response.body;
  if (typeof body === 'string') {
    body = interpolate(body, request, pathParams);
    // Support state interpolation: {{state.key}}
    if (typeof body === 'string' && body.includes('{{state.')) {
      const endpointId = (request as any).endpoint?.id;
      if (endpointId) {
        const stateMatches = body.matchAll(/\{\{state\.([^}]+)\}\}/g);
        for (const match of stateMatches) {
          const key = match[1];
          const stateValue = await getState(endpointId, key);
          body = body.replace(match[0], stateValue !== null ? JSON.stringify(stateValue) : 'null');
        }
      }
    }
  }
  return { ...response, body, headers: Object.keys(headers).length ? headers : undefined };
}

/**
 * Trigger webhook (async, non-blocking)
 */
async function triggerWebhook(url: string, request: FastifyRequest, response: RuleResponse): Promise<void> {
  try {
    const payload = {
      timestamp: new Date().toISOString(),
      endpointId: (request as any).endpoint?.id,
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
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    throw err;
  }
}

/**
 * Default response when no rule matches (Beeceptor-style fallback)
 */
function generateDefaultResponse(endpoint: { id: string; name: string; rules: unknown }, request: FastifyRequest) {
  const rulesArr = Array.isArray(endpoint.rules) ? endpoint.rules : [];
  return {
    message: 'Mock endpoint active',
    activeRules: rulesArr.length,
    endpointId: endpoint.id,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Production mock router plugin
 * Handles all requests to mock endpoints (subdomain routing)
 */
export const mockRouterPlugin: FastifyPluginAsync = async (fastify, opts) => {
  /**
   * PreHandler: Extract subdomain and load endpoint
   */
  fastify.addHook('preHandler', async (request, reply) => {
    return tracer.startActiveSpan('mock-router-prehandler', async (span) => {
      try {
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

        (request as any).endpoint = endpoint;
        (request as any)._requestLogStart = Date.now();
        const pathnameForRules = getPathname(request);
        const pathForRules = subdomain && pathnameForRules.startsWith('/' + subdomain)
          ? pathnameForRules.slice(subdomain.length) || '/'
          : pathnameForRules;
        (request as any)._pathForRules = pathForRules;
        applyCorsHeaders(reply);

        // Increment counter (non-blocking)
        incrementRequestCounter(endpoint.id);

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

        logger.error({ error }, 'Mock router prehandler error');
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

  /**
   * Handle OPTIONS requests (CORS preflight)
   */
  fastify.options('*', async (request, reply) => {
    applyCorsHeaders(reply);
    return reply.status(204).send();
  });

  fastify.addHook('onSend', requestLoggerPostHook);

  fastify.all('*', async (request, reply) => {
    return tracer.startActiveSpan('mock-request-handler', async (span) => {
      const startTime = Date.now();

      try {
        const endpoint = (request as any).endpoint;

        if (!endpoint) {
          throw new Error('Endpoint not attached to request');
        }

        span.setAttribute('endpoint.id', endpoint.id);
        span.setAttribute('request.method', request.method);
        span.setAttribute('request.path', request.url);

        const pathname = (request as any)._pathForRules ?? getPathname(request);
        const matched = findMatchingRule(endpoint.rules, request.method, pathname, request, endpoint.id);

        reply.header('X-Mock-Active', 'true');
        reply.header('X-Mock-Endpoint-Id', endpoint.id);
        const rulesLen = Array.isArray(endpoint.rules) ? endpoint.rules.length : 0;
        reply.header('X-Mock-Rules-Count', String(rulesLen));

        if (matched) {
          const { rule, params } = matched;
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
          const settings = (endpoint as any).settings as { webhookUrl?: string } | undefined;
          if (settings?.webhookUrl) {
            triggerWebhook(settings.webhookUrl, request, res).catch((err) => {
              logger.error({ err, webhookUrl: settings.webhookUrl }, 'Webhook trigger failed');
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
          return reply.status(res.status).send(res.body);
        }

        const defaultResponse = generateDefaultResponse(endpoint, request);
        const latency = Date.now() - startTime;
        span.setAttribute('request.latency_ms', latency);
        span.setAttribute('rule.matched', false);

        logger.debug(
          { endpointId: endpoint.id, method: request.method, path: request.url, latency },
          'Mock request processed'
        );

        return reply.status(200).send(defaultResponse);
      } catch (error) {
        span.recordException(error as Error);
        span.setStatus({ code: SpanStatusCode.ERROR });

        logger.error({ error }, 'Mock request handler error');

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
  });

  logger.info('Mock router plugin registered');
};

/**
 * Register mock router under specific path prefix
 * Usage in main app:
 * 
 * // For subdomain routing (production)
 * fastify.register(mockRouterPlugin);
 * 
 * // For path-based routing (development)
 * fastify.register(mockRouterPlugin, { prefix: '/mock' });
 */
export default mockRouterPlugin;
