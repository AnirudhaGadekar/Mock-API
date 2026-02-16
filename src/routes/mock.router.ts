import { SpanStatusCode, trace } from '@opentelemetry/api';
import { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { applyChaos } from '../engine/chaos.js';
import { renderBody, type TemplateContext } from '../engine/templating.js';
import { broadcastRequest } from '../engine/websocket.js';
import { prisma } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { redis } from '../lib/redis.js';
import { setState } from '../lib/state.js';
import { checkRateLimit } from '../middleware/rate-limit.middleware.js';
import { requestLoggerPostHook } from '../middleware/request-logger.middleware.js';
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

  const allowedDomains = getAllowedMockDomains();

  // Subdomain routing (production)
  if (hostname && hostnameMatchesAllowedMockDomain(hostname, allowedDomains)) {
    const sub = extractSubdomainFromHostname(hostname, allowedDomains);
    if (sub) return sub;
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

type RuleResponse = { status: number; body?: unknown; headers?: Record<string, string>; delay?: number };
type RuleCondition = { queryParams?: Record<string, string>; headers?: Record<string, string>; bodyContains?: string };
type Rule = { path: string; method: string; response: RuleResponse; condition?: RuleCondition; sequence?: boolean };

// Regex Cache to prevent ReDoS / Re-compilation
const regexCache = new Map<string, RegExp>();

function escapeRegExpLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Check if request path matches rule path (supports :param placeholders)
 */
function pathMatches(rulePath: string, pathname: string): { match: boolean; params: Record<string, string> } {
  let regex = regexCache.get(rulePath);

  if (!regex) {
    const params: string[] = [];
    const tokens = rulePath.split('/').map((segment) => {
      if (segment.startsWith(':') && segment.length > 1) {
        params.push(segment.slice(1));
        return '([^/]+)';
      }
      return escapeRegExpLiteral(segment);
    });
    const pattern = tokens.join('/');
    // Add start/end anchors
    regex = new RegExp(`^${pattern}$`);
    // Store params info with regex if possible, but for now we re-extract. 
    // To properly cache params extraction we need a more complex cache structure.
    // For now we just cache the Regex compilation.
    regexCache.set(rulePath, regex);
  }

  const m = pathname.match(regex);
  if (!m) return { match: false, params: {} };

  const params: Record<string, string> = {};
  // Re-extract param names (fast enough linear scan)
  // This is a simplified param extractor that assumes order matches. 
  // For standard :id style params this works.
  const paramNames = (rulePath.match(/:[^/]+/g) || []).map(s => s.slice(1));

  paramNames.forEach((name, i) => {
    params[name] = m[i + 1];
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
/**
 * Find first rule that matches method, path, and conditions (with sequence support)
 */
async function findMatchingRule(
  rules: unknown,
  method: string,
  pathname: string,
  request: FastifyRequest,
  endpointId: string
): Promise<{ rule: Rule; params: Record<string, string>; sequenceIndex?: number } | null> {
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
    // Redis-based atomic counter for round-robin
    const index = await getNextSequenceIndex(endpointId, first.rule.path, first.rule.method, matchingRules.length);
    const selected = matchingRules[index];

    return { ...selected, sequenceIndex: index };
  }

  return first;
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

  out = out.replace(/\{\{JSON\.stringify\(req\.body\)\}\}/g, bodyStr);
  out = out.replace(/\{\{req\.body\}\}/g, bodyStr);
  for (const [key, val] of Object.entries(pathParams)) {
    out = out.replace(new RegExp(`\\{\\{req\.params\\.${key}\\}\\}`, 'g'), val);
  }
  if (body && typeof body === 'object') {
    for (const [key, val] of Object.entries(body)) {
      // Avoid circular here too if possible, but simplistic check is hard. 
      // Assuming body is JSON-safe from Fastify.
      const v = typeof val === 'object' ? JSON.stringify(val) : String(val);
      out = out.replace(new RegExp(`\\{\\{req\.body\\.${key}\\}\\}`, 'g'), v);
    }
  }
  return out;
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
  const headers: Record<string, string> = {};
  if (response.headers) {
    for (const [k, v] of Object.entries(response.headers)) {
      headers[k] = typeof v === 'string' ? interpolate(v, request, pathParams) : String(v);
    }
  }

  const endpoint = (request as any).endpoint as { id: string; name: string } | undefined;
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
  try {
    const safeUrl = await assertSafeWebhookUrl(url);
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
    await fetch(safeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
      redirect: 'error',
    });
  } catch (err) {
    throw err;
  }
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
          ? pathnameForRules.slice(subdomain.length + 1) || '/'
          : pathnameForRules;
        (request as any)._pathForRules = pathForRules;
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

  fastify.route({
    method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'],
    url: '*',
    handler: async (request, reply) => {
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
                chaosApplied: [],
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

          // Proxy / Fallback Logic
          const settings = (endpoint as any).settings as { targetUrl?: string } | undefined;
          if (settings?.targetUrl) {
            try {
              let path = request.url;
              // Use normalized path (stripping subdomain prefix if using path-based routing)
              if ((request as any)._pathForRules) {
                path = (request as any)._pathForRules;
                const query = request.url.split('?')[1];
                if (query) path += '?' + query;
              }

              const targetUrl = settings.targetUrl.replace(/\/$/, '') + path;

              // Filter headers
              const forwardHeaders = new Headers();
              for (const [k, v] of Object.entries(request.headers)) {
                if (!['host', 'connection', 'content-length'].includes(k.toLowerCase())) {
                  forwardHeaders.set(k, Array.isArray(v) ? v.join(',') : String(v));
                }
              }

              const proxyRes = await fetch(targetUrl, {
                method: request.method,
                headers: forwardHeaders,
                body: ['GET', 'HEAD'].includes(request.method) ? undefined : JSON.stringify(request.body),
                redirect: 'follow',
              });

              // Read response body
              const proxyBodyText = await proxyRes.text();
              let proxyBody: any = proxyBodyText;
              try { proxyBody = JSON.parse(proxyBodyText); } catch { }

              const latency = Date.now() - startTime;
              span.setAttribute('proxy.target', targetUrl);
              span.setAttribute('proxy.status', proxyRes.status);

              // Broadcast proxy response
              try {
                broadcastRequest({
                  type: 'request',
                  id: request.id,
                  endpointId: endpoint.id,
                  endpointName: endpoint.name,
                  timestamp: new Date().toISOString(),
                  method: request.method,
                  path: path, // Use normalized path
                  query: request.query as Record<string, unknown>,
                  headers: request.headers as Record<string, string>,
                  body: request.body,
                  ip: request.ip,
                  userAgent: (request.headers['user-agent'] as string) ?? undefined,
                  responseStatus: proxyRes.status,
                  responseBody: proxyBody,
                  latencyMs: latency,
                  chaosApplied: ['proxy'],
                });
              } catch { }

              // Forward response headers
              proxyRes.headers.forEach((v, k) => {
                if (!['content-encoding', 'content-length', 'transfer-encoding'].includes(k.toLowerCase())) {
                  reply.header(k, v);
                }
              });

              return reply.status(proxyRes.status).send(proxyBody);

            } catch (err) {
              logger.error('Proxy request failed', { err, target: settings.targetUrl });
              // Fallthrough to default response on proxy error? 
              // Or return 502? 
              // Let's return 502 to alert user proxy failed.
              return reply.status(502).send({
                error: 'Bad Gateway',
                message: 'Failed to proxy request to target URL',
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
              chaosApplied: [],
            });
          } catch {
            // ignore WS errors
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
