import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@/components/ui/select";
import { useWebSocket } from "@/hooks/useWebSocket";
import { fetchEndpoints, type Endpoint } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Activity, Clock, Trash2, Wifi, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";

// Helper to colorize HTTP methods
const getMethodColor = (method: string) => {
    switch (method) {
        case 'GET': return 'bg-blue-500/10 text-blue-500 border-blue-500/20';
        case 'POST': return 'bg-green-500/10 text-green-500 border-green-500/20';
        case 'PUT': return 'bg-orange-500/10 text-orange-500 border-orange-500/20';
        case 'DELETE': return 'bg-red-500/10 text-red-500 border-red-500/20';
        case 'PATCH': return 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20';
        default: return 'bg-slate-500/10 text-slate-500 border-slate-500/20';
    }
};

const getStatusColor = (status: number) => {
    if (status >= 200 && status < 300) return 'text-green-500';
    if (status >= 300 && status < 400) return 'text-blue-500';
    if (status >= 400 && status < 500) return 'text-orange-500';
    if (status >= 500) return 'text-red-500';
    return 'text-slate-500';
};

export default function RequestsPage() {
    const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
    const [selectedEndpointId, setSelectedEndpointId] = useState<string | null>(null);
    const { messages, status, clearMessages } = useWebSocket(selectedEndpointId);
    const [selectedRequest, setSelectedRequest] = useState<any | null>(null);

    useEffect(() => {
        fetchEndpoints().then(data => {
            setEndpoints(data);
            if (data.length > 0 && !selectedEndpointId) {
                setSelectedEndpointId(data[0].id);
            }
        });
    }, []);

    return (
        <div className="flex flex-col h-[calc(100vh-8rem)] gap-4">
            {/* Header & Controls */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                        Live Traffic
                        {status === "connected" && <span className="relative flex h-3 w-3">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                        </span>}
                    </h2>
                    <p className="text-muted-foreground">Real-time request inspector.</p>
                </div>

                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">Endpoint:</span>
                        <Select
                            value={selectedEndpointId || ""}
                            onValueChange={setSelectedEndpointId}
                        >
                            <SelectTrigger className="w-[200px]">
                                <SelectValue placeholder="Select endpoint" />
                            </SelectTrigger>
                            <SelectContent>
                                {endpoints.map(ep => (
                                    <SelectItem key={ep.id} value={ep.id}>
                                        {ep.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className={cn(
                        "flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border",
                        status === "connected" ? "bg-green-500/10 text-green-500 border-green-500/20" :
                            status === "connecting" ? "bg-yellow-500/10 text-yellow-500 border-yellow-500/20" :
                                "bg-red-500/10 text-red-500 border-red-500/20"
                    )}>
                        {status === "connected" ? <Wifi size={14} /> : <WifiOff size={14} />}
                        {status === "connected" ? "Connected" : status === "connecting" ? "Connecting..." : "Disconnected"}
                    </div>

                    <Button variant="outline" size="sm" onClick={clearMessages} title="Clear logs">
                        <Trash2 size={14} />
                    </Button>
                </div>
            </div>

            {/* Main Split View */}
            <div className="grid grid-cols-12 gap-6 h-full min-h-0">

                {/* Left: Request List */}
                <div className="col-span-4 flex flex-col h-full min-h-0 border rounded-xl bg-card overflow-hidden">
                    <div className="p-3 border-b bg-muted/40 font-medium text-xs text-muted-foreground flex justify-between">
                        <span>Incoming Requests</span>
                        <span>{messages.length} captured</span>
                    </div>
                    <ScrollArea className="flex-1">
                        <div className="flex flex-col">
                            {messages.length === 0 ? (
                                <div className="p-8 text-center text-muted-foreground text-sm">
                                    <Activity className="mx-auto h-8 w-8 mb-2 opacity-50" />
                                    No requests captured yet.<br />
                                    Make a request to your endpoint to see it appear here.
                                </div>
                            ) : (
                                messages.map((req, i) => (
                                    <button
                                        key={i}
                                        onClick={() => setSelectedRequest(req)}
                                        className={cn(
                                            "flex flex-col gap-1 p-3 border-b text-left transition-colors hover:bg-accent/50",
                                            selectedRequest === req ? "bg-accent border-l-2 border-l-primary" : "border-l-2 border-l-transparent"
                                        )}
                                    >
                                        <div className="flex items-center justify-between w-full">
                                            <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded border", getMethodColor(req.method))}>
                                                {req.method}
                                            </span>
                                            <span className={cn("text-xs font-mono font-medium", getStatusColor(req.responseStatus))}>
                                                {req.responseStatus || "---"}
                                            </span>
                                        </div>
                                        <div className="text-xs font-mono truncate w-full text-foreground/90" title={req.path}>
                                            {req.path}
                                        </div>
                                        <div className="flex items-center justify-between mt-1">
                                            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                                                <Clock size={10} />
                                                {new Date(req.timestamp).toLocaleTimeString()}
                                            </span>
                                            {req.latencyMs !== undefined && (
                                                <span className="text-[10px] text-muted-foreground">
                                                    {req.latencyMs}ms
                                                </span>
                                            )}
                                        </div>
                                    </button>
                                ))
                            )}
                        </div>
                    </ScrollArea>
                </div>

                {/* Right: Request Details */}
                <div className="col-span-8 flex flex-col h-full min-h-0 border rounded-xl bg-card overflow-hidden">
                    {selectedRequest ? (
                        <>
                            <div className="p-4 border-b bg-muted/40">
                                <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-3">
                                        <span className={cn("text-sm font-bold px-2 py-1 rounded border", getMethodColor(selectedRequest.method))}>
                                            {selectedRequest.method}
                                        </span>
                                        <span className="font-mono text-sm">{selectedRequest.path}</span>
                                    </div>
                                    <Badge variant="outline" className={cn("font-mono", getStatusColor(selectedRequest.responseStatus))}>
                                        Status: {selectedRequest.responseStatus}
                                    </Badge>
                                </div>
                                <div className="text-xs text-muted-foreground flex gap-4 font-mono">
                                    <span>ID: {selectedRequest.id?.slice(0, 8)}...</span>
                                    <span>Time: {new Date(selectedRequest.timestamp).toLocaleString()}</span>
                                    <span>IP: {selectedRequest.ip}</span>
                                </div>
                            </div>

                            <ScrollArea className="flex-1 p-4">
                                <div className="space-y-6">
                                    {/* Request Section */}
                                    <div>
                                        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2 text-foreground/90">
                                            Request
                                        </h3>
                                        <div className="grid gap-4">
                                            <div className="space-y-1.5">
                                                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Headers</div>
                                                <pre className="bg-muted/50 p-3 rounded-md text-xs font-mono overflow-auto border">
                                                    {JSON.stringify(selectedRequest.headers || {}, null, 2)}
                                                </pre>
                                            </div>

                                            {selectedRequest.query && Object.keys(selectedRequest.query).length > 0 && (
                                                <div className="space-y-1.5">
                                                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Query Params</div>
                                                    <pre className="bg-muted/50 p-3 rounded-md text-xs font-mono overflow-auto border">
                                                        {JSON.stringify(selectedRequest.query, null, 2)}
                                                    </pre>
                                                </div>
                                            )}

                                            {selectedRequest.body && (
                                                <div className="space-y-1.5">
                                                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Body</div>
                                                    <pre className="bg-muted/50 p-3 rounded-md text-xs font-mono overflow-auto border whitespace-pre-wrap break-all">
                                                        {typeof selectedRequest.body === 'object'
                                                            ? JSON.stringify(selectedRequest.body, null, 2)
                                                            : selectedRequest.body}
                                                    </pre>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Response Section */}
                                    <div>
                                        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2 text-foreground/90 pt-4 border-t">
                                            Response
                                        </h3>
                                        <div className="grid gap-4">
                                            <div className="space-y-1.5">
                                                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Response Body</div>
                                                <pre className="bg-muted/50 p-3 rounded-md text-xs font-mono overflow-auto border whitespace-pre-wrap break-all">
                                                    {selectedRequest.responseBody
                                                        ? (typeof selectedRequest.responseBody === 'object'
                                                            ? JSON.stringify(selectedRequest.responseBody, null, 2)
                                                            : selectedRequest.responseBody)
                                                        : <span className="text-muted-foreground italic">No content</span>}
                                                </pre>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </ScrollArea>
                        </>
                    ) : (
                        <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-8">
                            <Activity className="h-12 w-12 mb-4 opacity-20" />
                            <h3 className="text-lg font-medium text-foreground">Select a request</h3>
                            <p className="text-sm max-w-sm text-center mt-2">
                                Click on any request from the list on the left to inspect its headers, body, and response details.
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
