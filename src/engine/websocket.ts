/**
 * websocket.ts — Real-time request inspection via WebSocket.
 *
 * Broadcasts every mock request (with full req/res data) to all
 * connected admin clients. Used by the admin dashboard for live
 * request monitoring.
 *
 * Usage:
 *   - Register the plugin on the Fastify instance
 *   - Connect WebSocket clients to ws://host:port/ws/live
 *   - Call broadcast() from the mock router after each request
 */
import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { WebSocket } from 'ws';
import { logger } from '../lib/logger.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface LiveRequestEvent {
    type: 'request';
    id: string;
    endpointId: string;
    endpointName: string;
    timestamp: string;
    method: string;
    path: string;
    query?: Record<string, unknown>;
    headers?: Record<string, string>;
    body?: unknown;
    ip?: string;
    userAgent?: string;
    responseStatus?: number;
    responseBody?: unknown;
    latencyMs?: number;
    chaosApplied?: string[];
}

export interface LiveStatsEvent {
    type: 'stats';
    connectedClients: number;
    timestamp: string;
}

// ─── Global connections set ─────────────────────────────────────────────────

const clients = new Map<WebSocket, string | null>();

/**
 * Get the number of connected WebSocket clients.
 */
export function getConnectedClients(): number {
    return clients.size;
}

export function getEndpointSubscriberCount(endpointId: string): number {
    let count = 0;
    for (const filter of clients.values()) {
        if (!filter || filter === endpointId) {
            count += 1;
        }
    }
    return count;
}

/**
 * Broadcast a request event to all connected clients.
 * Call this from the mock router after processing each request.
 */
export function broadcastRequest(event: LiveRequestEvent): void {
    if (clients.size === 0) return;

    const message = JSON.stringify({
        type: 'REQUEST_LOG',
        payload: event
    });

    const dead: WebSocket[] = [];

    for (const [client, filter] of clients.entries()) {
        // If client has a filter, only send if it matches
        if (filter && filter !== event.endpointId) {
            continue;
        }

        if (client.readyState === WebSocket.OPEN) {
            try {
                client.send(message);
            } catch {
                dead.push(client);
            }
        } else {
            dead.push(client);
        }
    }

    // Clean up dead connections
    for (const d of dead) {
        clients.delete(d);
    }
}

/**
 * Broadcast arbitrary data to all connected clients.
 */
export function broadcastEvent(event: Record<string, unknown>): void {
    if (clients.size === 0) return;
    const message = JSON.stringify(event);
    for (const client of clients.keys()) {
        if (client.readyState === WebSocket.OPEN) {
            try {
                client.send(message);
            } catch { /* ignore */ }
        }
    }
}

// ─── Fastify plugin ─────────────────────────────────────────────────────────

export const websocketPlugin: FastifyPluginAsync = async (fastify: FastifyInstance) => {
    // Register @fastify/websocket - Moved to app.ts/index.ts
    // await fastify.register(import('@fastify/websocket'));

    // WebSocket endpoint for live request stream
    fastify.get('/api/ws', { websocket: true }, (socket, req) => {
        const ws = socket as unknown as WebSocket;
        const endpointId = (req.query as any).endpointId || null;

        clients.set(ws, endpointId);
        logger.info(`WebSocket client connected (filter: ${endpointId}, total: ${clients.size})`);

        // Send welcome message
        ws.send(JSON.stringify({
            type: 'connected',
            message: 'Connected to MockUrl live request stream',
            endpointId,
            timestamp: new Date().toISOString(),
        }));

        // Handle ping/pong for keepalive
        ws.on('message', (data: Buffer) => {
            try {
                const msg = JSON.parse(data.toString());
                if (msg.type === 'ping') {
                    ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
                }
            } catch { /* ignore non-JSON messages */ }
        });

        ws.on('close', () => {
            clients.delete(ws);
            logger.info(`WebSocket client disconnected (total: ${clients.size})`);
        });

        ws.on('error', () => {
            clients.delete(ws);
        });
    });
};
