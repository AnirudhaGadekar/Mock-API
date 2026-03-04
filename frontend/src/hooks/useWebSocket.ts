import { useEffect, useRef, useState } from "react";
import { toast } from "react-hot-toast";
import { API_BASE_URL } from "@/lib/api";

export const useWebSocket = (endpointId: string | null) => {
    const ws = useRef<WebSocket | null>(null);
    const [messages, setMessages] = useState<any[]>([]);
    const [status, setStatus] = useState<"connecting" | "connected" | "disconnected">("disconnected");

    useEffect(() => {
        if (!endpointId) {
            if (ws.current) {
                ws.current.close();
                ws.current = null;
            }
            setStatus("disconnected");
            return;
        }

        // Use 'wss' if 'https', else 'ws'
        const baseUrl = API_BASE_URL;
        const wsScheme = baseUrl.startsWith('https') ? 'wss' : 'ws';
        const wsUrl = baseUrl.replace(/^https?/, wsScheme) + `/api/ws?endpointId=${endpointId}`;

        const socket = new WebSocket(wsUrl);
        ws.current = socket;

        socket.onopen = () => {
            setStatus("connected");
            // Authenticate if needed - currently anonymous
        };

        socket.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === "REQUEST_LOG") {
                    setMessages((prev) => [data.payload, ...prev].slice(0, 100)); // Keep last 100
                }
            } catch (e) {
                console.error("Failed to parse WS message", e);
            }
        };

        socket.onclose = () => {
            setStatus("disconnected");
            ws.current = null;
        };

        socket.onerror = () => {
            toast.error("Live connection error");
            setStatus("disconnected");
        };

        return () => {
            socket.close();
        };
    }, [endpointId]);

    return { messages, status, clearMessages: () => setMessages([]) };
};
