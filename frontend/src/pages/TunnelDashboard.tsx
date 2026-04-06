import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { Globe, RefreshCw, Terminal, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

interface Tunnel {
    id: string;
    userId: string;
    targetUrl: string;
    createdAt: string;
    type: "HTTP" | "WEBSOCKET";
    publicUrl?: string;
}

export default function TunnelDashboard() {
    const [tunnels, setTunnels] = useState<Tunnel[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [tunnelHealth, setTunnelHealth] = useState<{ websocketConnected: boolean; activeWebsocketTunnels: number } | null>(null);

    const fetchTunnels = async () => {
        setLoading(true);
        try {
            const res = await api.get("/api/v2/tunnel");
            if (res.data.success) {
                setTunnels(res.data.tunnels);
                const healthRes = await api.get("/api/v2/tunnel/health");
                if (healthRes.data?.success) {
                    setTunnelHealth(healthRes.data.health);
                }
                setError(null);
            } else {
                setError(res.data.error?.message || "Failed to fetch tunnels");
            }
        } catch (err) {
            setError("Network error");
        } finally {
            setLoading(false);
        }
    };

    const deleteTunnel = async (id: string) => {
        if (!confirm("Are you sure you want to stop this tunnel?")) return;
        try {
            await api.delete(`/api/v2/tunnel/${id}`);
            fetchTunnels();
        } catch (err) {
            alert("Failed to delete tunnel");
        }
    };

    useEffect(() => {
        fetchTunnels();
        const interval = setInterval(fetchTunnels, 5000);
        return () => clearInterval(interval);
    }, []);

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div className="space-y-2">
                    <div className="auth-kicker w-fit">
                        <span className="h-2 w-2 rounded-full bg-primary" />
                        Connectivity
                    </div>
                    <h2 className="text-3xl font-semibold">Local tunnels</h2>
                    <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
                        Expose localhost services securely, validate tunnel health, and keep an eye on every public route from one place.
                    </p>
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                        <Badge variant={tunnelHealth?.websocketConnected ? "default" : "secondary"}>
                            {tunnelHealth?.websocketConnected ? "CLI tunnel connected" : "CLI tunnel disconnected"}
                        </Badge>
                        <span className="text-muted-foreground">
                            Active websocket tunnels: {tunnelHealth?.activeWebsocketTunnels ?? 0}
                        </span>
                    </div>
                </div>

                <Button onClick={fetchTunnels} variant="outline" size="sm">
                    <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                    Refresh
                </Button>
            </div>

            <div className="grid gap-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.3fr)]">
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Terminal className="h-5 w-5 text-primary" />
                            CLI quick start
                        </CardTitle>
                        <CardDescription>Install the tunnel CLI and expose a local service in seconds.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="surface-code rounded-[1.25rem] p-4 font-mono text-sm text-foreground">
                            <p className="text-muted-foreground"># Install the CLI</p>
                            <p>$ npm install -g @mockapi/tunnel</p>
                            <br />
                            <p className="text-muted-foreground"># Start a tunnel on port 3000</p>
                            <p>$ mockapi tunnel -p 3000</p>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Operational summary</CardTitle>
                        <CardDescription>Current tunnel footprint and websocket health at a glance.</CardDescription>
                    </CardHeader>
                    <CardContent className="grid gap-3 sm:grid-cols-3">
                        <div className="status-banner px-4 py-4">
                            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Tunnel count</div>
                            <div className="mt-2 text-2xl font-semibold">{tunnels.length}</div>
                        </div>
                        <div className="status-banner px-4 py-4">
                            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Websocket CLI</div>
                            <div className="mt-2 text-2xl font-semibold">
                                {tunnelHealth?.websocketConnected ? "Online" : "Idle"}
                            </div>
                        </div>
                        <div className="status-banner px-4 py-4">
                            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Public routes</div>
                            <div className="mt-2 text-2xl font-semibold">
                                {tunnels.filter((tunnel) => tunnel.type === "WEBSOCKET").length}
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Active tunnels</CardTitle>
                    <CardDescription>Live list of exposed local services and public tunnel URLs.</CardDescription>
                </CardHeader>
                <CardContent>
                    {error && (
                        <Alert variant="destructive" className="mb-4">
                            <AlertTitle>Error</AlertTitle>
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>
                    )}

                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Tunnel ID</TableHead>
                                <TableHead>Type</TableHead>
                                <TableHead>Target</TableHead>
                                <TableHead>Public URL</TableHead>
                                <TableHead>Created</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {tunnels.length === 0 && !loading && (
                                <TableRow>
                                    <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                                        No active tunnels found. Start one using the CLI quick start above.
                                    </TableCell>
                                </TableRow>
                            )}
                            {tunnels.map((tunnel) => (
                                <TableRow key={tunnel.id}>
                                    <TableCell className="font-mono font-medium">{tunnel.id}</TableCell>
                                    <TableCell>
                                        <Badge variant={tunnel.type === "WEBSOCKET" ? "default" : "secondary"}>
                                            {tunnel.type === "WEBSOCKET" ? "Live (CLI)" : "Static (HTTP)"}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="font-mono text-xs">{tunnel.targetUrl}</TableCell>
                                    <TableCell>
                                        <a
                                            href={`/tunnel/${tunnel.id}`}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="flex items-center gap-1 font-mono text-xs text-primary transition-colors hover:text-primary/80 hover:underline"
                                        >
                                            <Globe className="h-3 w-3" />
                                            {window.location.origin}/tunnel/{tunnel.id}
                                        </a>
                                    </TableCell>
                                    <TableCell className="text-xs text-muted-foreground">
                                        {new Date(tunnel.createdAt).toLocaleString()}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="text-destructive hover:text-destructive"
                                            onClick={() => deleteTunnel(tunnel.id)}
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    );
}
