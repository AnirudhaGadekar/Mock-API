import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { fetchChaosConfig, updateChaosConfig, type ChaosConfig } from "@/lib/api";
import { AlertCircle, AlertTriangle, Clock, Ghost, RefreshCw, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "react-hot-toast";

interface ChaosPanelProps {
    endpointId: string;
}

export function ChaosPanel({ endpointId }: ChaosPanelProps) {
    const [chaosConfig, setChaosConfig] = useState<ChaosConfig | null>(null);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        loadChaosConfig();
    }, [endpointId]);

    const loadChaosConfig = async () => {
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
        if (!chaosConfig) return;

        setSaving(true);
        try {
            const updated = await updateChaosConfig(endpointId, patch);
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

    if (loading && !chaosConfig) {
        return (
            <div className="flex items-center justify-center p-12">
                <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            <div className="flex items-center justify-between border-b pb-4">
                <div>
                    <h3 className="text-lg font-medium">Chaos Configuration</h3>
                    <p className="text-sm text-muted-foreground">
                        Simulate network faults and errors for this endpoint.
                    </p>
                </div>
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

            {!chaosConfig?.enabled && (
                <div className="bg-orange-500/10 border border-orange-500/20 p-4 rounded-lg flex items-center gap-3 text-orange-200">
                    <AlertTriangle className="w-5 h-5 flex-shrink-0" />
                    <p className="text-sm">Chaos is currently disabled. Rules below will not be applied.</p>
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Latency Rule */}
                <Card className="border-border hover:border-orange-500/50 transition-colors group">
                    <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                            <div className="bg-orange-500/20 p-2 rounded-lg group-hover:scale-110 transition-transform">
                                <Clock className="w-4 h-4 text-orange-400" />
                            </div>
                            <Badge variant={chaosConfig?.delay ? "outline" : "secondary"} className={chaosConfig?.delay ? "border-orange-500 text-orange-500" : ""}>
                                {chaosConfig?.delay ? "Active" : "Inactive"}
                            </Badge>
                        </div>
                        <CardTitle className="mt-2 text-base">Network Latency</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-1">
                                <label className="text-[10px] font-medium text-muted-foreground uppercase">Min (ms)</label>
                                <Input
                                    type="number"
                                    className="h-8"
                                    defaultValue={chaosConfig?.delay?.min || 0}
                                    onBlur={(e) => {
                                        const val = parseInt(e.target.value);
                                        if (!isNaN(val)) handleUpdate({ delay: { min: val, max: chaosConfig?.delay?.max || val + 100 } });
                                    }}
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="text-[10px] font-medium text-muted-foreground uppercase">Max (ms)</label>
                                <Input
                                    type="number"
                                    className="h-8"
                                    defaultValue={chaosConfig?.delay?.max || 0}
                                    onBlur={(e) => {
                                        const val = parseInt(e.target.value);
                                        if (!isNaN(val)) handleUpdate({ delay: { min: chaosConfig?.delay?.min || 0, max: val } });
                                    }}
                                />
                            </div>
                        </div>
                        <Button
                            variant="ghost"
                            size="sm"
                            className="w-full text-xs h-7"
                            onClick={() => handleUpdate({ delay: undefined })}
                            disabled={!chaosConfig?.delay}
                        >
                            Clear Rule
                        </Button>
                    </CardContent>
                </Card>

                {/* Error Injection */}
                <Card className="border-border hover:border-red-500/50 transition-colors group">
                    <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                            <div className="bg-red-500/20 p-2 rounded-lg group-hover:scale-110 transition-transform">
                                <AlertCircle className="w-4 h-4 text-red-400" />
                            </div>
                            <Badge variant={chaosConfig?.errorInject ? "outline" : "secondary"} className={chaosConfig?.errorInject ? "border-red-500 text-red-500" : ""}>
                                {chaosConfig?.errorInject ? "Active" : "Inactive"}
                            </Badge>
                        </div>
                        <CardTitle className="mt-2 text-base">Error Injection</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-1">
                                <label className="text-[10px] font-medium text-muted-foreground uppercase">Prob (0-1)</label>
                                <Input
                                    type="number"
                                    step="0.1"
                                    min="0"
                                    max="1"
                                    className="h-8"
                                    defaultValue={chaosConfig?.errorInject?.probability || 0}
                                    onBlur={(e) => {
                                        const val = parseFloat(e.target.value);
                                        if (!isNaN(val)) handleUpdate({ errorInject: { ...chaosConfig?.errorInject, probability: val, status: chaosConfig?.errorInject?.status || 500 } });
                                    }}
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="text-[10px] font-medium text-muted-foreground uppercase">Status</label>
                                <Input
                                    type="number"
                                    className="h-8"
                                    defaultValue={chaosConfig?.errorInject?.status || 500}
                                    onBlur={(e) => {
                                        const val = parseInt(e.target.value);
                                        if (!isNaN(val)) handleUpdate({ errorInject: { ...chaosConfig?.errorInject, probability: chaosConfig?.errorInject?.probability || 0.1, status: val } });
                                    }}
                                />
                            </div>
                        </div>
                        <Button
                            variant="ghost"
                            size="sm"
                            className="w-full text-xs h-7"
                            onClick={() => handleUpdate({ errorInject: undefined })}
                            disabled={!chaosConfig?.errorInject}
                        >
                            Clear Rule
                        </Button>
                    </CardContent>
                </Card>

                {/* Rate Limiting */}
                <Card className="border-border hover:border-blue-500/50 transition-colors group md:col-span-2">
                    <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                            <div className="bg-blue-500/20 p-2 rounded-lg group-hover:scale-110 transition-transform">
                                <Zap className="w-4 h-4 text-blue-400" />
                            </div>
                            <Badge variant={chaosConfig?.rateLimit ? "outline" : "secondary"} className={chaosConfig?.rateLimit ? "border-blue-500 text-blue-500" : ""}>
                                {chaosConfig?.rateLimit ? "Active" : "Inactive"}
                            </Badge>
                        </div>
                        <CardTitle className="mt-2 text-base">Rate Limiting</CardTitle>
                        <CardDescription>Simulate throttling by limiting requests per minute.</CardDescription>
                    </CardHeader>
                    <CardContent className="flex items-end gap-4">
                        <div className="space-y-1 flex-1">
                            <label className="text-[10px] font-medium text-muted-foreground uppercase">Requests Per Minute (RPM)</label>
                            <Input
                                type="number"
                                className="h-8"
                                defaultValue={chaosConfig?.rateLimit?.rpm || 60}
                                onBlur={(e) => {
                                    const val = parseInt(e.target.value);
                                    if (!isNaN(val)) handleUpdate({ rateLimit: { rpm: val, perIp: true } });
                                }}
                            />
                        </div>
                        <Button
                            variant="ghost"
                            size="sm"
                            className="text-xs h-8"
                            onClick={() => handleUpdate({ rateLimit: undefined })}
                            disabled={!chaosConfig?.rateLimit}
                        >
                            Clear Rate Limit
                        </Button>
                    </CardContent>
                </Card>
            </div>

            <div className="bg-card border border-border rounded-lg p-4 overflow-hidden">
                <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xs font-semibold flex items-center gap-2 text-muted-foreground">
                        <RefreshCw className={`w-3 h-3 ${(saving || loading) ? 'animate-spin' : ''}`} />
                        Active Config JSON
                    </h3>
                </div>
                <pre className="bg-background/50 p-2 rounded text-[10px] font-mono overflow-auto max-h-[100px] text-muted-foreground">
                    {JSON.stringify(chaosConfig, null, 2)}
                </pre>
            </div>
        </div>
    );
}
