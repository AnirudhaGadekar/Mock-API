import { AIRuleGenerator } from "@/components/AIRuleGenerator";
import { ChaosPanel } from "@/components/ChaosPanel";
import { HeaderRewritingList } from "@/components/HeaderRewritingList";
import { InspectorPanel } from "@/components/InspectorPanel";
import { KeyValueList } from "@/components/KeyValueList";
import { TemplateHelper } from "@/components/TemplateHelper";
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
import { UpstreamList } from "@/components/UpstreamList";
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
    Filter,
    Plus,
    RefreshCw,
    Save,
    Search,
    Settings,
    Sparkles,
    Trash2,
    Zap
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "react-hot-toast";
import { useLocation, useNavigate, useParams } from "react-router-dom";

interface Rule {
    path: string;
    method: string;
    response: {
        status: number;
        body: any;
        headers?: Record<string, string>;
        headerRewriting?: any[];
        delay?: number;
    };
    condition?: {
        queryParams?: Record<string, string>;
        headers?: Record<string, string>;
        bodyContains?: string;
        jwtValidation?: {
            header?: string;
            secret: string;
            issuer?: string;
            audience?: string;
            required?: boolean;
        };
    };
}

export default function EndpointConfigPage() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const [endpoint, setEndpoint] = useState<EndpointDetail | null>(null);
    const [rules, setRules] = useState<Rule[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [showAI, setShowAI] = useState(false);

    const location = useLocation();

    useEffect(() => {
        if (id) loadEndpoint();
    }, [id]);

    useEffect(() => {
        if (location.state?.initialRule) {
            const rule = location.state.initialRule as Rule;
            // Check if rule already exists to avoid duplicate on refresh/re-render
            setRules(prev => {
                const exists = prev.some(r => r.path === rule.path && r.method === rule.method);
                if (exists) return prev;
                return [rule, ...prev];
            });
            toast.success("Magic Mock: Rule added! Review and save.");
            // Clear state so it doesn't re-add on navigation back
            window.history.replaceState({}, document.title);
        }
    }, [location.state]);

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
            await updateEndpoint(id!, {
                rules,
                settings: endpoint?.settings
            });
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
            },
            condition: {
                queryParams: {},
                headers: {}
            }
        };
        setRules([...rules, newRule]);
    };

    const updateRule = (index: number, patch: Partial<Rule>) => {
        const updated = [...rules];
        updated[index] = { ...updated[index], ...patch };
        setRules(updated);
    };

    const updateCondition = (index: number, patch: Partial<Rule['condition']>) => {
        const updated = [...rules];
        updated[index] = {
            ...updated[index],
            condition: { ...(updated[index].condition || {}), ...patch }
        };
        setRules(updated);
    }

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

    const insertTemplateVar = (index: number, text: string) => {
        const rule = rules[index];
        const currentBody = typeof rule.response.body === 'string'
            ? rule.response.body
            : JSON.stringify(rule.response.body, null, 2);

        // Simple append for now
        updateResponse(index, { body: currentBody + text });
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
                        <RefreshCw className={`mr - 2 h - 4 w - 4 ${saving ? 'animate-spin' : ''} `} />
                        Refresh
                    </Button>
                    <Button onClick={handleSave} disabled={saving}>
                        <Save className="mr-2 h-4 w-4" />
                        {saving ? "Saving..." : "Save Configuration"}
                    </Button>
                </div>
            </div>

            <Tabs defaultValue="rules" className="w-full">
                <TabsList className="grid w-full max-w-[600px] grid-cols-4">
                    <TabsTrigger value="rules" className="flex items-center gap-2">
                        <Code className="h-4 w-4" /> Mock Rules
                    </TabsTrigger>
                    <TabsTrigger value="settings" className="flex items-center gap-2">
                        <Settings className="h-4 w-4" /> Settings
                    </TabsTrigger>
                    <TabsTrigger value="chaos" className="flex items-center gap-2">
                        <Zap className="h-4 w-4 text-orange-500" /> Chaos
                    </TabsTrigger>
                    <TabsTrigger value="inspector" className="flex items-center gap-2">
                        <Search className="h-4 w-4 text-blue-500" /> Inspector
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="rules" className="space-y-4 pt-4">
                    <div className="flex items-center justify-between">
                        <h3 className="text-lg font-medium">Matching Rules</h3>
                        <div className="flex gap-2">
                            <Button variant="outline" onClick={() => setShowAI(!showAI)}>
                                <Sparkles className="mr-2 h-4 w-4" />
                                {showAI ? 'Hide AI' : 'Generate with AI'}
                            </Button>
                            <Button size="sm" onClick={addRule}>
                                <Plus className="mr-2 h-4 w-4" /> Add Rule
                            </Button>
                        </div>
                    </div>

                    {showAI && (
                        <AIRuleGenerator
                            endpointId={id!}
                            onRuleGenerated={(rule) => {
                                setRules([...rules, rule]);
                                setShowAI(false);
                                toast.success("Rule added via AI!");
                            }}
                        />
                    )}

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
                                <CardContent className="pt-6 space-y-6">
                                    {/* Advanced Matching */}
                                    <div className="space-y-3">
                                        <div className="flex items-center gap-2">
                                            <Filter className="h-4 w-4 text-muted-foreground" />
                                            <Label className="text-sm font-semibold">Match Conditions (Optional)</Label>
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-muted/20 p-4 rounded-md">
                                            <div>
                                                <Label className="text-xs mb-2 block text-muted-foreground">Required Headers</Label>
                                                <KeyValueList
                                                    items={rule.condition?.headers || {}}
                                                    onChange={(headers) => updateCondition(idx, { headers })}
                                                    keyPlaceholder="X-Api-Key"
                                                    valuePlaceholder="secret-123"
                                                    addButtonText="Add Header Match"
                                                />
                                            </div>
                                            <div>
                                                <Label className="text-xs mb-2 block text-muted-foreground">Required Query Params</Label>
                                                <KeyValueList
                                                    items={rule.condition?.queryParams || {}}
                                                    onChange={(queryParams) => updateCondition(idx, { queryParams })}
                                                    keyPlaceholder="type"
                                                    valuePlaceholder="admin"
                                                    addButtonText="Add Query Match"
                                                />
                                            </div>
                                        </div>
                                        <div>
                                            <Label className="text-xs mb-1 block text-muted-foreground">Body Contains (Substring Match)</Label>
                                            <Input
                                                className="font-mono text-xs"
                                                placeholder="substring to match in body..."
                                                value={rule.condition?.bodyContains || ''}
                                                onChange={(e) => updateCondition(idx, { bodyContains: e.target.value })}
                                            />
                                        </div>

                                        <div className="border-t pt-3 mt-1">
                                            <div className="flex items-center justify-between mb-2">
                                                <Label className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                                                    <Zap className="h-3 w-3 text-yellow-500" /> JWT Validation Mock
                                                </Label>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-6 px-2 text-[10px]"
                                                    onClick={() => {
                                                        const current = rule.condition?.jwtValidation;
                                                        updateCondition(idx, {
                                                            jwtValidation: current ? undefined : { secret: "", required: true }
                                                        });
                                                    }}
                                                >
                                                    {rule.condition?.jwtValidation ? "Disable JWT Validation" : "Enable JWT Validation"}
                                                </Button>
                                            </div>

                                            {rule.condition?.jwtValidation && (
                                                <div className="grid grid-cols-2 gap-3 bg-primary/5 p-3 rounded border border-primary/10">
                                                    <div className="space-y-1.5">
                                                        <Label className="text-[10px]">Secret Key (Required)</Label>
                                                        <Input
                                                            className="h-7 text-xs font-mono"
                                                            placeholder="your-jwt-secret"
                                                            value={rule.condition.jwtValidation.secret}
                                                            onChange={(e) => updateCondition(idx, {
                                                                jwtValidation: { ...rule.condition!.jwtValidation!, secret: e.target.value }
                                                            })}
                                                        />
                                                    </div>
                                                    <div className="space-y-1.5">
                                                        <Label className="text-[10px]">Header (Default: Authorization)</Label>
                                                        <Input
                                                            className="h-7 text-xs font-mono"
                                                            placeholder="Authorization"
                                                            value={rule.condition.jwtValidation.header || ''}
                                                            onChange={(e) => updateCondition(idx, {
                                                                jwtValidation: { ...rule.condition!.jwtValidation!, header: e.target.value }
                                                            })}
                                                        />
                                                    </div>
                                                    <div className="space-y-1.5">
                                                        <Label className="text-[10px]">Expected Issuer (Optional)</Label>
                                                        <Input
                                                            className="h-7 text-xs font-mono"
                                                            placeholder="https://auth.com"
                                                            value={rule.condition.jwtValidation.issuer || ''}
                                                            onChange={(e) => updateCondition(idx, {
                                                                jwtValidation: { ...rule.condition!.jwtValidation!, issuer: e.target.value }
                                                            })}
                                                        />
                                                    </div>
                                                    <div className="space-y-1.5">
                                                        <Label className="text-[10px]">Expected Audience (Optional)</Label>
                                                        <Input
                                                            className="h-7 text-xs font-mono"
                                                            placeholder="my-app-id"
                                                            value={rule.condition.jwtValidation.audience || ''}
                                                            onChange={(e) => updateCondition(idx, {
                                                                jwtValidation: { ...rule.condition!.jwtValidation!, audience: e.target.value }
                                                            })}
                                                        />
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    <div className="h-px bg-border" />

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
                                                        {[200, 201, 204, 400, 401, 403, 404, 422, 429, 500, 502, 503].map(s => (
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
                                            <div className="space-y-2">
                                                <Label>Custom Response Headers</Label>
                                                <KeyValueList
                                                    items={rule.response.headers || {}}
                                                    onChange={(headers) => updateResponse(idx, { headers })}
                                                    keyPlaceholder="Content-Type"
                                                    valuePlaceholder="application/json"
                                                    addButtonText="Add Response Header"
                                                />
                                            </div>
                                            <div className="space-y-2 border-t pt-4">
                                                <Label className="text-xs font-semibold flex items-center gap-1.5">
                                                    <RefreshCw className="h-3 w-3" /> Header Rewriting Rules
                                                </Label>
                                                <HeaderRewritingList
                                                    rules={rule.response.headerRewriting || []}
                                                    onChange={(rules) => updateResponse(idx, { headerRewriting: rules })}
                                                />
                                                <p className="text-[10px] text-muted-foreground">
                                                    Manipulate headers before sending. Supports templates like {"{{req.path}}"}.
                                                </p>
                                            </div>
                                        </div>
                                        <div className="space-y-4">
                                            <div className="space-y-2">
                                                <div className="flex items-center justify-between">
                                                    <Label>Response Body (JSON)</Label>
                                                    <TemplateHelper onInsert={(text) => insertTemplateVar(idx, text)} />
                                                </div>
                                                <Textarea
                                                    className="font-mono text-xs min-h-[250px]"
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
                                                <p className="text-[10px] text-muted-foreground">
                                                    Supports standard Handlebars logic ({"{{#if}}"}, {"{{#each}}"}),
                                                    Faker.js ({"{{faker.name.firstName}}"}),
                                                    and Request Reflection ({"{{req.query.id}}"}).
                                                </p>
                                            </div>
                                        </div>
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

                            <div className="space-y-2 pt-4 border-t">
                                <Label>Fallback / Proxy URL</Label>
                                <div className="flex gap-2">
                                    <Input
                                        placeholder="https://api.example.com"
                                        value={endpoint.settings?.targetUrl || ''}
                                        onChange={(e) => setEndpoint({
                                            ...endpoint,
                                            settings: { ...endpoint.settings, targetUrl: e.target.value }
                                        })}
                                    />
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    Requests that don't match any mock rule will be forwarded to this URL.
                                </p>
                            </div>

                            <div className="space-y-2 pt-4 border-t">
                                <Label>Upstream Chain (Daisy-Chaining)</Label>
                                <UpstreamList
                                    upstreams={endpoint.settings?.upstreams || []}
                                    onChange={(upstreams) => setEndpoint({
                                        ...endpoint,
                                        settings: { ...endpoint.settings, upstreams }
                                    })}
                                />
                                <p className="text-xs text-muted-foreground">
                                    Chain multiple proxy servers. The last one will forward to the Final Target URL.
                                    Injects `X-Mock-Trace-ID` for tracking.
                                </p>
                            </div>

                            <div className="space-y-2 pt-4 border-t">
                                <Label>Global Header Rewriting</Label>
                                <HeaderRewritingList
                                    rules={endpoint.settings?.globalHeaderRewriting || []}
                                    onChange={(rules) => setEndpoint({
                                        ...endpoint,
                                        settings: { ...endpoint.settings, globalHeaderRewriting: rules }
                                    })}
                                    addButtonText="Add Global Rewrite Rule"
                                />
                                <p className="text-xs text-muted-foreground">
                                    Applied to ALL responses (mocks and proxies).
                                </p>
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

                <TabsContent value="inspector" className="pt-4">
                    <InspectorPanel endpointId={id!} />
                </TabsContent>
            </Tabs>
        </div>
    );
}
