/**
 * Piece 3: Request logging middleware – log AFTER response (async insert, no block)
 */
import { Prisma } from '@prisma/client';
import { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../lib/db.js';
import { events } from '../lib/events.js';
import { logger } from '../lib/logger.js';
import { recordHttpRequest } from '../lib/metrics.js';

const BODY_TRUNCATE = 1024 * 1024; // 1MB
const SANITIZE_HEADERS = ['authorization', 'x-api-key', 'cookie'];

const SENSITIVE_KEY_REGEX = /(pass(word)?|secret|token|api[-_]?key|auth(orization)?|session|cookie|jwt|bearer|private[-_]?key)/i;

function sanitizeHeaders(headers: Record<string, string | string[] | undefined>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(headers)) {
    const lower = k.toLowerCase();
    if (SANITIZE_HEADERS.some((h) => lower === h) || SENSITIVE_KEY_REGEX.test(lower)) {
      out[k] = '[REDACTED]';
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

function deepRedact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((v) => deepRedact(v));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_REGEX.test(k)) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = deepRedact(v);
      }
    }
    return out;
  }
  return value;
}

function sanitizeBodyString(bodyStr: string): string {
  if (!bodyStr) return bodyStr;
  const trimmed = bodyStr.trim();
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return bodyStr;
  try {
    const parsed = JSON.parse(bodyStr) as unknown;
    const redacted = deepRedact(parsed);
    return JSON.stringify(redacted);
  } catch {
    return bodyStr;
  }
}

function toJsonValue(bodyStr: string | null): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (!bodyStr) return Prisma.JsonNull;
  const trimmed = bodyStr.trim();
  if (!trimmed) return Prisma.JsonNull;

  try {
    return JSON.parse(trimmed) as Prisma.InputJsonValue;
  } catch {
    // Persist plain text bodies as JSON string values instead of dropping the log.
    return bodyStr as unknown as Prisma.InputJsonValue;
  }
}

export function captureRequestLog(
  endpointId: string,
  request: FastifyRequest,
  responseStatus: number,
  _responseHeaders: Record<string, string | number>,
  _responseBody: string,
  latencyMs: number
): void {
  const start = Date.now();
  const bodyRaw = request.body;
  let bodyStr: string | null = null;
  if (bodyRaw !== undefined && bodyRaw !== null) {
    try {
      bodyStr = typeof bodyRaw === 'string' ? bodyRaw : JSON.stringify(bodyRaw);
      if (bodyStr.length > BODY_TRUNCATE) bodyStr = bodyStr.slice(0, BODY_TRUNCATE) + '...[truncated]';
      bodyStr = sanitizeBodyString(bodyStr);
    } catch {
      bodyStr = '[unserializable]';
    }
  }

  const query = request.query as Record<string, unknown>;
  const queryJson =
    query && Object.keys(query).length > 0
      ? (query as unknown as Prisma.InputJsonValue)
      : Prisma.JsonNull;
  const headersJson = request.headers
    ? (sanitizeHeaders(request.headers) as unknown as Prisma.InputJsonValue)
    : Prisma.JsonNull;

  prisma.requestLog
    .create({
      data: {
        endpointId,
        method: request.method,
        path: request.url.split('?')[0] || request.url,
        queryParams: queryJson,
        headers: headersJson,
        body: toJsonValue(bodyStr),
        ip: request.ip ?? null,
        userAgent: request.headers['user-agent'] ?? null,
        responseStatus,
        durationMs: latencyMs,
        userId: (request as FastifyRequest & { user?: { id?: string } }).user?.id ?? null,
      },
    })
    .then((log) => {
      logger.debug('RequestLog inserted', { endpointId, latency: Date.now() - start });

      // Emit internal event for analytics / websockets
      try {
        events.emit('requestLogged', {
          id: log.id,
          endpointId: log.endpointId,
          method: log.method,
          path: log.path,
          status: log.responseStatus ?? responseStatus,
          timestamp: log.createdAt,
          latencyMs: log.durationMs ?? latencyMs,
        });
      } catch {
        // Swallow event errors – never block request path
      }

      // Update Prometheus metrics (fire-and-forget)
      void recordHttpRequest({
        method: request.method,
        statusCode: responseStatus,
        endpointId,
      });
    })
    .catch((err) => {
      const code = (err as { code?: string }).code;
      if (code === 'P2003') {
        logger.debug('RequestLog skipped because endpoint was deleted before async write', { endpointId });
        return;
      }
      logger.error('RequestLog insert failed', { err, endpointId });
    });
}

/**
 * Post-handler hook: run after response is sent; capture status/headers/body/latency and async insert
 */
export function requestLoggerPostHook(
  request: FastifyRequest & { endpoint?: { id: string }; _requestLogStart?: number },
  reply: FastifyReply,
  payload: unknown,
  done: (err?: Error) => void
): void {
  try {
    const endpoint = request.endpoint;
    const start = request._requestLogStart ?? Date.now();
    if (!endpoint?.id) {
      done();
      return;
    }

    const responseStatus = reply.statusCode;
    const responseHeaders: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(reply.getHeaders())) {
      if (v !== undefined) responseHeaders[k] = String(v);
    }
    let responseBody = '';
    if (payload !== undefined && payload !== null) {
      try {
        responseBody = typeof payload === 'string' ? payload : JSON.stringify(payload);
      } catch {
        responseBody = '[unserializable]';
      }
    }

    const latencyMs = Math.round(Date.now() - start);
    captureRequestLog(endpoint.id, request, responseStatus, responseHeaders, responseBody, latencyMs);
    done();
  } catch (err) {
    logger.error('Request log post-hook failed', { err });
    done();
  }
}
