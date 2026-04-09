import { AuthShell } from "@/components/auth/AuthShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { API_BASE_URL } from "@/lib/api";
import {
  ArrowLeft,
  Github,
  Loader2,
  Mail,
  ShieldCheck,
  Sparkles,
  Users,
  Workflow
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

const signupFeatures = [
  {
    icon: Users,
    title: "Collaborate with your team",
    description: "Persist mock endpoints, invite collaborators, and share a single control surface.",
  },
  {
    icon: Workflow,
    title: "Carry your workflows forward",
    description: "Keep traffic inspection, tunnel usage, and endpoint configuration tied to one account.",
  },
  {
    icon: Sparkles,
    title: "Upgrade from anonymous instantly",
    description: "Move from a temporary session to a durable workspace without changing your existing flow.",
  },
];

const signupMetrics = [
  { label: "Onboarding", value: "<2m" },
  { label: "Security", value: "OTP" },
  { label: "Sharing", value: "Teams" },
];

export default function Signup() {
  const { signup, sendOtp, verifyOtp, user, apiKey } = useAuth();
  const navigate = useNavigate();
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [step, setStep] = useState<"details" | "code">("details");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [username, setUsername] = useState("");
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

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setLoading(true);

    try {
      const result = await signup({ firstName, lastName, username, email });
      setNotice(result.message || "Account created. Enter the code sent to your email.");
      if (result.requiresOtpVerification) {
        setStep("code");
        startCountdown(60);
      }
    } catch (err: any) {
      setError(err?.response?.data?.error || "Signup failed");
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
      setError(err?.response?.data?.error || "Invalid or expired code");
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
      setNotice(result.message || "A fresh verification code has been sent.");
      startCountdown(60);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Failed to resend code");
    } finally {
      setLoading(false);
    }
  };

  const title = step === "details" ? "Create your workspace account" : "Verify your email";
  const description =
    step === "details"
      ? "Set up your profile, then confirm ownership of the email address with a 6-digit code."
      : `Enter the code sent to ${email}.`;

  return (
    <AuthShell
      eyebrow="Persistent workspace"
      title={title}
      description={description}
      heroTitle="Turn temporary mock projects into a shared platform"
      heroDescription="Create a durable MockAPI workspace so your endpoints, state, traffic history, and collaboration settings follow your team everywhere."
      features={signupFeatures}
      metrics={signupMetrics}
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

      {step === "details" ? (
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

          <form onSubmit={handleSignup} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="first-name">First name</Label>
                <Input
                  id="first-name"
                  required
                  placeholder="Anirudha"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="h-11"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="last-name">Last name</Label>
                <Input
                  id="last-name"
                  required
                  placeholder="Gadekar"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="h-11"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="signup-username">Username</Label>
              <Input
                id="signup-username"
                required
                placeholder="AnirudhaGadekar"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="h-11"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="signup-email">Email address</Label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="signup-email"
                  type="email"
                  required
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-11 pl-11"
                />
              </div>
            </div>

            <Button type="submit" className="h-12 w-full" disabled={loading}>
              {loading ? <Loader2 className="animate-spin" /> : <Sparkles />}
              {loading ? "Creating account..." : "Create workspace account"}
            </Button>
          </form>
        </div>
      ) : (
        <form onSubmit={handleVerifyCode} className="space-y-5">
          <div className="status-banner px-4 py-3 text-sm text-muted-foreground">
            Verification code sent to <span className="font-semibold text-foreground">{email}</span>
          </div>

          <div className="space-y-2">
            <Label htmlFor="signup-code">6-digit code</Label>
            <Input
              id="signup-code"
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
                setStep("details");
                setOtp("");
                setError(null);
                setNotice(null);
              }}
              className="inline-flex items-center gap-2 text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              Edit details
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
        Already have an account?{" "}
        <Link to="/login" className="font-semibold text-primary transition-colors hover:text-primary/80">
          Login
        </Link>
      </p>
    </AuthShell>
  );
}
