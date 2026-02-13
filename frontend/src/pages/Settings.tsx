import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api, getApiKey, setApiKeyRef } from "@/lib/api";
import {
    BookOpen,
    Copy,
    ExternalLink,
    Eye,
    EyeOff,
    Key,
    LogOut,
    Settings2,
    User,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "react-hot-toast";

interface UserInfo {
    id: string;
    email: string;
    endpointCount?: number;
}

export default function SettingsPage() {
    const [user, setUser] = useState<UserInfo | null>(null);
    const [loading, setLoading] = useState(true);
    const [showKey, setShowKey] = useState(false);
    const apiKey = getApiKey();

    useEffect(() => {
        api.get('/api/v1/session/me')
            .then(res => {
                if (res.data.success) {
                    setUser(res.data.user);
                }
            })
            .catch(() => { })
            .finally(() => setLoading(false));
    }, []);

    const copyApiKey = () => {
        navigator.clipboard.writeText(apiKey);
        toast.success("API key copied to clipboard");
    };

    const handleLogout = () => {
        if (!confirm("This will clear your session. You'll get a new anonymous session on refresh. Continue?")) return;
        setApiKeyRef('');
        window.location.reload();
    };

    const maskedKey = apiKey
        ? apiKey.slice(0, 8) + "•".repeat(Math.max(0, apiKey.length - 12)) + apiKey.slice(-4)
        : "No key";

    return (
        <div className="space-y-6 max-w-2xl">
            <div>
                <h2 className="text-2xl font-bold tracking-tight">Settings</h2>
                <p className="text-muted-foreground">Manage your session and API credentials.</p>
            </div>

            {/* Session Info */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <User size={18} />
                        Session
                    </CardTitle>
                    <CardDescription>Your current anonymous session details</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {loading ? (
                        <div className="space-y-3">
                            <div className="h-5 w-48 bg-muted/30 rounded animate-pulse" />
                            <div className="h-5 w-64 bg-muted/30 rounded animate-pulse" />
                        </div>
                    ) : user ? (
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <span className="text-sm text-muted-foreground">User ID</span>
                                <span className="font-mono text-xs text-foreground/80 select-all">{user.id}</span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-sm text-muted-foreground">Email</span>
                                <span className="text-sm">{user.email}</span>
                            </div>
                            {user.endpointCount !== undefined && (
                                <div className="flex items-center justify-between">
                                    <span className="text-sm text-muted-foreground">Endpoints</span>
                                    <span className="text-sm font-medium">{user.endpointCount}</span>
                                </div>
                            )}
                        </div>
                    ) : (
                        <p className="text-sm text-muted-foreground">Unable to load session info.</p>
                    )}
                </CardContent>
            </Card>

            {/* API Key */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Key size={18} />
                        API Key
                    </CardTitle>
                    <CardDescription>
                        Use this key in the <code className="text-xs bg-muted px-1 py-0.5 rounded">X-API-Key</code> header for API access
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex items-center gap-2">
                        <Input
                            readOnly
                            value={showKey ? apiKey : maskedKey}
                            className="font-mono text-xs"
                        />
                        <Button
                            variant="outline"
                            size="icon"
                            onClick={() => setShowKey(!showKey)}
                            title={showKey ? "Hide" : "Show"}
                        >
                            {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                        </Button>
                        <Button
                            variant="outline"
                            size="icon"
                            onClick={copyApiKey}
                            title="Copy"
                        >
                            <Copy size={16} />
                        </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                        This key is stored in your browser's localStorage. Clearing site data will destroy your session.
                    </p>
                </CardContent>
            </Card>

            {/* Quick Actions */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Settings2 size={18} />
                        Quick Actions
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                    <Button
                        variant="outline"
                        className="w-full justify-start gap-3"
                        onClick={() => window.open('/documentation', '_blank')}
                    >
                        <BookOpen size={16} className="text-sky-400" />
                        <div className="text-left">
                            <div className="text-sm font-medium">API Documentation</div>
                            <div className="text-xs text-muted-foreground">Swagger UI with all available endpoints</div>
                        </div>
                        <ExternalLink size={14} className="ml-auto text-muted-foreground" />
                    </Button>

                    <div className="pt-2 border-t">
                        <Button
                            variant="destructive"
                            className="w-full"
                            onClick={handleLogout}
                        >
                            <LogOut size={16} />
                            Clear Session &amp; Reset
                        </Button>
                        <p className="text-[11px] text-muted-foreground text-center mt-2">
                            This will remove your API key from this browser. A new anonymous session will be created on refresh.
                        </p>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
