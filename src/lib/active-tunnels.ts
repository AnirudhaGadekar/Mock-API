
import { WebSocket } from 'ws';

export interface TunnelSession {
    tunnelId: string;
    userId?: string;
    socket: WebSocket;
    createdAt: Date;
    pendingRequests: Map<string, {
        resolve: (value: any) => void;
        reject: (reason?: any) => void;
    }>;
}

// In-memory store for active tunnels (Singleton)
// In a multi-instance deployment, this would need Redis Pub/Sub
export const activeTunnels = new Map<string, TunnelSession>();

export function registerTunnel(tunnelId: string, socket: WebSocket, userId?: string) {
    const session: TunnelSession = {
        tunnelId,
        userId,
        socket,
        createdAt: new Date(),
        pendingRequests: new Map()
    };
    activeTunnels.set(tunnelId, session);
    return session;
}

export function removeTunnel(tunnelId: string) {
    activeTunnels.delete(tunnelId);
}

export function getTunnel(tunnelId: string) {
    return activeTunnels.get(tunnelId);
}
