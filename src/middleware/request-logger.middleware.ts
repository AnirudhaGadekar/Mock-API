/**
 * Piece 3: Request logging middleware – log AFTER response (async insert, no block)
 */
import { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../lib/db.js';
import { logger } from '../lib/logger.js';

const BODY_TRUNCATE = 1024 * 1024; // 1MB
const SANITIZE_HEADERS = ['authorization', 'x-api-key', 'cookie'];

function sanitizeHeaders(headers: Record<string, string | string[] | undefined>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(headers)) {
    const lower = k.toLowerCase();
    if (SANITIZE_HEADERS.some((h) => lower === h)) {
      out[k] = '[REDACTED]';
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

export function captureRequestLog(
  endpointId: string,
  request: FastifyRequest,
  responseStatus: number,
  responseHeaders: Record<string, string | number>,
  responseBody: string,
  latencyMs: number
): void {
  const start = Date.now();
  const bodyRaw = request.body;
  let bodyStr: string | null = null;
  if (bodyRaw !== undefined && bodyRaw !== null) {
    try {
      bodyStr = typeof bodyRaw === 'string' ? bodyRaw : JSON.stringify(bodyRaw);
      if (bodyStr.length > BODY_TRUNCATE) bodyStr = bodyStr.slice(0, BODY_TRUNCATE) + '...[truncated]';
    } catch {
      bodyStr = '[unserializable]';
    }
  }

  const query = request.query as Record<string, unknown>;
  const queryJson = query && Object.keys(query).length > 0 ? query : null;
  const headersJson = request.headers ? sanitizeHeaders(request.headers) : null;

  prisma.requestLog
    .create({
      data: {
        endpointId,
        method: request.method,
        path: request.url.split('?')[0] || request.url,
        query: queryJson,
        headers: headersJson,
        body: bodyStr,
        ip: request.ip ?? null,
        userAgent: request.headers['user-agent'] ?? null,
        responseStatus,
        responseHeaders: responseHeaders as object,
        responseBody: responseBody.length > BODY_TRUNCATE ? responseBody.slice(0, BODY_TRUNCATE) + '...[truncated]' : responseBody,
        latencyMs,
      },
    })
    .then(() => {
      logger.debug({ endpointId, latency: Date.now() - start }, 'RequestLog inserted');
    })
    .catch((err) => {
      logger.error({ err, endpointId }, 'RequestLog insert failed');
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
}
