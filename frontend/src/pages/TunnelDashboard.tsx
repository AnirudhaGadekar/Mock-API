
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { Globe, RefreshCw, Terminal, Trash2 } from "lucide-react";
import { useEffect, useState } from 'react';

interface Tunnel {
    id: string;
    userId: string;
    targetUrl: string;
    createdAt: string;
    type: 'HTTP' | 'WEBSOCKET';
    publicUrl?: string; // constructed client-side or returned
}

export default function TunnelDashboard() {
    const [tunnels, setTunnels] = useState<Tunnel[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [tunnelHealth, setTunnelHealth] = useState<{ websocketConnected: boolean; activeWebsocketTunnels: number } | null>(null);

    const fetchTunnels = async () => {
        setLoading(true);
        try {
            const res = await api.get('/api/v2/tunnel');
            if (res.data.success) {
                setTunnels(res.data.tunnels);
                const healthRes = await api.get('/api/v2/tunnel/health');
                if (healthRes.data?.success) {
                    setTunnelHealth(healthRes.data.health);
                }
            } else {
                setError(res.data.error?.message || 'Failed to fetch tunnels');
            }
        } catch (err) {
            setError('Network error');
        } finally {
            setLoading(false);
        }
    };

    const deleteTunnel = async (id: string) => {
        if (!confirm('Are you sure you want to stop this tunnel?')) return;
        try {
            await api.delete(`/api/v2/tunnel/${id}`);
            fetchTunnels();
        } catch (err) {
            alert('Failed to delete tunnel');
        }
    };

    useEffect(() => {
        fetchTunnels();
        const interval = setInterval(fetchTunnels, 5000); // Poll every 5s for live status
        return () => clearInterval(interval);
    }, []);

    return (
        <div className="container mx-auto p-6 space-y-8">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Local Tunnels</h1>
                    <p className="text-muted-foreground mt-2">Expose your localhost services to the internet securely.</p>
                    <div className="mt-2 flex items-center gap-2 text-xs">
                        <Badge variant={tunnelHealth?.websocketConnected ? "default" : "secondary"}>
                            {tunnelHealth?.websocketConnected ? "CLI Tunnel Connected" : "CLI Tunnel Disconnected"}
                        </Badge>
                        <span className="text-muted-foreground">
                            Active WS tunnels: {tunnelHealth?.activeWebsocketTunnels ?? 0}
                        </span>
                    </div>
                </div>
                <Button onClick={fetchTunnels} variant="outline" size="sm">
                    <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                    Refresh
                </Button>
            </div>

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                <Card className="bg-slate-50 border-slate-200">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2"><Terminal className="h-5 w-5" /> CLI Quick Start</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="bg-slate-900 text-slate-50 p-4 rounded-md font-mono text-sm overflow-x-auto">
                            <p className="text-slate-400"># Install the CLI</p>
                            <p>$ npm install -g @mockapi/tunnel</p>
                            <br />
                            <p className="text-slate-400"># Start a tunnel (port 3000)</p>
                            <p>$ mockapi tunnel -p 3000</p>
                        </div>
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Active Tunnels</CardTitle>
                    <CardDescription>Live list of your exposed endpoints.</CardDescription>
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
                                    <TableCell colSpan={6} className="text-center h-24 text-muted-foreground">
                                        No active tunnels found. Start one using the CLI!
                                    </TableCell>
                                </TableRow>
                            )}
                            {tunnels.map((tunnel) => (
                                <TableRow key={tunnel.id}>
                                    <TableCell className="font-medium font-mono">{tunnel.id}</TableCell>
                                    <TableCell>
                                        <Badge variant={tunnel.type === 'WEBSOCKET' ? 'default' : 'secondary'}>
                                            {tunnel.type === 'WEBSOCKET' ? 'Live (CLI)' : 'Static (HTTP)'}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="font-mono text-xs">{tunnel.targetUrl}</TableCell>
                                    <TableCell>
                                        <a
                                            href={`/tunnel/${tunnel.id}`}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="flex items-center gap-1 text-blue-600 hover:underline font-mono text-xs"
                                        >
                                            <Globe className="h-3 w-3" />
                                            {window.location.origin}/tunnel/{tunnel.id}
                                        </a>
                                    </TableCell>
                                    <TableCell className="text-muted-foreground text-xs">
                                        {new Date(tunnel.createdAt).toLocaleString()}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="text-red-500 hover:text-red-700 hover:bg-red-50"
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

