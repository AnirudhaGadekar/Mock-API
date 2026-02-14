import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { fetchChaosConfig, fetchEndpoints, updateChaosConfig, type ChaosConfig, type Endpoint } from "@/lib/api";
import { AlertCircle, AlertTriangle, Clock, Ghost, RefreshCw, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "react-hot-toast";

export default function Chaos() {
    const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
    const [selectedEndpoint, setSelectedEndpoint] = useState<Endpoint | null>(null);
    const [chaosConfig, setChaosConfig] = useState<ChaosConfig | null>(null);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        loadEndpoints();
    }, []);

    const loadEndpoints = async () => {
        try {
            const data = await fetchEndpoints();
            setEndpoints(data);
            if (data.length > 0 && !selectedEndpoint) {
                setSelectedEndpoint(data[0]);
                loadChaosConfig(data[0].id);
            }
        } catch (error) {
            toast.error("Failed to load endpoints");
        }
    };

    const loadChaosConfig = async (endpointId: string) => {
        setLoading(true);
        try {
            const config = await fetchChaosConfig(endpointId);
            setChaosConfig(config || { enabled: false });
        } catch (error) {
            toast.error("Failed to load chaos config");
        } finally {
            setLoading(false);
        }
    };

    const handleUpdate = async (patch: Partial<ChaosConfig>) => {
        if (!selectedEndpoint || !chaosConfig) return;

        setSaving(true);
        try {
            const updated = await updateChaosConfig(selectedEndpoint.id, patch);
            setChaosConfig(updated);
            toast.success("Chaos configuration updated");
        } catch (error) {
            toast.error("Failed to update chaos configuration");
        } finally {
            setSaving(false);
        }
    };

    const toggleChaos = () => {
        if (!chaosConfig) return;
        handleUpdate({ enabled: !chaosConfig.enabled });
    };

    return (
        <div className="p-6 max-w-7xl mx-auto space-y-8 animate-in fade-in duration-500">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border pb-6">
                <div>
                    <h1 className="text-3xl font-bold bg-gradient-to-r from-orange-400 to-red-500 bg-clip-text text-transparent">
                        Chaos Engineering
                    </h1>
                    <p className="text-muted-foreground mt-1">
                        Simulate network issues and server errors to test system resilience.
                    </p>
                </div>

                <div className="flex items-center gap-3">
                    <select
                        className="bg-background border border-input h-10 px-3 rounded-md min-w-[200px]"
                        value={selectedEndpoint?.id || ""}
                        onChange={(e) => {
                            const ep = endpoints.find(x => x.id === e.target.value);
                            if (ep) {
                                setSelectedEndpoint(ep);
                                loadChaosConfig(ep.id);
                            }
                        }}
                    >
                        {endpoints.map(ep => (
                            <option key={ep.id} value={ep.id}>{ep.name}</option>
                        ))}
                    </select>
                    <Button
                        variant={chaosConfig?.enabled ? "destructive" : "secondary"}
                        onClick={toggleChaos}
                        disabled={!chaosConfig || saving}
                        className="min-w-[120px]"
                    >
                        {chaosConfig?.enabled ? (
                            <><Ghost className="w-4 h-4 mr-2 animate-pulse" /> Stop Chaos</>
                        ) : (
                            <><Zap className="w-4 h-4 mr-2" /> Start Chaos</>
                        )}
                    </Button>
                </div>
            </div>

            {!chaosConfig?.enabled && (
                <div className="bg-orange-500/10 border border-orange-500/20 p-4 rounded-lg flex items-center gap-3 text-orange-200">
                    <AlertTriangle className="w-5 h-5 flex-shrink-0" />
                    <p className="text-sm">Chaos is currently disabled for this endpoint. Rules below will not be applied.</p>
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {/* Latency Rule */}
                <Card className="border-border hover:border-orange-500/50 transition-colors group">
                    <CardHeader>
                        <div className="flex items-center justify-between">
                            <div className="bg-orange-500/20 p-2 rounded-lg group-hover:scale-110 transition-transform">
                                <Clock className="w-5 h-5 text-orange-400" />
                            </div>
                            <Badge variant={chaosConfig?.delay ? "default" : "secondary"}>
                                {chaosConfig?.delay ? "Active" : "Inactive"}
                            </Badge>
                        </div>
                        <CardTitle className="mt-4">Network Latency</CardTitle>
                        <CardDescription aria-multiline>
                            Inject random delays into requests to simulate slow network or stressed downstream services.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-xs font-medium text-muted-foreground uppercase">Min Delay (ms)</label>
                                <Input
                                    type="number"
                                    defaultValue={chaosConfig?.delay?.min || 0}
                                    onBlur={(e) => {
                                        const val = parseInt(e.target.value);
                                        if (!isNaN(val)) handleUpdate({ delay: { min: val, max: chaosConfig?.delay?.max || val + 100 } });
                                    }}
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-medium text-muted-foreground uppercase">Max Delay (ms)</label>
                                <Input
                                    type="number"
                                    defaultValue={chaosConfig?.delay?.max || 0}
                                    onBlur={(e) => {
                                        const val = parseInt(e.target.value);
                                        if (!isNaN(val)) handleUpdate({ delay: { min: chaosConfig?.delay?.min || 0, max: val } });
                                    }}
                                />
                            </div>
                        </div>
                        <Button
                            variant="outline"
                            className="w-full text-xs"
                            onClick={() => handleUpdate({ delay: undefined })}
                            disabled={!chaosConfig?.delay}
                        >
                            Clear Latency Rule
                        </Button>
                    </CardContent>
                </Card>

                {/* Error Injection */}
                <Card className="border-border hover:border-red-500/50 transition-colors group">
                    <CardHeader>
                        <div className="flex items-center justify-between">
                            <div className="bg-red-500/20 p-2 rounded-lg group-hover:scale-110 transition-transform">
                                <AlertCircle className="w-5 h-5 text-red-400" />
                            </div>
                            <Badge variant={chaosConfig?.errorInject ? "destructive" : "secondary"}>
                                {chaosConfig?.errorInject ? "Active" : "Inactive"}
                            </Badge>
                        </div>
                        <CardTitle className="mt-4">Error Injection</CardTitle>
                        <CardDescription>
                            Randomly fail requests with specific HTTP status codes to test your error handling.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-xs font-medium text-muted-foreground uppercase">Probability (0-1)</label>
                                <Input
                                    type="number"
                                    step="0.1"
                                    min="0"
                                    max="1"
                                    defaultValue={chaosConfig?.errorInject?.probability || 0}
                                    onBlur={(e) => {
                                        const val = parseFloat(e.target.value);
                                        if (!isNaN(val)) handleUpdate({ errorInject: { ...chaosConfig?.errorInject, probability: val, status: chaosConfig?.errorInject?.status || 500 } });
                                    }}
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-medium text-muted-foreground uppercase">Status Code</label>
                                <Input
                                    type="number"
                                    defaultValue={chaosConfig?.errorInject?.status || 500}
                                    onBlur={(e) => {
                                        const val = parseInt(e.target.value);
                                        if (!isNaN(val)) handleUpdate({ errorInject: { ...chaosConfig?.errorInject, probability: chaosConfig?.errorInject?.probability || 0.1, status: val } });
                                    }}
                                />
                            </div>
                        </div>
                        <Button
                            variant="outline"
                            className="w-full text-xs"
                            onClick={() => handleUpdate({ errorInject: undefined })}
                            disabled={!chaosConfig?.errorInject}
                        >
                            Clear Error Rule
                        </Button>
                    </CardContent>
                </Card>

                {/* Rate Limiting */}
                <Card className="border-border hover:border-blue-500/50 transition-colors group">
                    <CardHeader>
                        <div className="flex items-center justify-between">
                            <div className="bg-blue-500/20 p-2 rounded-lg group-hover:scale-110 transition-transform">
                                <Zap className="w-5 h-5 text-blue-400" />
                            </div>
                            <Badge variant={chaosConfig?.rateLimit ? "default" : "secondary"}>
                                {chaosConfig?.rateLimit ? "Active" : "Inactive"}
                            </Badge>
                        </div>
                        <CardTitle className="mt-4">Dynamic Rate Limiting</CardTitle>
                        <CardDescription>
                            Enforce strict usage limits to simulate quota exhaustion or noisy neighbors.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <label className="text-xs font-medium text-muted-foreground uppercase">Requests Per Minute (RPM)</label>
                            <div className="flex gap-2">
                                <Input
                                    type="number"
                                    defaultValue={chaosConfig?.rateLimit?.rpm || 60}
                                    onBlur={(e) => {
                                        const val = parseInt(e.target.value);
                                        if (!isNaN(val)) handleUpdate({ rateLimit: { rpm: val, perIp: true } });
                                    }}
                                />
                            </div>
                        </div>
                        <Button
                            variant="outline"
                            className="w-full text-xs"
                            onClick={() => handleUpdate({ rateLimit: undefined })}
                            disabled={!chaosConfig?.rateLimit}
                        >
                            Clear Rate Limit
                        </Button>
                    </CardContent>
                </Card>
            </div>

            <div className="bg-card border border-border rounded-xl p-6 overflow-hidden">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold flex items-center gap-2">
                        <RefreshCw className={`w-4 h-4 ${(saving || loading) ? 'animate-spin' : ''}`} />
                        Active Configuration JSON
                    </h3>
                </div>
                <pre className="bg-background/50 p-4 rounded-lg text-sm font-mono overflow-auto max-h-[200px] text-muted-foreground">
                    {JSON.stringify(chaosConfig, null, 2)}
                </pre>
            </div>
        </div>
    );
}
