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
    Trash2,
    User,
} from "lucide-react";
import { useState } from "react";
import { toast } from "react-hot-toast";

export default function SettingsPage() {
    const { user, apiKey, isAnonymous, logout, deactivateAccount, showAuthModal, loading } = useAuth();
    const [showKey, setShowKey] = useState(false);

    const copyApiKey = () => {
        if (!apiKey) return;
        navigator.clipboard.writeText(apiKey);
        toast.success("API key copied to clipboard");
    };

    const maskedKey = apiKey
        ? `${apiKey.slice(0, 8)}${"*".repeat(Math.max(0, apiKey.length - 12))}${apiKey.slice(-4)}`
        : "No key";

    const authProviderLabel =
        user?.authProvider === "ANONYMOUS"
            ? "Anonymous"
            : user?.authProvider === "LOCAL"
                ? "Email OTP"
                : user?.authProvider === "GOOGLE"
                    ? "Google"
                    : user?.authProvider === "GITHUB"
                        ? "GitHub"
                        : user?.authProvider || "Unknown";

    return (
        <div className="max-w-3xl space-y-6">
            <div className="space-y-2">
                <div className="auth-kicker w-fit">
                    <span className="h-2 w-2 rounded-full bg-primary" />
                    Workspace settings
                </div>
                <h2 className="text-3xl font-semibold">Manage your account and credentials</h2>
                <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
                    Control account access, inspect your API key, and jump to the operational tools that matter most.
                </p>
            </div>

            {isAnonymous && (
                <Card className="border-primary/25 bg-primary/10">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-primary">
                            <Shield size={18} />
                            Secure your work
                        </CardTitle>
                        <CardDescription>
                            You are currently using an anonymous session. Create an account to persist endpoints,
                            enable collaboration, and access your workspace from any device.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-3 sm:flex-row">
                        <Button onClick={() => showAuthModal("signup")} className="gap-2">
                            <LogIn size={16} />
                            Create account
                        </Button>
                        <Button variant="outline" onClick={() => showAuthModal("login")} className="gap-2">
                            Already have one? Sign in
                        </Button>
                    </CardContent>
                </Card>
            )}

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <User size={18} />
                        {isAnonymous ? "Session" : "Account"}
                    </CardTitle>
                    <CardDescription>
                        {isAnonymous ? "Current anonymous session details." : "Identity and authentication details for this workspace."}
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {loading ? (
                        <div className="space-y-3">
                            <div className="h-5 w-48 animate-pulse rounded-full bg-muted/40" />
                            <div className="h-5 w-64 animate-pulse rounded-full bg-muted/35" />
                        </div>
                    ) : user ? (
                        <div className="space-y-3">
                            {user.name && (
                                <div className="flex items-center justify-between gap-4">
                                    <span className="text-sm text-muted-foreground">Name</span>
                                    <span className="text-right text-sm font-medium">{user.name}</span>
                                </div>
                            )}
                            <div className="flex items-center justify-between gap-4">
                                <span className="text-sm text-muted-foreground">Email</span>
                                <span className="text-right text-sm">{user.email}</span>
                            </div>
                            <div className="flex items-center justify-between gap-4">
                                <span className="text-sm text-muted-foreground">Auth Provider</span>
                                <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary px-2.5 py-1 text-xs font-semibold">
                                    {authProviderLabel}
                                </span>
                            </div>
                            <div className="flex items-center justify-between gap-4">
                                <span className="text-sm text-muted-foreground">User ID</span>
                                <span className="select-all text-right font-mono text-xs text-foreground/80">{user.id}</span>
                            </div>
                        </div>
                    ) : (
                        <p className="text-sm text-muted-foreground">Unable to load session info.</p>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Key size={18} />
                        API Key
                    </CardTitle>
                    <CardDescription>
                        Use this key in the <code className="rounded bg-muted px-1 py-0.5 text-xs">X-API-Key</code> header for API access.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex flex-col gap-2 sm:flex-row">
                        <Input
                            readOnly
                            value={showKey ? apiKey || "" : maskedKey}
                            className="font-mono text-xs"
                        />
                        <div className="flex gap-2">
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
                    </div>
                    <p className="text-xs leading-6 text-muted-foreground">
                        This key is stored in a secure cookie for requests. {isAnonymous ? "Create an account to keep it attached to a persistent workspace." : ""}
                    </p>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Settings2 size={18} />
                        Quick Actions
                    </CardTitle>
                    <CardDescription>Jump to operational tools and account-level controls.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    <Button
                        variant="outline"
                        className="h-auto w-full justify-start gap-3 px-4 py-4"
                        onClick={() => window.open("/documentation", "_blank")}
                    >
                        <BookOpen size={16} className="text-primary" />
                        <div className="text-left">
                            <div className="text-sm font-medium">API Documentation</div>
                            <div className="text-xs text-muted-foreground">Open Swagger UI with every available endpoint.</div>
                        </div>
                        <ExternalLink size={14} className="ml-auto text-muted-foreground" />
                    </Button>

                    <div className="border-t border-border/70 pt-2">
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
                                    Clear session and reset
                                </Button>
                                <p className="mt-2 text-center text-[11px] text-muted-foreground">
                                    This removes your current API key and creates a fresh anonymous session.
                                </p>
                            </>
                        ) : (
                            <>
                                <Button variant="destructive" className="w-full gap-2" onClick={logout}>
                                    <LogOut size={16} />
                                    Sign out
                                </Button>
                                <p className="mt-2 text-center text-[11px] text-muted-foreground">
                                    Signing out will return this browser to an anonymous session.
                                </p>

                                <div className="mt-6 border-t border-border/70 pt-6">
                                    <h4 className="text-sm font-semibold text-destructive mb-2">Danger Zone</h4>
                                    <p className="text-xs text-muted-foreground mb-4">
                                        Deactivating your account immediately ends access to your workspaces and configurations. We retain limited account records where required for legal, security, and performance review purposes.
                                    </p>
                                    <Button 
                                        variant="outline" 
                                        className="w-full gap-2 border-destructive/30 text-destructive hover:bg-destructive hover:text-destructive-foreground"
                                        onClick={async () => {
                                            if (!confirm("Are you sure you want to deactivate your account? Access will end immediately and retained records may be kept for compliance and review.")) return;
                                            try {
                                                await deactivateAccount();
                                                toast.success("Account deactivated successfully.");
                                            } catch (err) {
                                                toast.error("Failed to deactivate account. Please try again.");
                                            }
                                        }}
                                    >
                                        <Trash2 size={16} />
                                        Deactivate account
                                    </Button>
                                </div>
                            </>
                        )}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
