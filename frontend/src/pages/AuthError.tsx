import { Button } from "@/components/ui/button";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";

/**
 * AuthError - shown when OAuth fails.
 * The backend redirects here with ?message=...
 */
export default function AuthError() {
    const navigate = useNavigate();
    const [params] = useSearchParams();
    const message = params.get("message") ?? "Authentication failed. Please try again.";

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
                    <h1 className="text-3xl font-semibold">Login failed</h1>
                    <p className="mx-auto max-w-md text-sm leading-6 text-muted-foreground">
                        {message}
                    </p>
                </div>

                <Button className="w-full" onClick={() => navigate("/", { replace: true })}>
                    <ArrowLeft className="h-4 w-4" />
                    Back to home
                </Button>
            </div>
        </div>
    );
}
