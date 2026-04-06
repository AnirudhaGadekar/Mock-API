/**
 * AuthCallback - OAuth redirect landing page.
 * After Google/GitHub OAuth, the backend sets the cookie and
 * redirects here. We call refreshUser() and bounce to home.
 */
import { Button } from "@/components/ui/button";
import { AlertTriangle, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

export default function AuthCallback() {
    const { refreshUser } = useAuth();
    const navigate = useNavigate();
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const finish = async () => {
            try {
                const user = await refreshUser({ throwOnError: true, retries: 5, retryDelayMs: 400 });
                if (!user || user.isAnonymous) {
                    throw new Error("Session cookie not established after OAuth callback");
                }
                navigate("/", { replace: true });
            } catch (err) {
                console.error("OAuth callback error", err);
                setError("Failed to complete login. Please try again.");
            }
        };
        finish();
    }, []);

    if (error) {
        return (
            <div className="screen-center">
                <div className="screen-card space-y-6 text-center">
                    <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[1.4rem] border border-destructive/25 bg-destructive/12 text-destructive shadow-soft">
                        <AlertTriangle className="h-8 w-8" />
                    </div>
                    <div className="space-y-3">
                        <div className="auth-kicker mx-auto w-fit">
                            <span className="h-2 w-2 rounded-full bg-destructive" />
                            OAuth callback
                        </div>
                        <h1 className="text-3xl font-semibold">Unable to complete sign-in</h1>
                        <p className="text-sm leading-6 text-muted-foreground">{error}</p>
                    </div>
                    <Button variant="outline" className="w-full" onClick={() => navigate("/", { replace: true })}>
                        Back to home
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className="screen-center">
            <div className="screen-card space-y-6 text-center">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[1.4rem] border border-primary/20 bg-primary/12 text-primary shadow-soft">
                    <Loader2 className="h-8 w-8 animate-spin" />
                </div>
                <div className="space-y-3">
                    <div className="auth-kicker mx-auto w-fit">
                        <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
                        OAuth callback
                    </div>
                    <h1 className="text-3xl font-semibold">Signing you in...</h1>
                    <p className="text-sm leading-6 text-muted-foreground">
                        Finalizing your session and restoring your workspace context.
                    </p>
                </div>
            </div>
        </div>
    );
}
