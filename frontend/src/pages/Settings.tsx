import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import {
    BookOpen,
    Copy,
    ExternalLink,
    Eye,
    EyeOff,
    Key,
    LogIn,
    LogOut,
    RefreshCw,
    Settings2,
    Shield,
    User,
} from "lucide-react";
import { useState } from "react";
import { toast } from "react-hot-toast";

export default function SettingsPage() {
    const { user, apiKey, isAnonymous, logout, showAuthModal, loading } = useAuth();
    const [showKey, setShowKey] = useState(false);

    const copyApiKey = () => {
        if (!apiKey) return;
        navigator.clipboard.writeText(apiKey);
        toast.success("API key copied to clipboard");
    };

    const maskedKey = apiKey
        ? apiKey.slice(0, 8) + "•".repeat(Math.max(0, apiKey.length - 12)) + apiKey.slice(-4)
        : "No key";

    return (
        <div className="space-y-6 max-w-2xl">
            <div>
                <h2 className="text-2xl font-bold tracking-tight">Settings</h2>
                <p className="text-muted-foreground">Manage your account and API credentials.</p>
            </div>

            {/* Anonymous Upgrade CTA */}
            {isAnonymous && (
                <Card className="border-indigo-500/30 bg-indigo-500/5">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-indigo-400">
                            <Shield size={18} />
                            Secure Your Work
                        </CardTitle>
                        <CardDescription>
                            You're using an anonymous session. Sign up to persist your endpoints, enable team collaboration, and access your data from any device.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="flex gap-3">
                        <Button
                            onClick={() => showAuthModal('signup')}
                            className="gap-2"
                        >
                            <LogIn size={16} />
                            Create Account
                        </Button>
                        <Button
                            variant="outline"
                            onClick={() => showAuthModal('login')}
                            className="gap-2"
                        >
                            Already have one? Sign In
                        </Button>
                    </CardContent>
                </Card>
            )}

            {/* Account Info */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <User size={18} />
                        {isAnonymous ? "Session" : "Account"}
                    </CardTitle>
                    <CardDescription>
                        {isAnonymous
                            ? "Your current anonymous session details"
                            : "Your account details"
                        }
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {loading ? (
                        <div className="space-y-3">
                            <div className="h-5 w-48 bg-muted/30 rounded animate-pulse" />
                            <div className="h-5 w-64 bg-muted/30 rounded animate-pulse" />
                        </div>
                    ) : user ? (
                        <div className="space-y-3">
                            {user.name && (
                                <div className="flex items-center justify-between">
                                    <span className="text-sm text-muted-foreground">Name</span>
                                    <span className="text-sm font-medium">{user.name}</span>
                                </div>
                            )}
                            <div className="flex items-center justify-between">
                                <span className="text-sm text-muted-foreground">Email</span>
                                <span className="text-sm">{user.email}</span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-sm text-muted-foreground">Auth Provider</span>
                                <span className="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full bg-secondary border border-border">
                                    {user.authProvider === 'ANONYMOUS' ? '🔓 Anonymous' :
                                        user.authProvider === 'LOCAL' ? '📧 Email' :
                                            user.authProvider === 'GOOGLE' ? '🔵 Google' :
                                                user.authProvider === 'GITHUB' ? '⚫ GitHub' :
                                                    user.authProvider || 'Unknown'}
                                </span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-sm text-muted-foreground">User ID</span>
                                <span className="font-mono text-xs text-foreground/80 select-all">{user.id}</span>
                            </div>
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
                            value={showKey ? (apiKey || '') : maskedKey}
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
                        This key is stored in your browser's localStorage. {isAnonymous ? "Sign up to secure it." : ""}
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
                        {isAnonymous ? (
                            <>
                                <Button
                                    variant="destructive"
                                    className="w-full gap-2"
                                    onClick={() => {
                                        if (!confirm("This will clear your session. You'll get a new anonymous session. Continue?")) return;
                                        logout();
                                    }}
                                >
                                    <RefreshCw size={16} />
                                    Clear Session & Reset
                                </Button>
                                <p className="text-[11px] text-muted-foreground text-center mt-2">
                                    This will remove your API key and create a fresh anonymous session.
                                </p>
                            </>
                        ) : (
                            <>
                                <Button
                                    variant="destructive"
                                    className="w-full gap-2"
                                    onClick={logout}
                                >
                                    <LogOut size={16} />
                                    Sign Out
                                </Button>
                                <p className="text-[11px] text-muted-foreground text-center mt-2">
                                    You'll be signed out and reverted to an anonymous session.
                                </p>
                            </>
                        )}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
