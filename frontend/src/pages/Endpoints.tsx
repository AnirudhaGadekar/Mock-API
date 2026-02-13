import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle
} from "@/components/ui/card";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
    createEndpoint,
    deleteEndpoint,
    fetchEndpoints,
    type Endpoint
} from "@/lib/api";
import { Activity, Calendar, Copy, ExternalLink, Globe, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "react-hot-toast";
import { useNavigate } from "react-router-dom";

export default function EndpointsPage() {
    const navigate = useNavigate();
    const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState("");
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [newEndpointName, setNewEndpointName] = useState("");
    const [creating, setCreating] = useState(false);

    useEffect(() => {
        loadEndpoints();
    }, []);

    const loadEndpoints = async () => {
        try {
            setLoading(true);
            const data = await fetchEndpoints();
            setEndpoints(data);
        } catch {
            toast.error("Failed to load endpoints");
        } finally {
            setLoading(false);
        }
    };

    const handleCreate = async () => {
        if (!newEndpointName.trim()) return;

        try {
            setCreating(true);
            await createEndpoint(newEndpointName);
            toast.success("Endpoint created!");
            setNewEndpointName("");
            setIsCreateOpen(false);
            loadEndpoints();
        } catch (err: any) {
            toast.error(err.response?.data?.error?.message || "Failed to create endpoint");
        } finally {
            setCreating(false);
        }
    };

    const handleDelete = async (id: string, name: string) => {
        if (!confirm(`Are you sure you want to delete ${name}? This action cannot be undone.`)) return;

        try {
            await deleteEndpoint(id);
            toast.success("Endpoint deleted");
            setEndpoints(prev => prev.filter(e => e.id !== id));
        } catch {
            toast.error("Failed to delete endpoint");
        }
    };

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        toast.success("Copied to clipboard");
    };

    const filteredEndpoints = endpoints.filter(ep =>
        ep.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        ep.subdomain.includes(searchTerm.toLowerCase())
    );

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight">Endpoints</h2>
                    <p className="text-muted-foreground">Manage your mock API endpoints and subdomains.</p>
                </div>
                <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                    <DialogTrigger asChild>
                        <Button>
                            <Plus className="mr-2 h-4 w-4" /> New Endpoint
                        </Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Create New Endpoint</DialogTitle>
                            <DialogDescription>
                                Choose a unique name for your endpoint. This will be your subdomain.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="grid gap-4 py-4">
                            <div className="grid gap-2">
                                <Input
                                    id="name"
                                    placeholder="e.g. my-awesome-api"
                                    value={newEndpointName}
                                    onChange={(e) => setNewEndpointName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                                    onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                                />
                                <p className="text-xs text-muted-foreground">
                                    Only lowercase letters, numbers, and hyphens allowed.
                                </p>
                            </div>
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
                            <Button onClick={handleCreate} disabled={!newEndpointName || creating}>
                                {creating ? "Creating..." : "Create Endpoint"}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>

            <div className="flex items-center space-x-2">
                <Input
                    placeholder="Filter endpoints..."
                    className="max-w-sm"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                />
            </div>

            {loading ? (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {[1, 2, 3].map((i) => (
                        <Card key={i} className="animate-pulse">
                            <CardHeader className="h-24 bg-muted/50" />
                            <CardContent className="h-24" />
                        </Card>
                    ))}
                </div>
            ) : filteredEndpoints.length === 0 ? (
                <div className="text-center py-12 border-2 border-dashed rounded-lg bg-card/50">
                    <Globe className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <h3 className="text-lg font-medium">No endpoints found</h3>
                    <p className="text-muted-foreground mb-4">
                        {searchTerm ? "Try adjusting your search terms" : "Get started by creating your first endpoint"}
                    </p>
                    {!searchTerm && (
                        <Button onClick={() => setIsCreateOpen(true)}>
                            <Plus className="mr-2 h-4 w-4" /> Create Endpoint
                        </Button>
                    )}
                </div>
            ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {filteredEndpoints.map((ep) => (
                        <Card key={ep.id} className="group relative overflow-hidden transition-all hover:shadow-md hover:border-primary/50">
                            <CardHeader className="pb-3">
                                <div className="flex items-start justify-between">
                                    <div className="space-y-1">
                                        <CardTitle className="text-base font-semibold flex items-center gap-2">
                                            <span className="truncate max-w-[200px]" title={ep.name}>{ep.name}</span>
                                        </CardTitle>
                                        <CardDescription className="font-mono text-xs truncate">
                                            {ep.subdomain}.mockurl.com
                                        </CardDescription>
                                    </div>
                                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                                            onClick={() => handleDelete(ep.id, ep.name)}
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between p-2 bg-secondary/50 rounded-md text-xs font-mono group-hover:bg-secondary transition-colors">
                                        <span className="truncate flex-1 text-muted-foreground select-all">
                                            {ep.url}
                                        </span>
                                        <div className="flex gap-1 ml-2">
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-6 w-6"
                                                onClick={() => copyToClipboard(ep.url)}
                                                title="Copy URL"
                                            >
                                                <Copy className="h-3 w-3" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-6 w-6"
                                                onClick={() => window.open(ep.url, '_blank')}
                                                title="Open in new tab"
                                            >
                                                <ExternalLink className="h-3 w-3" />
                                            </Button>
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-4">
                                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground" title="Total Requests">
                                                <Activity className="h-3.5 w-3.5" />
                                                <span>{ep.reqCount.toLocaleString()}</span>
                                            </div>
                                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground" title={`Created ${new Date(ep.createdAt).toLocaleDateString()}`}>
                                                <Calendar className="h-3.5 w-3.5" />
                                                <span>{new Date(ep.createdAt).toLocaleDateString()}</span>
                                            </div>
                                        </div>
                                        <Button
                                            size="sm"
                                            variant="secondary"
                                            className="h-8"
                                            onClick={() => navigate(`/endpoints/${ep.id}`)}
                                        >
                                            Configure
                                        </Button>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}
        </div>
    );
}
