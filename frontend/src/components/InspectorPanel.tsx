import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { Activity, ArrowRight, Ban, Clock, Ghost, Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";

// Types matching backend LiveRequestEvent
interface RequestEvent {
    id: string;
    endpointId: string;
    timestamp: string;
    method: string;
    path: string;
    query?: Record<string, unknown>;
    headers?: Record<string, string>;
    body?: unknown;
    ip?: string;
    responseStatus?: number;
    responseBody?: unknown;
    latencyMs?: number;
    chaosApplied?: string[];
}

interface InspectorPanelProps {
    endpointId: string;
}

export function InspectorPanel({ endpointId }: InspectorPanelProps) {
    const [requests, setRequests] = useState<RequestEvent[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const wsRef = useRef<WebSocket | null>(null);

    // Auto-select latest if nothing selected/at bottom? 
    // For now, just append.

    useEffect(() => {
        connect();
        return () => {
            if (wsRef.current) {
                wsRef.current.close();
            }
        };
    }, [endpointId]);

    const connect = () => {
        const baseUrl = (import.meta.env.VITE_API_URL as string) || 'http://localhost:3000';
        const wsUrl = baseUrl.replace(/^http/, 'ws') + `/api/ws?endpointId=${endpointId}`;

        const ws = new WebSocket(wsUrl);

        ws.onopen = () => {
            setIsConnected(true);
        };

        ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                if (msg.type === 'REQUEST_LOG') {
                    if (!isPaused) {
                        setRequests(prev => [msg.payload, ...prev].slice(0, 50)); // Keep last 50
                    }
                }
            } catch (e) {
                console.error("Failed to parse WS message", e);
            }
        };

        ws.onclose = () => {
            setIsConnected(false);
            // Reconnect logic could go here, but keep simple for now
        };

        wsRef.current = ws;
    };

    const handleClear = () => {
        setRequests([]);
        setSelectedId(null);
    };

    const activeRequest = requests.find(r => r.id === selectedId) || requests[0];

    return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 h-[600px]">
            {/* Left Pane: Request List */}
            <Card className="col-span-1 flex flex-col overflow-hidden border-border/50">
                <div className="p-2 border-b bg-muted/30 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className={cn("w-2 h-2 rounded-full", isConnected ? "bg-green-500 animate-pulse" : "bg-red-500")} />
                        <span className="text-xs font-medium text-muted-foreground">{isConnected ? "Live" : "Disconnected"}</span>
                    </div>
                    <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setIsPaused(!isPaused)} title={isPaused ? "Resume" : "Pause"}>
                            {isPaused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
                        </Button>
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleClear} title="Clear">
                            <Ban className="h-3 w-3" />
                        </Button>
                    </div>
                </div>
                <ScrollArea className="flex-1">
                    <div className="flex flex-col">
                        {requests.length === 0 ? (
                            <div className="p-8 text-center text-muted-foreground text-xs">
                                <Activity className="w-8 h-8 mx-auto mb-2 opacity-50" />
                                <p>Waiting for requests...</p>
                            </div>
                        ) : (
                            requests.map((req) => (
                                <button
                                    key={req.id}
                                    onClick={() => setSelectedId(req.id)}
                                    className={cn(
                                        "flex flex-col gap-1 p-3 text-left border-b border-border/50 hover:bg-muted/50 transition-colors",
                                        selectedId === req.id || (!selectedId && req === requests[0]) ? "bg-muted border-l-2 border-l-primary" : "border-l-2 border-l-transparent"
                                    )}
                                >
                                    <div className="flex items-center justify-between">
                                        <Badge variant="outline" className={cn(
                                            "text-[10px] px-1 py-0 h-4 font-mono",
                                            req.method === "GET" && "text-blue-500 border-blue-200",
                                            req.method === "POST" && "text-green-500 border-green-200",
                                            req.method === "PUT" && "text-orange-500 border-orange-200",
                                            req.method === "DELETE" && "text-red-500 border-red-200"
                                        )}>
                                            {req.method}
                                        </Badge>
                                        <span className={cn(
                                            "text-[10px] font-mono",
                                            req.responseStatus && req.responseStatus >= 400 ? "text-red-500" : "text-green-500"
                                        )}>
                                            {req.responseStatus || "..."}
                                        </span>
                                    </div>
                                    <div className="text-xs font-medium truncate w-full" title={req.path}>
                                        {req.path}
                                    </div>
                                    <div className="flex items-center justify-between mt-1">
                                        <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                                            <Clock className="w-3 h-3" />
                                            {new Date(req.timestamp).toLocaleTimeString()}
                                        </span>
                                        <span className="text-[10px] text-muted-foreground">
                                            {req.latencyMs}ms
                                        </span>
                                    </div>
                                    {req.chaosApplied && req.chaosApplied.length > 0 && (
                                        <div className="flex gap-1 mt-1">
                                            {req.chaosApplied.map(c => (
                                                <Badge key={c} variant="destructive" className="text-[9px] h-3 px-1">
                                                    {c}
                                                </Badge>
                                            ))}
                                        </div>
                                    )}
                                </button>
                            ))
                        )}
                    </div>
                </ScrollArea>
            </Card>

            {/* Right Pane: Request Details */}
            <Card className="col-span-1 md:col-span-2 flex flex-col overflow-hidden border-border/50 h-[600px]">
                {activeRequest ? (
                    <>
                        <div className="p-3 border-b bg-muted/10 flex items-center gap-3">
                            <Badge variant="outline" className="font-mono">{activeRequest.method}</Badge>
                            <span className="font-mono text-sm">{activeRequest.path}</span>
                            <div className="ml-auto flex items-center gap-2">
                                <Badge variant={activeRequest.responseStatus && activeRequest.responseStatus >= 400 ? "destructive" : "secondary"}>
                                    Status: {activeRequest.responseStatus}
                                </Badge>
                                <Badge variant="outline" className="text-muted-foreground">
                                    {activeRequest.latencyMs}ms
                                </Badge>
                            </div>
                        </div>
                        <ScrollArea className="flex-1 p-4">
                            <div className="space-y-6">
                                {/* Request Details */}
                                <div>
                                    <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                                        <ArrowRight className="w-4 h-4 text-blue-500" /> Request
                                    </h4>
                                    <div className="grid gap-4 pl-6 border-l-2 border-blue-500/20">
                                        {activeRequest.query && Object.keys(activeRequest.query).length > 0 && (
                                            <div>
                                                <span className="text-xs font-medium text-muted-foreground uppercase">Query Params</span>
                                                <pre className="mt-1 bg-muted/50 p-2 rounded text-xs font-mono overflow-auto">
                                                    {JSON.stringify(activeRequest.query, null, 2)}
                                                </pre>
                                            </div>
                                        )}
                                        {activeRequest.headers && (
                                            <div>
                                                <span className="text-xs font-medium text-muted-foreground uppercase">Headers</span>
                                                <div className="mt-1 grid grid-cols-1 gap-1">
                                                    {Object.entries(activeRequest.headers).map(([k, v]) => (
                                                        <div key={k} className="flex text-xs">
                                                            <span className="font-medium min-w-[120px] text-muted-foreground">{k}:</span>
                                                            <span className="font-mono truncate">{String(v)}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                        {activeRequest.body != null && (
                                            <div>
                                                <span className="text-xs font-medium text-muted-foreground uppercase">Body</span>
                                                <pre className="mt-1 bg-muted/50 p-2 rounded text-xs font-mono overflow-auto max-h-[200px]">
                                                    {typeof activeRequest.body === 'object'
                                                        ? JSON.stringify(activeRequest.body, null, 2)
                                                        : String(activeRequest.body)}
                                                </pre>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Response Details */}
                                <div>
                                    <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                                        <ArrowRight className="w-4 h-4 text-green-500 rotate-180" /> Response
                                    </h4>
                                    <div className="grid gap-4 pl-6 border-l-2 border-green-500/20">
                                        {activeRequest.responseBody != null && (
                                            <div>
                                                <span className="text-xs font-medium text-muted-foreground uppercase">Body</span>
                                                <pre className="mt-1 bg-muted/50 p-2 rounded text-xs font-mono overflow-auto max-h-[300px]">
                                                    {typeof activeRequest.responseBody === 'object'
                                                        ? JSON.stringify(activeRequest.responseBody, null, 2)
                                                        : String(activeRequest.responseBody)}
                                                </pre>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </ScrollArea>
                    </>
                ) : (
                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                        <Ghost className="w-12 h-12 mb-4 opacity-20" />
                        <p>No request selected</p>
                    </div>
                )}
            </Card>
        </div>
    );
}
