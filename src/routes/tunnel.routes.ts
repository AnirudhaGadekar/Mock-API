
/**
 * tunnel.routes.ts — Manage tunneling configs.
 *
 * POST   /api/v1/tunnel        — Create/update tunnel for current user
 * GET    /api/v1/tunnel        — List tunnels for current user
 * DELETE /api/v1/tunnel/:id    — Delete a tunnel
 *
 * NOTE: This is a lightweight abstraction around the Redis-backed configs
 * consumed by tunnel-proxy.ts. It does NOT attempt full ngrok-style auth;
 * we scope tunnels per user id.
 */
import crypto from 'crypto';
import { FastifyPluginAsync } from 'fastify';
import { activeTunnels } from '../lib/active-tunnels.js'; // Import active tunnels
import { logger } from '../lib/logger.js';
import { redis } from '../lib/redis.js';
import { authenticateApiKey, getAuthenticatedUser } from '../middleware/auth.middleware.js';

const TUNNEL_PREFIX = 'mockurl:tunnel:';

interface TunnelConfig {
  id: string;
  userId: string;
  targetUrl: string;
  headers?: Record<string, string>;
  createdAt: string;
  expiresAt?: string;
  type?: 'HTTP' | 'WEBSOCKET'; // Add type discriminator
}

function tunnelKey(id: string): string {
  return TUNNEL_PREFIX + id;
}

export const tunnelRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', authenticateApiKey);

  // Create/update tunnel (HTTP/Redis based)
  fastify.post<{
    Body: { id?: string; targetUrl: string; headers?: Record<string, string>; ttlSeconds?: number };
  }>('/', async (request, reply) => {
    const user = getAuthenticatedUser(request);
    const { id, targetUrl, headers, ttlSeconds } = request.body ?? {};

    if (!targetUrl) {
      return reply.status(400).send({
        success: false,
        error: { code: 'BAD_REQUEST', message: 'targetUrl is required' },
        timestamp: new Date().toISOString(),
      });
    }

    // Basic URL validation
    let parsed: URL;
    try {
      parsed = new URL(targetUrl);
    } catch {
      return reply.status(400).send({
        success: false,
        error: { code: 'BAD_REQUEST', message: 'targetUrl must be a valid URL' },
        timestamp: new Date().toISOString(),
      });
    }

    const tunnelId = id ?? crypto.randomBytes(5).toString('hex');
    const now = new Date();
    const cfg: TunnelConfig = {
      id: tunnelId,
      userId: user.id,
      targetUrl: parsed.toString(),
      headers,
      createdAt: now.toISOString(),
      expiresAt: ttlSeconds ? new Date(now.getTime() + ttlSeconds * 1000).toISOString() : undefined,
      type: 'HTTP'
    };

    await redis.set(tunnelKey(tunnelId), JSON.stringify(cfg));
    logger.info('Tunnel configured', { tunnelId, userId: user.id, targetUrl: cfg.targetUrl });

    return reply.status(201).send({
      success: true,
      tunnel: cfg,
      publicUrl: `/tunnel/${tunnelId}`,
      timestamp: new Date().toISOString(),
    });
  });

  // List tunnels for current user (Redis + WebSocket)
  fastify.get('/', async (request, reply) => {
    const user = getAuthenticatedUser(request);

    // 1. Fetch Redis tunnels
    const keys = await redis.keys(TUNNEL_PREFIX + '*');
    const items: TunnelConfig[] = [];
    for (const key of keys) {
      const raw = await redis.get(key);
      if (!raw) continue;
      try {
        const cfg = JSON.parse(raw) as TunnelConfig;
        if (cfg.userId === user.id) {
          items.push({ ...cfg, type: 'HTTP' });
        }
      } catch {
        // ignore malformed entries
      }
    }

    // 2. Fetch Active WebSocket Tunnels
    for (const session of activeTunnels.values()) {
      if (session.userId === user.id) {
        items.push({
          id: session.tunnelId,
          userId: session.userId,
          targetUrl: 'Local Client', // Or "CLI"
          createdAt: session.createdAt.toISOString(),
          type: 'WEBSOCKET'
        });
      }
    }

    return reply.send({
      success: true,
      tunnels: items,
      timestamp: new Date().toISOString(),
    });
  });

  // Delete tunnel
  fastify.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const user = getAuthenticatedUser(request);
    const { id } = request.params;
    const key = tunnelKey(id);
    const raw = await redis.get(key);

    // Check Redis tunnels
    if (raw) {
      const cfg = JSON.parse(raw) as TunnelConfig;
      if (cfg.userId !== user.id) {
        return reply.status(403).send({
          success: false,
          error: { code: 'FORBIDDEN', message: 'You do not own this tunnel' },
          timestamp: new Date().toISOString(),
        });
      }
      await redis.del(key);
      return reply.send({ success: true, deleted: true, timestamp: new Date().toISOString() });
    }

    // Check Active WebSocket Tunnels (Though these are usually transient)
    // We can force disconnect them
    // Note: iterating map keys is fast enough for now
    const wsTunnel = activeTunnels.get(id);
    if (wsTunnel) {
      if (wsTunnel.userId !== user.id) {
        return reply.status(403).send({
          success: false,
          error: { code: 'FORBIDDEN', message: 'You do not own this tunnel' },
          timestamp: new Date().toISOString(),
        });
      }
      wsTunnel.socket.close(); // Close connection
      activeTunnels.delete(id);
      return reply.send({ success: true, deleted: true, timestamp: new Date().toISOString() });
    }

    return reply.status(404).send({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Tunnel not found' },
      timestamp: new Date().toISOString(),
    });
  });
};
