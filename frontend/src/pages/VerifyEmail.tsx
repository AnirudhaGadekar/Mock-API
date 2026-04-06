import { Button } from "@/components/ui/button";
import { CheckCircle2, Loader2, ShieldAlert } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

export default function VerifyEmail() {
  const { verifyEmailToken } = useAuth();
  const [searchParams] = useSearchParams();
  const token = useMemo(() => searchParams.get("token") || "", [searchParams]);

  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("Verifying your email...");

  useEffect(() => {
    const run = async () => {
      if (!token) {
        setStatus("error");
        setMessage("Invalid verification link.");
        return;
      }
      try {
        await verifyEmailToken(token);
        setStatus("success");
        setMessage("Email verified successfully. You can now login.");
      } catch (err: any) {
        setStatus("error");
        setMessage(err?.response?.data?.error || "Verification failed. The link may be expired.");
      }
    };

    run();
  }, [token, verifyEmailToken]);

  const Icon = status === "loading" ? Loader2 : status === "success" ? CheckCircle2 : ShieldAlert;

  return (
    <div className="screen-center">
      <div className="screen-card space-y-6 text-center">
        <div
          className={[
            "mx-auto flex h-16 w-16 items-center justify-center rounded-[1.4rem] border shadow-soft",
            status === "success"
              ? "border-success/25 bg-success/12 text-success"
              : status === "error"
                ? "border-destructive/25 bg-destructive/12 text-destructive"
                : "border-primary/20 bg-primary/12 text-primary",
          ].join(" ")}
        >
          <Icon className={status === "loading" ? "h-8 w-8 animate-spin" : "h-8 w-8"} />
        </div>

        <div className="space-y-3">
          <div className="auth-kicker mx-auto w-fit">
            <span
              className={[
                "h-2 w-2 rounded-full",
                status === "success" ? "bg-success" : status === "error" ? "bg-destructive" : "bg-primary",
              ].join(" ")}
            />
            Email verification
          </div>
          <h1 className="text-3xl font-semibold">
            {status === "success" ? "Email verified" : status === "error" ? "Verification failed" : "Checking link"}
          </h1>
          <p className="text-sm leading-6 text-muted-foreground">{message}</p>
        </div>

        {status !== "loading" && (
          <Button asChild className="w-full">
            <Link to="/login">Go to login</Link>
          </Button>
        )}
      </div>
    </div>
  );
}
