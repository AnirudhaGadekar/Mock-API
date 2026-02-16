
import { SocketStream } from '@fastify/websocket';
import { FastifyPluginAsync } from 'fastify';
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

const tunnelWsRoute: FastifyPluginAsync = async (fastify) => {
    fastify.get('/tunnel-ws', { websocket: true }, (connection: SocketStream, req: any) => {
        const socket = connection.socket;
        let currentTunnelId: string | null = null;

        logger.info('New WebSocket connection initiated');

        socket.on('message', async (raw: Buffer) => {
            try {
                const data = JSON.parse(raw.toString());

                if (data.type === 'CONNECT') {
                    const msg = data as ConnectMessage;

                    if (!msg.apiKey) {
                        socket.send(JSON.stringify({ type: 'ERROR', message: 'Missing API key' }));
                        return;
                    }

                    const user = await fetchUserByApiKey(msg.apiKey);
                    if (!user) {
                        socket.send(JSON.stringify({ type: 'ERROR', message: 'Invalid API key' }));
                        return;
                    }

                    // Generate or use preferred tunnel ID
                    const tunnelId = msg.tunnelId || `tunnel-${Math.random().toString(36).substring(2, 9)}`;

                    if (activeTunnels.has(tunnelId)) {
                        socket.send(JSON.stringify({ type: 'ERROR', message: 'Tunnel ID already in use' }));
                        return;
                    }

                    currentTunnelId = tunnelId;
                    registerTunnel(tunnelId, socket as any, user.id);

                    logger.info(`Tunnel registered: ${tunnelId} for user ${user.id}`);
                    socket.send(JSON.stringify({
                        type: 'CONNECTED',
                        tunnelId,
                        publicUrl: `https://${req.hostname}/tunnel/${tunnelId}`
                    }));
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
                logger.error('WebSocket message error', err);
                socket.send(JSON.stringify({ type: 'ERROR', message: 'Invalid message format' }));
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
