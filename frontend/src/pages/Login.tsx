import { AuthShell } from "@/components/auth/AuthShell";
import { getAuthErrorMessage } from "@/lib/auth-errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { API_BASE_URL } from "@/lib/api";
import {
  ArrowLeft,
  Clock3,
  Github,
  Loader2,
  Mail,
  Network,
  ShieldCheck
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

const authFeatures = [
  {
    icon: ShieldCheck,
    title: "Passwordless sign-in",
    description: "Use one-time email codes instead of passwords, secrets, or reset flows.",
  },
  {
    icon: Network,
    title: "Instant workspace recovery",
    description: "Reconnect to your endpoints, traffic history, and team context from any browser.",
  },
  {
    icon: Clock3,
    title: "Fast session setup",
    description: "Most teams are back in their mock environment in under a minute.",
  },
];

const authMetrics = [
  { label: "Session", value: "OTP" },
  { label: "Delivery", value: "60s" },
  { label: "Mode", value: "Secure" },
];

export default function Login() {
  const { sendOtp, verifyOtp, user, apiKey } = useAuth();
  const navigate = useNavigate();
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [countdown, setCountdown] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleOAuth = (provider: "google" | "github") => {
    const oauthUrl = new URL(`${API_BASE_URL}/api/v2/oauth/${provider}`);
    if (apiKey) {
      oauthUrl.searchParams.append("conversionToken", apiKey);
    }
    window.location.href = oauthUrl.toString();
  };

  const clearCountdown = () => {
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    setCountdown(0);
  };

  const startCountdown = (seconds = 60) => {
    clearCountdown();
    setCountdown(seconds);
    countdownRef.current = setInterval(() => {
      setCountdown((value) => {
        if (value <= 1) {
          clearCountdown();
          return 0;
        }
        return value - 1;
      });
    }, 1000);
  };

  useEffect(() => () => clearCountdown(), []);

  useEffect(() => {
    if (user && !user.isAnonymous) {
      navigate("/");
    }
  }, [navigate, user]);

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      const result = await sendOtp(email);
      setNotice(result.message || "We sent a 6-digit login code to your email.");
      setStep("code");
      startCountdown(60);
    } catch (err: any) {
      setError(getAuthErrorMessage(err, "Failed to send code"));
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await verifyOtp(email, otp);
      navigate("/");
    } catch (err: any) {
      setError(getAuthErrorMessage(err, "Invalid or expired code"));
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (countdown > 0) {
      return;
    }

    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      const result = await sendOtp(email);
      setNotice(result.message || "A fresh code has been sent to your email.");
      startCountdown(60);
    } catch (err: any) {
      setError(getAuthErrorMessage(err, "Failed to resend code"));
    } finally {
      setLoading(false);
    }
  };

  const title = step === "email" ? "Login with Email OTP" : "Enter your verification code";
  const description =
    step === "email"
      ? "Use the email attached to your workspace. We will send a short-lived 6-digit code."
      : `Enter the code sent to ${email}. Codes expire quickly for safety.`;

  return (
    <AuthShell
      eyebrow="Passwordless access"
      title={title}
      description={description}
      heroTitle="Recover your mock environment without losing momentum"
      heroDescription="Sign back into MockAPI to restore endpoints, tunnel workflows, request history, and team context across environments."
      features={authFeatures}
      metrics={authMetrics}
    >
      {notice && (
        <div className="status-banner status-banner--success mb-5 px-4 py-3 text-sm text-foreground">
          {notice}
        </div>
      )}

      {error && (
        <div className="status-banner status-banner--error mb-5 px-4 py-3 text-sm text-foreground">
          {error}
        </div>
      )}

      {step === "email" ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <Button
              variant="outline"
              type="button"
              className="h-12"
              onClick={() => handleOAuth("github")}
            >
              <Github className="mr-2 h-4 w-4" />
              GitHub
            </Button>
            <Button
              variant="outline"
              type="button"
              className="h-12"
              onClick={() => handleOAuth("google")}
            >
              <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
                <path
                  fill="currentColor"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="currentColor"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="currentColor"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
                />
                <path
                  fill="currentColor"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.66l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              Google
            </Button>
          </div>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">
                Or continue with email
              </span>
            </div>
          </div>

          <form onSubmit={handleSendCode} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="login-email">Email address</Label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="login-email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-12 pl-11"
                />
              </div>
            </div>

            <Button type="submit" className="h-12 w-full" disabled={loading}>
              {loading ? <Loader2 className="animate-spin" /> : <Mail />}
              {loading ? "Sending code..." : "Send verification code"}
            </Button>
          </form>
        </div>
      ) : (
        <form onSubmit={handleVerifyCode} className="space-y-5">
          <div className="status-banner px-4 py-3 text-sm text-muted-foreground">
            Code sent to <span className="font-semibold text-foreground">{email}</span>
          </div>

          <div className="space-y-2">
            <Label htmlFor="login-code">6-digit code</Label>
            <Input
              id="login-code"
              type="text"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              required
              placeholder="000000"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
              className="auth-code-input h-16 text-3xl"
            />
          </div>

          <Button type="submit" className="h-12 w-full" disabled={loading || otp.length !== 6}>
            {loading ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
            {loading ? "Verifying..." : "Verify and continue"}
          </Button>

          <div className="flex flex-col gap-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              onClick={() => {
                clearCountdown();
                setStep("email");
                setOtp("");
                setError(null);
                setNotice(null);
              }}
              className="inline-flex items-center gap-2 text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              Change email
            </button>
            <button
              type="button"
              onClick={handleResend}
              disabled={countdown > 0 || loading}
              className="font-semibold text-primary transition-colors hover:text-primary/80 disabled:cursor-not-allowed disabled:text-muted-foreground"
            >
              {countdown > 0 ? `Resend in ${countdown}s` : "Resend code"}
            </button>
          </div>
        </form>
      )}

      <p className="mt-8 text-sm text-muted-foreground">
        No account?{" "}
        <Link to="/signup" className="font-semibold text-primary transition-colors hover:text-primary/80">
          Create one
        </Link>
      </p>
    </AuthShell>
  );
}
