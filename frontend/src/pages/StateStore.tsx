import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { deleteStateValue, fetchEndpoints, fetchStateKeys, fetchStateValue, setStateValue, type Endpoint } from "@/lib/api";
import { Braces, Code2, Database, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "react-hot-toast";

export default function StateStore() {
    const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
    const [selectedEndpoint, setSelectedEndpoint] = useState<Endpoint | null>(null);
    const [keys, setKeys] = useState<string[]>([]);
    const [selectedKey, setSelectedKey] = useState<string | null>(null);
    const [selectedValue, setSelectedValue] = useState<any>(null);
    const [newKey, setNewKey] = useState("");
    const [newValue, setNewValue] = useState("");
    const [loading, setLoading] = useState(false);
    const [search, setSearch] = useState("");

    useEffect(() => {
        loadEndpoints();
    }, []);

    const loadEndpoints = async () => {
        try {
            const data = await fetchEndpoints();
            setEndpoints(data);
            if (data.length > 0 && !selectedEndpoint) {
                setSelectedEndpoint(data[0]);
                loadKeys(data[0].id);
            }
        } catch (error) {
            toast.error("Failed to load endpoints");
        }
    };

    const loadKeys = async (endpointId: string) => {
        setLoading(true);
        try {
            const data = await fetchStateKeys(endpointId);
            setKeys(data);
            setSelectedKey(null);
            setSelectedValue(null);
        } catch (error) {
            toast.error("Failed to load state keys");
        } finally {
            setLoading(false);
        }
    };

    const loadValue = async (key: string) => {
        if (!selectedEndpoint) return;
        try {
            const value = await fetchStateValue(selectedEndpoint.id, key);
            setSelectedKey(key);
            setSelectedValue(value);
        } catch (error) {
            toast.error("Failed to fetch value");
        }
    };

    const handleCreate = async () => {
        if (!selectedEndpoint || !newKey) return;
        try {
            let parsedValue: any = newValue;
            try {
                parsedValue = JSON.parse(newValue);
            } catch {
                // use as string if not valid JSON
            }
            await setStateValue(selectedEndpoint.id, newKey, parsedValue);
            toast.success("State key created");
            setNewKey("");
            setNewValue("");
            loadKeys(selectedEndpoint.id);
        } catch (error) {
            toast.error("Failed to create state key");
        }
    };

    const handleDelete = async (key: string) => {
        if (!selectedEndpoint) return;
        try {
            await deleteStateValue(selectedEndpoint.id, key);
            toast.success("State key deleted");
            if (selectedKey === key) {
                setSelectedKey(null);
                setSelectedValue(null);
            }
            loadKeys(selectedEndpoint.id);
        } catch (error) {
            toast.error("Failed to delete key");
        }
    };

    const filteredKeys = keys.filter(k => k.toLowerCase().includes(search.toLowerCase()));

    return (
        <div className="p-6 max-w-7xl mx-auto space-y-8 animate-in fade-in duration-500">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border pb-6">
                <div>
                    <h1 className="gradient-text text-3xl font-bold">State Store</h1>
                    <p className="text-muted-foreground mt-1">
                        Stateful mocking engine. Store, retrieve, and modify JSON data per endpoint via API or control panel.
                    </p>
                </div>

                <select
                    className="min-w-[220px] rounded-2xl border border-input/80 bg-background/75 px-4 py-3 text-sm shadow-[inset_0_1px_0_hsl(var(--background)/0.35)] focus:border-primary/45 focus:outline-none focus:ring-4 focus:ring-ring/15"
                    value={selectedEndpoint?.id || ""}
                    onChange={(e) => {
                        const ep = endpoints.find(x => x.id === e.target.value);
                        if (ep) {
                            setSelectedEndpoint(ep);
                            loadKeys(ep.id);
                        }
                    }}
                >
                    {endpoints.map(ep => (
                        <option key={ep.id} value={ep.id}>{ep.name}</option>
                    ))}
                </select>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Left Column: Keys List */}
                <div className="lg:col-span-4 space-y-4">
                    <Card className="flex flex-col h-[600px]">
                        <CardHeader className="flex-shrink-0">
                            <div className="flex items-center justify-between">
                                <CardTitle className="text-sm font-medium flex items-center gap-2">
                                    <Database className="w-4 h-4 text-primary" />
                                    State Keys
                                </CardTitle>
                                <div className="text-xs text-muted-foreground">{keys.length} total</div>
                            </div>
                            <div className="relative mt-4">
                                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                                <Input
                                    placeholder="Search keys..."
                                    className="pl-8"
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                />
                            </div>
                        </CardHeader>
                        <CardContent className="flex-grow overflow-y-auto pt-0">
                            {loading ? (
                                <div className="flex justify-center p-8"><RefreshCwIcon className="animate-spin h-6 w-6 text-muted-foreground" /></div>
                            ) : filteredKeys.length > 0 ? (
                                <div className="space-y-1">
                                    {filteredKeys.map(key => (
                                        <div
                                            key={key}
                                            onClick={() => loadValue(key)}
                                            className={`group flex cursor-pointer items-center justify-between rounded-xl border p-2 transition-colors ${
                                                selectedKey === key
                                                    ? "border-primary/20 bg-primary/12 text-foreground shadow-soft"
                                                    : "border-transparent hover:bg-muted/70"
                                                }`}
                                        >
                                            <div className="flex items-center gap-2 overflow-hidden">
                                                <Code2 className={`w-3.5 h-3.5 ${selectedKey === key ? 'text-primary' : 'text-muted-foreground'}`} />
                                                <span className="text-sm font-mono truncate">{key}</span>
                                            </div>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); handleDelete(key); }}
                                                className="opacity-0 group-hover:opacity-100 p-1 hover:bg-destructive/10 text-destructive rounded transition-all"
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                                    <GhostIcon className="w-8 h-8 mb-2 opacity-20" />
                                    <p className="text-sm">No keys found</p>
                                </div>
                            )}
                        </CardContent>
                        <div className="p-4 border-t border-border mt-auto flex flex-col gap-2 bg-muted/30">
                            <h4 className="text-xs font-semibold text-muted-foreground uppercase flex items-center gap-2">
                                <Plus className="w-3 h-3" /> Add New Key
                            </h4>
                            <div className="space-y-2">
                                <Input
                                    placeholder="Key (e.g. user_session)"
                                    className="h-8 text-xs font-mono"
                                    value={newKey}
                                    onChange={(e) => setNewKey(e.target.value)}
                                />
                                <Input
                                    placeholder="Value (string or JSON)"
                                    className="h-8 text-xs font-mono"
                                    value={newValue}
                                    onChange={(e) => setNewValue(e.target.value)}
                                />
                                <Button
                                    size="sm"
                                    className="w-full h-8 text-xs"
                                    onClick={handleCreate}
                                    disabled={!newKey}
                                >
                                    Create Key
                                </Button>
                            </div>
                        </div>
                    </Card>
                </div>

                {/* Right Column: Value Editor */}
                <div className="lg:col-span-8">
                    {selectedKey ? (
                        <Card className="h-[600px] flex flex-col border-primary/20">
                            <CardHeader className="border-b border-border bg-primary/5">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <CardTitle className="flex items-center gap-2 text-primary">
                                            <Code2 className="w-5 h-5" />
                                            {selectedKey}
                                        </CardTitle>
                                        <CardDescription>View and edit value. Changes take effect instantly.</CardDescription>
                                    </div>
                                    <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => loadValue(selectedKey)}>
                                        <RefreshCw className="w-4 h-4 mr-2" /> Refresh
                                    </Button>
                                </div>
                            </CardHeader>
                            <CardContent className="flex-grow overflow-hidden p-0 relative">
                                <div className="absolute inset-0 flex flex-col">
                                    <div className="flex items-center gap-2 px-4 py-2 bg-muted/50 border-b border-border text-[10px] font-mono text-muted-foreground">
                                        <Braces className="w-3 h-3 text-primary" />
                                        APPLICATION/JSON
                                    </div>
                                    <textarea
                                        className="w-full flex-grow bg-background p-6 font-mono text-sm resize-none focus:outline-none focus:ring-4 focus:ring-ring/15"
                                        value={JSON.stringify(selectedValue, null, 4)}
                                        onChange={(e) => {
                                            try {
                                                const parsed = JSON.parse(e.target.value);
                                                setSelectedValue(parsed);
                                                // Throttle or allow explicit save? 
                                                // For now we just update local state.
                                            } catch {
                                                // invalid json while typing
                                            }
                                        }}
                                        onBlur={async (e) => {
                                            if (!selectedEndpoint || !selectedKey) return;
                                            try {
                                                const val = JSON.parse(e.target.value);
                                                await setStateValue(selectedEndpoint.id, selectedKey, val);
                                                toast.success("Key updated");
                                            } catch {
                                                toast.error("Invalid JSON format");
                                            }
                                        }}
                                    />
                                </div>
                            </CardContent>
                        </Card>
                    ) : (
                        <Card className="h-[600px] flex items-center justify-center border-dashed">
                            <div className="text-center space-y-4 max-w-sm px-4">
                                <div className="bg-muted w-16 h-16 rounded-full flex items-center justify-center mx-auto">
                                    <Search className="w-8 h-8 text-muted-foreground" />
                                </div>
                                <CardTitle>Select a key to view</CardTitle>
                                <CardDescription>
                                    State store entries are available in your mock response templates via the <code>{"{{state 'key'}}"}</code> helper.
                                </CardDescription>
                                <Button variant="outline" onClick={() => loadKeys(selectedEndpoint?.id || "")}>
                                    Browse Keys
                                </Button>
                            </div>
                        </Card>
                    )}
                </div>
            </div>
        </div>
    );
}

function RefreshCwIcon(props: any) {
    return <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" /><path d="M16 16h5v5" /></svg>
}

function GhostIcon(props: any) {
    return <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 10h.01" /><path d="M15 10h.01" /><path d="M12 2a8 8 0 0 0-8 8v12l3-3 2.5 2.5L12 19l2.5 2.5L17 19l3 3V10a8 8 0 0 0-8-8z" /></svg>
}
