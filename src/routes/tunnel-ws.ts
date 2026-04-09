import { FastifyPluginAsync } from 'fastify';
import { WebSocket } from 'ws';
import { activeTunnels, getTunnel, registerTunnel, removeTunnel } from '../lib/active-tunnels.js';
import { logger } from '../lib/logger.js';
import { fetchUserByApiKey } from '../middleware/auth.middleware.js';

interface ConnectMessage {
    type: 'CONNECT';
    tunnelId?: string; // Optional preference
    apiKey?: string;
}

interface ResponseMessage {
    type: 'RESPONSE';
    requestId: string;
    status: number;
    headers: Record<string, string>;
    body: string; // Base64
}

const DEFAULT_AUTH_TIMEOUT_MS = 5000;

function getAuthTimeoutMs(): number {
    const parsed = Number.parseInt(process.env.TUNNEL_AUTH_TIMEOUT_MS ?? '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_AUTH_TIMEOUT_MS;
}

function sendSocketMessage(
    socket: WebSocket,
    payload: Record<string, unknown>,
): void {
    if (socket.readyState !== WebSocket.OPEN) {
        logger.warn('Skipping websocket send because socket is not open', {
            readyState: socket.readyState,
            payloadType: payload.type,
        });
        return;
    }

    socket.send(JSON.stringify(payload));
}

async function authenticateTunnelClient(apiKey: string): Promise<any | null> {
    const timeoutMs = getAuthTimeoutMs();

    return Promise.race([
        fetchUserByApiKey(apiKey),
        new Promise<null>((_, reject) => {
            setTimeout(() => {
                reject(new Error(`Tunnel authentication timed out after ${timeoutMs}ms`));
            }, timeoutMs);
        }),
    ]);
}

function getPublicTunnelBaseUrl(req: any): string {
    const forwardedProtoHeader = req.headers['x-forwarded-proto'];
    const forwardedHostHeader = req.headers['x-forwarded-host'];
    const forwardedProto = Array.isArray(forwardedProtoHeader) ? forwardedProtoHeader[0] : forwardedProtoHeader;
    const forwardedHost = Array.isArray(forwardedHostHeader) ? forwardedHostHeader[0] : forwardedHostHeader;

    const proto = (forwardedProto || 'https').toString().split(',')[0].trim();
    const host = (forwardedHost || req.hostname).toString().split(',')[0].trim();

    if (host) {
        return `${proto}://${host}`;
    }
    if (process.env.RENDER_EXTERNAL_URL) {
        return process.env.RENDER_EXTERNAL_URL;
    }
    return 'http://localhost:3000';
}

const tunnelWsRoute: FastifyPluginAsync = async (fastify) => {
    fastify.get('/tunnel-ws', { websocket: true }, (socket: WebSocket, req: any) => {
        let currentTunnelId: string | null = null;

        logger.info('New WebSocket connection initiated');

        socket.on('error', (err) => {
            logger.error('Tunnel websocket transport error', {
                err,
                tunnelId: currentTunnelId,
                url: req.url,
            });
        });

        socket.on('message', async (raw: WebSocket.RawData) => {
            try {
                const data = JSON.parse(raw.toString());

                if (data.type === 'CONNECT') {
                    const msg = data as ConnectMessage;

                    logger.info('Tunnel CONNECT message received', {
                        requestedTunnelId: msg.tunnelId ?? null,
                        hasApiKey: Boolean(msg.apiKey),
                    });

                    if (!msg.apiKey) {
                        sendSocketMessage(socket, { type: 'ERROR', message: 'Missing API key' });
                        return;
                    }

                    let user: any | null;
                    try {
                        user = await authenticateTunnelClient(msg.apiKey);
                    } catch (err) {
                        logger.error('Tunnel authentication failed', {
                            err,
                            requestedTunnelId: msg.tunnelId ?? null,
                        });
                        sendSocketMessage(socket, {
                            type: 'ERROR',
                            message: err instanceof Error ? err.message : 'Tunnel authentication failed',
                        });
                        return;
                    }

                    if (!user) {
                        sendSocketMessage(socket, { type: 'ERROR', message: 'Invalid API key' });
                        return;
                    }

                    // Generate or use preferred tunnel ID
                    const tunnelId = msg.tunnelId || `tunnel-${Math.random().toString(36).substring(2, 9)}`;

                    if (activeTunnels.has(tunnelId)) {
                        sendSocketMessage(socket, { type: 'ERROR', message: 'Tunnel ID already in use' });
                        return;
                    }

                    currentTunnelId = tunnelId;
                    registerTunnel(tunnelId, socket, user.id);

                    logger.info('Tunnel registered', { tunnelId, userId: user.id });
                    const publicBaseUrl = getPublicTunnelBaseUrl(req);
                    sendSocketMessage(socket, {
                        type: 'CONNECTED',
                        tunnelId,
                        publicUrl: `${publicBaseUrl}/tunnel/${tunnelId}`
                    });
                }
                else if (data.type === 'RESPONSE') {
                    const msg = data as ResponseMessage;
                    if (currentTunnelId) {
                        const session = getTunnel(currentTunnelId);
                        if (session) {
                            const pending = session.pendingRequests.get(msg.requestId);
                            if (pending) {
                                pending.resolve(msg);
                                session.pendingRequests.delete(msg.requestId);
                            }
                        }
                    }
                }
            } catch (err) {
                logger.error('WebSocket message error', { err, tunnelId: currentTunnelId });
                sendSocketMessage(socket, { type: 'ERROR', message: 'Invalid message format' });
            }
        });

        socket.on('close', () => {
            if (currentTunnelId) {
                logger.info(`Tunnel disconnected: ${currentTunnelId}`);
                removeTunnel(currentTunnelId);
            }
        });
    });
};

export default tunnelWsRoute;
