import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    createEndpoint,
    deleteEndpoint,
    fetchEndpoints,
    fetchHistory,
    fetchLiveSummary,
    type Endpoint,
    type HistoryItem,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import {
    Activity,
    Clock,
    Copy,
    ExternalLink,
    Globe,
    Plus,
    RefreshCw,
    Search,
    Terminal,
    Trash2,
    Wifi,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "react-hot-toast";

// ─── Helpers ────────────────────────────────────────────────────────────────
const getMethodColor = (method: string) => {
    switch (method) {
        case "GET": return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
        case "POST": return "bg-sky-500/10 text-sky-400 border-sky-500/20";
        case "PUT": return "bg-violet-500/10 text-violet-400 border-violet-500/20";
        case "DELETE": return "bg-red-500/10 text-red-400 border-red-500/20";
        case "PATCH": return "bg-amber-500/10 text-amber-400 border-amber-500/20";
        default: return "bg-slate-500/10 text-slate-400 border-slate-500/20";
    }
};

const getStatusColor = (status: number | undefined) => {
    if (!status) return "text-muted-foreground";
    if (status < 300) return "text-emerald-400";
    if (status < 400) return "text-sky-400";
    if (status < 500) return "text-amber-400";
    return "text-red-400";
};

export default function Dashboard() {
    // Endpoint state
    const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [loadingEps, setLoadingEps] = useState(true);

    // Create endpoint
    const [newName, setNewName] = useState("");
    const [creating, setCreating] = useState(false);

    // History for selected endpoint
    const [history, setHistory] = useState<HistoryItem[]>([]);
    const [historyFilter, setHistoryFilter] = useState("");
    const [loadingHistory, setLoadingHistory] = useState(false);
    const [historyTotal, setHistoryTotal] = useState(0);
    const [liveSummary, setLiveSummary] = useState<{
        isActive: boolean;
        requestCount1m: number;
        requestCount5m: number;
        errorCount5m: number;
        errorRate5m: number;
        lastSeenAt: string | null;
        websocketSubscribers: number;
    } | null>(null);

    // Polling
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const selectedEndpoint = endpoints.find((ep) => ep.id === selectedId) ?? null;

    // ─── Load endpoints ──────────────────────────────────────────────────────
    const loadEndpoints = useCallback(async () => {
        try {
            const data = await fetchEndpoints();
            setEndpoints(data);
            return data;
        } catch {
            toast.error("Failed to load endpoints");
            return [];
        }
    }, []);

    useEffect(() => {
        setLoadingEps(true);
        loadEndpoints().then((data) => {
            // Auto-select first endpoint if none selected
            if (data.length > 0 && !selectedId) {
                setSelectedId(data[0].id);
            }
            setLoadingEps(false);
        });
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ─── Load history for selected endpoint ──────────────────────────────────
    const loadHistory = useCallback(
        async (epId: string, filter?: string) => {
            try {
                setLoadingHistory(true);
                const res = await fetchHistory(epId, {
                    search: filter || undefined,
                    limit: 50,
                });
                setHistory(res.history);
                setHistoryTotal(res.totalCount);
            } catch {
                // silent — don't toast on every poll
            } finally {
                setLoadingHistory(false);
            }
        },
        []
    );

    const loadLiveSummary = useCallback(async (epId: string) => {
        try {
            const summary = await fetchLiveSummary(epId);
            setLiveSummary(summary);
        } catch {
            // silent: non-blocking dashboard extra
        }
    }, []);

    useEffect(() => {
        if (!selectedId) {
            setHistory([]);
            setLiveSummary(null);
            return;
        }
        loadHistory(selectedId, historyFilter);
        loadLiveSummary(selectedId);

        // Poll every 5s
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = setInterval(() => {
            loadHistory(selectedId, historyFilter);
            loadLiveSummary(selectedId);
        }, 5000);

        return () => {
            if (pollRef.current) clearInterval(pollRef.current);
        };
    }, [selectedId, historyFilter, loadHistory, loadLiveSummary]);

    // ─── Create endpoint ─────────────────────────────────────────────────────
    const handleCreate = async () => {
        const name = newName.trim();
        if (!name) return;
        try {
            setCreating(true);
            const ep = await createEndpoint(name);
            toast.success(`Endpoint "${ep.name}" created!`);
            setNewName("");
            const data = await loadEndpoints();
            // Select the newly created endpoint
            const created = data.find((e) => e.id === ep.id);
            if (created) setSelectedId(created.id);
        } catch (err: any) {
            toast.error(
                err.response?.data?.error?.message || "Failed to create endpoint"
            );
        } finally {
            setCreating(false);
        }
    };

    // ─── Delete endpoint ─────────────────────────────────────────────────────
    const handleDelete = async (id: string, name: string) => {
        if (
            !confirm(
                `Delete "${name}"? All request history will also be deleted. This cannot be undone.`
            )
        )
            return;
        try {
            await deleteEndpoint(id);
            toast.success("Endpoint deleted");
            if (selectedId === id) setSelectedId(null);
            await loadEndpoints();
        } catch {
            toast.error("Failed to delete endpoint");
        }
    };

    // ─── Copy to clipboard ───────────────────────────────────────────────────
    const copy = (text: string) => {
        navigator.clipboard.writeText(text);
        toast.success("Copied!");
    };

    // ─── Render ──────────────────────────────────────────────────────────────
    return (
        <div className="grid grid-cols-12 gap-5 h-[calc(100vh-8rem)]">
            {/* ── Left: Create + Endpoints List ──────────────────────────────── */}
            <div className="col-span-3 flex flex-col gap-4 min-h-0">
                {/* Create new endpoint */}
                <Card className="shrink-0">
                    <CardHeader className="pb-3">
                        <CardTitle className="text-sm flex items-center gap-2 font-semibold">
                            <Plus size={14} className="text-primary" />
                            New Endpoint
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <Input
                            placeholder="e.g. my-mock-api"
                            value={newName}
                            onChange={(e) =>
                                setNewName(
                                    e.target.value
                                        .toLowerCase()
                                        .replace(/[^a-z0-9-]/g, "")
                                )
                            }
                            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                            className="text-sm"
                        />
                        <p className="text-[11px] text-muted-foreground">
                            5–40 chars · lowercase · digits · hyphens
                        </p>
                        <Button
                            className="w-full"
                            onClick={handleCreate}
                            disabled={!newName.trim() || creating}
                        >
                            {creating ? (
                                <RefreshCw size={14} className="animate-spin mr-2" />
                            ) : (
                                <Plus size={14} className="mr-2" />
                            )}
                            {creating ? "Creating…" : "Create endpoint"}
                        </Button>
                    </CardContent>
                </Card>

                {/* Endpoints list */}
                <Card className="flex-1 flex flex-col min-h-0">
                    <CardHeader className="pb-2 shrink-0">
                        <CardTitle className="text-sm flex items-center justify-between font-semibold">
                            <span className="flex items-center gap-2">
                                <Globe size={14} className="text-primary" />
                                Endpoints
                            </span>
                            <span className="text-xs text-muted-foreground font-normal">
                                {endpoints.length} total
                            </span>
                        </CardTitle>
                    </CardHeader>
                    <ScrollArea className="flex-1">
                        <div className="px-4 pb-4 space-y-1">
                            {loadingEps ? (
                                <div className="space-y-2">
                                    {[1, 2, 3].map((i) => (
                                        <div
                                            key={i}
                                            className="h-12 rounded-md bg-muted/30 animate-pulse"
                                        />
                                    ))}
                                </div>
                            ) : endpoints.length === 0 ? (
                                <div className="text-center py-8 text-muted-foreground text-xs">
                                    <Globe
                                        size={24}
                                        className="mx-auto mb-2 opacity-30"
                                    />
                                    No endpoints yet.
                                    <br />
                                    Create one above to get a live mock URL.
                                </div>
                            ) : (
                                endpoints.map((ep) => (
                                    <button
                                        key={ep.id}
                                        onClick={() => setSelectedId(ep.id)}
                                        className={cn(
                                            "w-full text-left px-3 py-2.5 rounded-md transition-all text-sm group",
                                            selectedId === ep.id
                                                ? "bg-primary/10 ring-1 ring-primary/20 text-foreground"
                                                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                                        )}
                                    >
                                        <div className="flex items-center justify-between">
                                            <span className="font-medium truncate">
                                                {ep.name}
                                            </span>
                                            <span className="text-[10px] font-mono opacity-60">
                                                {ep.reqCount}
                                            </span>
                                        </div>
                                        <div className="text-[11px] font-mono opacity-50 truncate mt-0.5" title={ep.url}>
                                            {ep.url.replace(/^https?:\/\//, '')}
                                        </div>
                                    </button>
                                ))
                            )}
                        </div>
                    </ScrollArea>
                </Card>
            </div>

            {/* ── Center: Selected Endpoint + History ─────────────────────────── */}
            <div className="col-span-9 flex flex-col gap-4 min-h-0">
                {selectedEndpoint ? (
                    <>
                        {/* Endpoint Details */}
                        <Card className="shrink-0">
                            <CardContent className="p-5">
                                <div className="flex items-start justify-between mb-4">
                                    <div>
                                        <h2 className="text-lg font-bold flex items-center gap-2">
                                            {selectedEndpoint.name}
                                            <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-mono font-normal truncate max-w-[200px]" title={selectedEndpoint.url}>
                                                {selectedEndpoint.url.replace(/^https?:\/\//, '')}
                                            </span>
                                        </h2>
                                        <p className="text-xs text-muted-foreground mt-1">
                                            Created{" "}
                                            {new Date(
                                                selectedEndpoint.createdAt
                                            ).toLocaleDateString()}{" "}
                                            ·{" "}
                                            {selectedEndpoint.reqCount.toLocaleString()}{" "}
                                            total requests
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => {
                                                loadEndpoints();
                                                if (selectedId)
                                                    loadHistory(
                                                        selectedId,
                                                        historyFilter
                                                    );
                                            }}
                                        >
                                            <RefreshCw size={13} className="mr-1" />
                                            Refresh
                                        </Button>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="text-destructive hover:text-destructive hover:bg-destructive/10"
                                            onClick={() =>
                                                handleDelete(
                                                    selectedEndpoint.id,
                                                    selectedEndpoint.name
                                                )
                                            }
                                        >
                                            <Trash2 size={13} />
                                        </Button>
                                    </div>
                                </div>

                                {/* Mock URL + curl */}
                                <div className="space-y-2">
                                    <div className="flex items-center gap-2 p-3 bg-secondary/50 rounded-lg border">
                                        <Wifi
                                            size={14}
                                            className="text-primary shrink-0"
                                        />
                                        <span className="font-mono text-sm select-all flex-1 truncate">
                                            {selectedEndpoint.url}
                                        </span>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-7 w-7 shrink-0"
                                            onClick={() =>
                                                copy(selectedEndpoint.url)
                                            }
                                            title="Copy URL"
                                        >
                                            <Copy size={13} />
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-7 w-7 shrink-0"
                                            onClick={() =>
                                                window.open(
                                                    selectedEndpoint.url,
                                                    "_blank"
                                                )
                                            }
                                            title="Open in browser"
                                        >
                                            <ExternalLink size={13} />
                                        </Button>
                                    </div>
                                    <div className="flex items-center gap-2 p-3 bg-secondary/50 rounded-lg border">
                                        <Terminal
                                            size={14}
                                            className="text-muted-foreground shrink-0"
                                        />
                                        <code className="text-[11px] text-muted-foreground flex-1 truncate select-all">
                                            curl -X GET {selectedEndpoint.url}
                                        </code>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-7 w-7 shrink-0"
                                            onClick={() =>
                                                copy(
                                                    `curl -X GET ${selectedEndpoint.url}`
                                                )
                                            }
                                            title="Copy curl"
                                        >
                                            <Copy size={13} />
                                        </Button>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="shrink-0">
                            <CardContent className="p-4">
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                    <div className="rounded-md border bg-secondary/40 p-3">
                                        <p className="text-[11px] text-muted-foreground">Live Status</p>
                                        <p className={cn("text-sm font-semibold", liveSummary?.isActive ? "text-emerald-500" : "text-muted-foreground")}>
                                            {liveSummary?.isActive ? "Receiving traffic" : "Idle"}
                                        </p>
                                    </div>
                                    <div className="rounded-md border bg-secondary/40 p-3">
                                        <p className="text-[11px] text-muted-foreground">Requests (1m / 5m)</p>
                                        <p className="text-sm font-semibold">
                                            {(liveSummary?.requestCount1m ?? 0)} / {(liveSummary?.requestCount5m ?? 0)}
                                        </p>
                                    </div>
                                    <div className="rounded-md border bg-secondary/40 p-3">
                                        <p className="text-[11px] text-muted-foreground">Error Rate (5m)</p>
                                        <p className={cn("text-sm font-semibold", (liveSummary?.errorRate5m ?? 0) >= 5 ? "text-red-500" : "text-emerald-500")}>
                                            {(liveSummary?.errorRate5m ?? 0).toFixed(2)}%
                                        </p>
                                    </div>
                                    <div className="rounded-md border bg-secondary/40 p-3">
                                        <p className="text-[11px] text-muted-foreground">Live Viewers (WS)</p>
                                        <p className="text-sm font-semibold">{liveSummary?.websocketSubscribers ?? 0}</p>
                                    </div>
                                </div>
                                <p className="mt-3 text-[11px] text-muted-foreground">
                                    Last seen: {liveSummary?.lastSeenAt ? new Date(liveSummary.lastSeenAt).toLocaleString() : "No requests yet"}
                                </p>
                            </CardContent>
                        </Card>

                        {/* Request History */}
                        <Card className="flex-1 flex flex-col min-h-0">
                            <CardHeader className="pb-3 shrink-0">
                                <div className="flex items-center justify-between">
                                    <CardTitle className="text-sm flex items-center gap-2 font-semibold">
                                        <Activity
                                            size={14}
                                            className="text-primary"
                                        />
                                        Request History
                                    </CardTitle>
                                    <div className="flex items-center gap-2">
                                        <div className="relative">
                                            <Search
                                                size={13}
                                                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                                            />
                                            <Input
                                                placeholder="Filter by path, method, IP…"
                                                className="pl-8 h-8 text-xs w-56"
                                                value={historyFilter}
                                                onChange={(e) =>
                                                    setHistoryFilter(e.target.value)
                                                }
                                            />
                                        </div>
                                    </div>
                                </div>
                            </CardHeader>
                            <div className="flex-1 overflow-auto">
                                {/* Table header */}
                                <div className="grid grid-cols-12 gap-2 px-5 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground border-b bg-muted/30 sticky top-0 z-10">
                                    <div className="col-span-2">Time</div>
                                    <div className="col-span-1">Method</div>
                                    <div className="col-span-4">Path</div>
                                    <div className="col-span-1">Status</div>
                                    <div className="col-span-2">Latency</div>
                                    <div className="col-span-2">IP</div>
                                </div>

                                {loadingHistory && history.length === 0 ? (
                                    <div className="flex items-center justify-center py-12 text-muted-foreground text-sm gap-2">
                                        <RefreshCw
                                            size={14}
                                            className="animate-spin"
                                        />
                                        Loading…
                                    </div>
                                ) : history.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                                        <Activity
                                            size={28}
                                            className="opacity-20 mb-2"
                                        />
                                        <p className="text-sm">
                                            No requests captured yet.
                                        </p>
                                        <p className="text-xs mt-1 opacity-60">
                                            Send a request to your mock URL to see
                                            it here.
                                        </p>
                                    </div>
                                ) : (
                                    history.map((req) => (
                                        <div
                                            key={req.id}
                                            className="grid grid-cols-12 gap-2 px-5 py-2.5 text-xs border-b border-border/30 hover:bg-accent/30 transition-colors cursor-pointer"
                                        >
                                            <div className="col-span-2 text-muted-foreground font-mono flex items-center gap-1">
                                                <Clock size={11} />
                                                {new Date(
                                                    req.timestamp
                                                ).toLocaleTimeString()}
                                            </div>
                                            <div className="col-span-1">
                                                <span
                                                    className={cn(
                                                        "text-[10px] font-bold px-1.5 py-0.5 rounded border",
                                                        getMethodColor(
                                                            req.method
                                                        )
                                                    )}
                                                >
                                                    {req.method}
                                                </span>
                                            </div>
                                            <div
                                                className="col-span-4 font-mono truncate"
                                                title={req.path}
                                            >
                                                {req.path}
                                            </div>
                                            <div
                                                className={cn(
                                                    "col-span-1 font-mono font-bold",
                                                    getStatusColor(
                                                        req.responseStatus
                                                    )
                                                )}
                                            >
                                                {req.responseStatus ?? "—"}
                                            </div>
                                            <div className="col-span-2 text-muted-foreground font-mono">
                                                {req.latencyMs != null
                                                    ? `${req.latencyMs}ms`
                                                    : "—"}
                                            </div>
                                            <div className="col-span-2 text-muted-foreground font-mono truncate">
                                                {req.ip ?? "—"}
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>

                            {/* Footer */}
                            <div className="shrink-0 flex items-center justify-between px-5 py-2 border-t text-[11px] text-muted-foreground">
                                <span>
                                    {history.length} of {historyTotal} requests
                                </span>
                                <span className="flex items-center gap-1.5">
                                    <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                                    Polled every 5s · 10 day retention
                                </span>
                            </div>
                        </Card>
                    </>
                ) : (
                    /* No endpoint selected */
                    <Card className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
                        <Globe size={40} className="opacity-15 mb-3" />
                        <h3 className="text-base font-semibold text-foreground">
                            Select an endpoint
                        </h3>
                        <p className="text-sm mt-1 max-w-sm text-center">
                            Pick an endpoint from the sidebar to view its mock URL,
                            stats, and a ready-to-run curl snippet. Create one first
                            if you haven't already.
                        </p>
                    </Card>
                )}
            </div>
        </div>
    );
}
