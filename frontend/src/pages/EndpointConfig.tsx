import { ChaosPanel } from "@/components/ChaosPanel";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
    deleteEndpoint,
    fetchEndpoint,
    updateEndpoint,
    type EndpointDetail
} from "@/lib/api";
import {
    ArrowLeft,
    ChevronRight,
    Clock,
    Code,
    Plus,
    RefreshCw,
    Save,
    Settings,
    Trash2,
    Zap
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "react-hot-toast";
import { useNavigate, useParams } from "react-router-dom";

interface Rule {
    path: string;
    method: string;
    response: {
        status: number;
        body: any;
        headers?: Record<string, string>;
        delay?: number;
    };
}

export default function EndpointConfigPage() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const [endpoint, setEndpoint] = useState<EndpointDetail | null>(null);
    const [rules, setRules] = useState<Rule[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (id) loadEndpoint();
    }, [id]);

    const loadEndpoint = async () => {
        try {
            setLoading(true);
            const data = await fetchEndpoint(id!);
            setEndpoint(data);
            setRules((data.rules as Rule[]) || []);
        } catch {
            toast.error("Failed to load endpoint details");
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        try {
            setSaving(true);
            await updateEndpoint(id!, { rules });
            toast.success("Configuration saved!");
        } catch (err: any) {
            toast.error(err.response?.data?.error?.message || "Failed to save configuration");
        } finally {
            setSaving(false);
        }
    };

    const addRule = () => {
        const newRule: Rule = {
            path: "/new-route",
            method: "GET",
            response: {
                status: 200,
                body: { message: "Success" },
                headers: { "Content-Type": "application/json" }
            }
        };
        setRules([...rules, newRule]);
    };

    const updateRule = (index: number, patch: Partial<Rule>) => {
        const updated = [...rules];
        updated[index] = { ...updated[index], ...patch };
        setRules(updated);
    };

    const updateResponse = (index: number, patch: Partial<Rule['response']>) => {
        const updated = [...rules];
        updated[index] = {
            ...updated[index],
            response: { ...updated[index].response, ...patch }
        };
        setRules(updated);
    };

    const deleteRule = (index: number) => {
        setRules(rules.filter((_, i) => i !== index));
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <RefreshCw className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    if (!endpoint) {
        return (
            <div className="text-center py-12">
                <h3 className="text-lg font-medium">Endpoint not found</h3>
                <Button variant="link" onClick={() => navigate('/endpoints')}>Back to Endpoints</Button>
            </div>
        );
    }

    return (
        <div className="space-y-6 max-w-5xl mx-auto">
            <div className="flex items-center justify-between pb-2 border-b">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" size="icon" onClick={() => navigate('/endpoints')}>
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                    <div>
                        <h2 className="text-2xl font-bold tracking-tight">{endpoint.name}</h2>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <span className="font-mono">{endpoint.subdomain}.mockurl.com</span>
                            <ChevronRight className="h-3 w-3" />
                            <span>Configuration</span>
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" onClick={loadEndpoint} disabled={saving}>
                        <RefreshCw className={`mr-2 h-4 w-4 ${saving ? 'animate-spin' : ''}`} />
                        Refresh
                    </Button>
                    <Button onClick={handleSave} disabled={saving}>
                        <Save className="mr-2 h-4 w-4" />
                        {saving ? "Saving..." : "Save Configuration"}
                    </Button>
                </div>
            </div>

            <Tabs defaultValue="rules" className="w-full">
                <TabsList className="grid w-full max-w-[600px] grid-cols-3">
                    <TabsTrigger value="rules" className="flex items-center gap-2">
                        <Code className="h-4 w-4" /> Mock Rules
                    </TabsTrigger>
                    <TabsTrigger value="settings" className="flex items-center gap-2">
                        <Settings className="h-4 w-4" /> Settings
                    </TabsTrigger>
                    <TabsTrigger value="chaos" className="flex items-center gap-2">
                        <Zap className="h-4 w-4 text-orange-500" /> Chaos
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="rules" className="space-y-4 pt-4">
                    <div className="flex items-center justify-between">
                        <h3 className="text-lg font-medium">Matching Rules</h3>
                        <Button size="sm" onClick={addRule}>
                            <Plus className="mr-2 h-4 w-4" /> Add Rule
                        </Button>
                    </div>

                    {rules.length === 0 ? (
                        <Card className="border-dashed">
                            <CardContent className="flex flex-col items-center justify-center py-12">
                                <Code className="h-10 w-10 text-muted-foreground mb-4" />
                                <p className="text-muted-foreground">No custom rules defined. Showing default response.</p>
                                <Button variant="outline" className="mt-4" onClick={addRule}>
                                    Create First Rule
                                </Button>
                            </CardContent>
                        </Card>
                    ) : (
                        rules.map((rule, idx) => (
                            <Card key={idx} className="overflow-hidden border-l-4 border-l-primary/50 hover:border-l-primary transition-all">
                                <CardHeader className="bg-muted/30 pb-4">
                                    <div className="flex items-center gap-4">
                                        <div className="flex-1 grid grid-cols-12 gap-3">
                                            <div className="col-span-3">
                                                <Select
                                                    value={rule.method}
                                                    onValueChange={(v) => updateRule(idx, { method: v })}
                                                >
                                                    <SelectTrigger>
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"].map(m => (
                                                            <SelectItem key={m} value={m}>{m}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <div className="col-span-9">
                                                <Input
                                                    placeholder="/api/v1/resource"
                                                    value={rule.path}
                                                    onChange={(e) => updateRule(idx, { path: e.target.value })}
                                                    className="font-mono"
                                                />
                                            </div>
                                        </div>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="text-destructive hover:bg-destructive/10"
                                            onClick={() => deleteRule(idx)}
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </CardHeader>
                                <CardContent className="pt-6 space-y-4">
                                    <div className="grid grid-cols-2 gap-6">
                                        <div className="space-y-4">
                                            <div className="space-y-2">
                                                <Label>HTTP Status Code</Label>
                                                <Select
                                                    value={String(rule.response.status)}
                                                    onValueChange={(v) => updateResponse(idx, { status: parseInt(v) })}
                                                >
                                                    <SelectTrigger>
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {[200, 201, 204, 400, 401, 403, 404, 429, 500, 502, 503].map(s => (
                                                            <SelectItem key={s} value={String(s)}>{s}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <div className="space-y-2">
                                                <Label className="flex items-center gap-2">
                                                    <Clock className="h-3.5 w-3.5" /> Delay (ms)
                                                </Label>
                                                <Input
                                                    type="number"
                                                    placeholder="0"
                                                    value={rule.response.delay || 0}
                                                    onChange={(e) => updateResponse(idx, { delay: parseInt(e.target.value) || 0 })}
                                                />
                                            </div>
                                        </div>
                                        <div className="space-y-4">
                                            <div className="space-y-2">
                                                <Label>Response Body (JSON)</Label>
                                                <Textarea
                                                    className="font-mono text-xs min-h-[120px]"
                                                    value={typeof rule.response.body === 'string' ? rule.response.body : JSON.stringify(rule.response.body, null, 2)}
                                                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
                                                        try {
                                                            const obj = JSON.parse(e.target.value);
                                                            updateResponse(idx, { body: obj });
                                                        } catch {
                                                            updateResponse(idx, { body: e.target.value });
                                                        }
                                                    }}
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <Label>Custom Response Headers (JSON)</Label>
                                        <Textarea
                                            className="font-mono text-xs min-h-[80px]"
                                            placeholder='{ "X-Custom": "Value" }'
                                            value={JSON.stringify(rule.response.headers || {}, null, 2)}
                                            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
                                                try {
                                                    const obj = JSON.parse(e.target.value);
                                                    updateResponse(idx, { headers: obj });
                                                } catch {
                                                    // ignore invalid json during typing
                                                }
                                            }}
                                        />
                                    </div>
                                </CardContent>
                            </Card>
                        ))
                    )}
                </TabsContent>

                <TabsContent value="settings" className="pt-4">
                    <Card>
                        <CardHeader>
                            <CardTitle>Endpoint Settings</CardTitle>
                            <CardDescription>General configuration for this mock subdomain.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-2">
                                <Label>Display Name</Label>
                                <Input value={endpoint.name} disabled className="bg-muted text-muted-foreground" />
                                <p className="text-xs text-muted-foreground">Endpoint name cannot be changed once created.</p>
                            </div>

                            <div className="pt-4 border-t">
                                <h4 className="text-sm font-medium mb-2 text-destructive">Danger Zone</h4>
                                <p className="text-sm text-muted-foreground mb-4">Deleting this endpoint will remove all rules and history. This cannot be undone.</p>
                                <Button
                                    variant="destructive"
                                    size="sm"
                                    onClick={async () => {
                                        if (confirm(`Are you sure you want to delete ${endpoint.name}?`)) {
                                            try {
                                                await deleteEndpoint(id!);
                                                toast.success("Endpoint deleted");
                                                navigate('/endpoints');
                                            } catch {
                                                toast.error("Failed to delete endpoint");
                                            }
                                        }
                                    }}
                                >
                                    Delete Endpoint
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="chaos" className="pt-4">
                    <ChaosPanel endpointId={id!} />
                </TabsContent>
            </Tabs>
        </div>
    );
}
