
/**
 * tunnel-proxy.ts — Simple "local tunneling" style proxy.
 *
 * This is NOT a full ngrok replacement, but provides:
 * - Configurable tunnels stored in Redis (target URL + headers + expiry)
 * - Public entrypoint: /tunnel/:tunnelId/* → proxies to target
 *
 * Flow:
 * 1. Backend/console calls POST /api/v1/tunnel with { id?, targetUrl, headers?, ttlSeconds? }
 * 2. We store config under mockurl:tunnel:<id>
 * 3. Clients hit https://api.mockurl.com/tunnel/<id>/... and traffic is forwarded
 *    to targetUrl + path suffix with optional header injection.
 */
import { randomUUID } from 'crypto';
import { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { getTunnel } from '../lib/active-tunnels.js';
import { logger } from '../lib/logger.js';
import { redis } from '../lib/redis.js';

const TUNNEL_PREFIX = 'mockurl:tunnel:';

export interface TunnelConfig {
  id: string;
  targetUrl: string; // e.g. "http://localhost:3001"
  headers?: Record<string, string>;
  createdAt: string;
  expiresAt?: string;
}

async function loadTunnel(id: string): Promise<TunnelConfig | null> {
  try {
    const raw = await redis.get(TUNNEL_PREFIX + id);
    if (!raw) return null;
    const cfg = JSON.parse(raw) as TunnelConfig;
    if (cfg.expiresAt && new Date(cfg.expiresAt) < new Date()) {
      await redis.del(TUNNEL_PREFIX + id);
      return null;
    }
    return cfg;
  } catch (err) {
    logger.error('Failed to load tunnel config', { err, id });
    return null;
  }
}

/**
 * Fastify plugin that exposes /tunnel/:tunnelId/* and proxies to the configured target.
 */
export const tunnelProxyPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.all<{
    Params: { tunnelId: string; '*': string };
  }>('/tunnel/:tunnelId/*', async (request: FastifyRequest, reply: FastifyReply) => {
    const { tunnelId } = request.params as { tunnelId: string; '*': string };
    const suffix = (request.params as any)['*'] as string | undefined;

    // 1. Check for Active WebSocket Tunnel (Priority 1)
    const wsTunnel = getTunnel(tunnelId);
    if (wsTunnel) {
      if (wsTunnel.socket.readyState !== wsTunnel.socket.OPEN) {
        return reply.status(502).send({
          success: false,
          error: { code: 'TUNNEL_DISCONNECTED', message: 'Tunnel client disconnected' }
        });
      }

      const requestId = randomUUID();
      const pathSuffix = suffix ? `/${suffix}` : '';
      const originalUrl = new URL(request.url, 'http://placeholder');

      const payload = {
        type: 'REQUEST',
        requestId,
        method: request.method,
        path: pathSuffix + (originalUrl.search || ''),
        headers: request.headers,
        body: typeof request.body === 'string' ? request.body : JSON.stringify(request.body)
      };

      // Create Promise to wait for response
      const responsePromise = new Promise<any>((resolve, reject) => {
        // Timeout after 30s
        const timeout = setTimeout(() => {
          wsTunnel.pendingRequests.delete(requestId);
          reject(new Error('Tunnel request timed out'));
        }, 30000);

        wsTunnel.pendingRequests.set(requestId, {
          resolve: (data) => {
            clearTimeout(timeout);
            resolve(data);
          },
          reject: (err) => {
            clearTimeout(timeout);
            reject(err);
          }
        });
      });

      try {
        wsTunnel.socket.send(JSON.stringify(payload));
        const tunnelRes = await responsePromise;

        reply.status(tunnelRes.status);
        if (tunnelRes.headers) {
          Object.entries(tunnelRes.headers).forEach(([k, v]) => {
            reply.header(k, v);
          });
        }
        // If body is base64
        if (tunnelRes.body) {
          reply.send(Buffer.from(tunnelRes.body, 'base64'));
        } else {
          reply.send();
        }
        return reply;
      } catch (err: any) {
        logger.error('Tunnel proxy forwarding failed', { err, tunnelId });
        return reply.status(504).send({
          success: false,
          error: { code: 'TUNNEL_TIMEOUT', message: err.message }
        });
      }
    }

    // 2. Fallback to Persistent/Static Tunnel Logic (Redis)
    const cfg = await loadTunnel(tunnelId);
    if (!cfg) {
      return reply.status(404).send({
        success: false,
        error: { code: 'TUNNEL_NOT_FOUND', message: 'Tunnel not found or expired' },
        timestamp: new Date().toISOString(),
      });
    }

    // Build target URL: targetUrl + "/" + suffix + query string
    const url = new URL(cfg.targetUrl);
    const pathSuffix = suffix ? `/${suffix}` : '';
    const originalUrl = new URL(request.url, 'http://placeholder');
    url.pathname = (url.pathname.replace(/\/+$/, '') || '') + pathSuffix;
    url.search = originalUrl.search;

    try {
      const upstreamHeaders: Record<string, string> = {};
      for (const [k, v] of Object.entries(request.headers)) {
        if (v === undefined) continue;
        upstreamHeaders[k] = Array.isArray(v) ? v.join(',') : String(v);
      }
      // Optional header injection from config
      if (cfg.headers) {
        for (const [k, v] of Object.entries(cfg.headers)) {
          upstreamHeaders[k.toLowerCase()] = v;
        }
      }

      const body =
        request.method === 'GET' || request.method === 'HEAD'
          ? undefined
          : typeof request.body === 'string'
            ? request.body
            : request.body
              ? JSON.stringify(request.body)
              : undefined;

      const upstreamResponse = await fetch(url.toString(), {
        method: request.method,
        headers: upstreamHeaders,
        body,
        signal: AbortSignal.timeout(30_000),
      });

      const buf = await upstreamResponse.arrayBuffer();
      // Mirror status and most headers back to client
      for (const [k, v] of upstreamResponse.headers.entries()) {
        if (k.toLowerCase() === 'transfer-encoding') continue;
        reply.header(k, v);
      }
      reply.status(upstreamResponse.status);
      return reply.send(Buffer.from(buf));
    } catch (err) {
      logger.error('Tunnel proxy failed', { err, tunnelId, targetUrl: cfg.targetUrl });
      return reply.status(502).send({
        success: false,
        error: { code: 'TUNNEL_BAD_GATEWAY', message: 'Failed to reach upstream target' },
        timestamp: new Date().toISOString(),
      });
    }
  });
};

export default tunnelProxyPlugin;
