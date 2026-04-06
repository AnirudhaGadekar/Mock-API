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
import axios from "axios";
import { Activity, Clock, RefreshCcw, Trash2, Wand2, Wifi, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "react-hot-toast";
import { useNavigate } from "react-router-dom";

// Helper to colorize HTTP methods
const getMethodColor = (method: string) => {
    switch (method) {
        case 'GET': return 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20';
        case 'POST': return 'bg-green-500/10 text-green-500 border-green-500/20';
        case 'PUT': return 'bg-orange-500/10 text-orange-500 border-orange-500/20';
        case 'DELETE': return 'bg-red-500/10 text-red-500 border-red-500/20';
        case 'PATCH': return 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20';
        default: return 'bg-muted text-muted-foreground border-border/70';
    }
};

const getStatusColor = (status: number) => {
    if (status >= 200 && status < 300) return 'text-green-500';
    if (status >= 300 && status < 400) return 'text-primary';
    if (status >= 400 && status < 500) return 'text-orange-500';
    if (status >= 500) return 'text-red-500';
    return 'text-muted-foreground';
};

export default function RequestsPage() {
    const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
    const [selectedEndpointId, setSelectedEndpointId] = useState<string | null>(null);
    const { messages, status, clearMessages } = useWebSocket(selectedEndpointId);
    const [selectedRequest, setSelectedRequest] = useState<any | null>(null);
    const [isReplaying, setIsReplaying] = useState(false);
    const navigate = useNavigate();

    const handleReplay = async () => {
        if (!selectedRequest || !selectedEndpointId) return;

        const endpoint = endpoints.find(e => e.id === selectedEndpointId);
        if (!endpoint) return;

        setIsReplaying(true);
        const toastId = toast.loading("Replaying request...");

        try {
            const url = `${endpoint.url}${selectedRequest.path}`;
            const headers = { ...selectedRequest.headers };
            // Remove some headers that might interfere
            delete headers['host'];
            delete headers['content-length'];
            delete headers['connection'];

            await axios({
                method: selectedRequest.method,
                url,
                headers,
                data: selectedRequest.body,
                timeout: 10000
            });
            toast.success("Request replayed!", { id: toastId });
        } catch (err: any) {
            console.error("Replay failed:", err);
            toast.error(`Replay failed: ${err.message}`, { id: toastId });
        } finally {
            setIsReplaying(false);
        }
    };

    const handleMagicMock = () => {
        if (!selectedRequest || !selectedEndpointId) return;

        // Pass request data via state to the config page
        navigate(`/endpoints/${selectedEndpointId}`, {
            state: {
                initialRule: {
                    path: selectedRequest.path,
                    method: selectedRequest.method,
                    response: {
                        status: selectedRequest.responseStatus || 200,
                        body: selectedRequest.responseBody || ""
                    }
                }
            }
        });
    };

    useEffect(() => {
        fetchEndpoints().then(data => {
            setEndpoints(data);
            if (data.length > 0 && !selectedEndpointId) {
                setSelectedEndpointId(data[0].id);
            }
        });
    }, []);

    return (
        <div className="flex min-h-[calc(100vh-10rem)] flex-col gap-4">
            {/* Header & Controls */}
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
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

                <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center md:justify-end">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <span className="text-sm font-medium">Endpoint:</span>
                        <Select
                            value={selectedEndpointId || ""}
                            onValueChange={setSelectedEndpointId}
                        >
                            <SelectTrigger className="w-full sm:w-[240px]">
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
                        "flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-medium",
                        status === "connected" ? "bg-success/10 text-success border-success/20" :
                            status === "connecting" ? "bg-warning/10 text-warning border-warning/20" :
                                "bg-destructive/10 text-destructive border-destructive/20"
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
            <div className="grid min-h-0 gap-6 xl:grid-cols-12">

                {/* Left: Request List */}
                <div className="flex min-h-[22rem] flex-col overflow-hidden rounded-[1.5rem] border border-border/70 bg-card xl:col-span-4">
                    <div className="flex justify-between border-b border-border/70 bg-muted/40 p-3 text-xs font-medium text-muted-foreground">
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
                                            "flex flex-col gap-1 border-b border-border/55 p-3 text-left transition-colors hover:bg-muted/50",
                                            selectedRequest === req ? "bg-primary/10 border-l-2 border-l-primary" : "border-l-2 border-l-transparent"
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
                <div className="flex min-h-[24rem] flex-col overflow-hidden rounded-[1.5rem] border border-border/70 bg-card xl:col-span-8">
                    {selectedRequest ? (
                        <>
                            <div className="border-b border-border/70 bg-muted/40 p-4">
                                <div className="mb-2 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                                    <div className="flex min-w-0 items-center gap-3">
                                        <span className={cn("text-sm font-bold px-2 py-1 rounded border", getMethodColor(selectedRequest.method))}>
                                            {selectedRequest.method}
                                        </span>
                                        <span className="truncate font-mono text-sm">{selectedRequest.path}</span>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="h-8 gap-1.5"
                                            onClick={handleReplay}
                                            disabled={isReplaying}
                                        >
                                            <RefreshCcw className={cn("h-3.5 w-3.5", isReplaying && "animate-spin")} />
                                            Replay
                                        </Button>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="h-8 gap-1.5"
                                            onClick={handleMagicMock}
                                        >
                                            <Wand2 className="h-3.5 w-3.5" />
                                            Magic Mock
                                        </Button>
                                        <Badge variant="outline" className={cn("h-8 font-mono", getStatusColor(selectedRequest.responseStatus))}>
                                            Status: {selectedRequest.responseStatus}
                                        </Badge>
                                    </div>
                                </div>
                                <div className="flex flex-wrap gap-4 font-mono text-xs text-muted-foreground">
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
                                                <pre className="surface-code rounded-[1rem] p-3 text-xs font-mono overflow-auto">
                                                    {JSON.stringify(selectedRequest.headers || {}, null, 2)}
                                                </pre>
                                            </div>

                                            {selectedRequest.query && Object.keys(selectedRequest.query).length > 0 && (
                                                <div className="space-y-1.5">
                                                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Query Params</div>
                                                    <pre className="surface-code rounded-[1rem] p-3 text-xs font-mono overflow-auto">
                                                        {JSON.stringify(selectedRequest.query, null, 2)}
                                                    </pre>
                                                </div>
                                            )}

                                            {selectedRequest.body && (
                                                <div className="space-y-1.5">
                                                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Body</div>
                                                    <pre className="surface-code rounded-[1rem] p-3 text-xs font-mono overflow-auto whitespace-pre-wrap break-all">
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
                                        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2 text-foreground/90 pt-4 border-t border-border/70">
                                            Response
                                        </h3>
                                        <div className="grid gap-4">
                                            <div className="space-y-1.5">
                                                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Response Body</div>
                                                <pre className="surface-code rounded-[1rem] p-3 text-xs font-mono overflow-auto whitespace-pre-wrap break-all">
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
