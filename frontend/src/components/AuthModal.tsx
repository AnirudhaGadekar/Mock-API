import { Github, Loader2, Mail, Shield, User, X } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getAuthErrorMessage } from '../lib/auth-errors';
import { API_BASE_URL } from '../lib/api';

type Tab = 'login' | 'signup';

export const AuthModal: React.FC = () => {
    const { authModalState, hideAuthModal, signup, apiKey, sendOtp, verifyOtp } = useAuth();
    const { open, mode: initialMode } = authModalState;

    const [tab, setTab] = useState<Tab>(initialMode === 'signup' ? 'signup' : 'login');
    const [loginEmail, setLoginEmail] = useState('');
    const [loginCode, setLoginCode] = useState('');
    const [loginStep, setLoginStep] = useState<'email' | 'code'>('email');
    const [firstName, setFirstName] = useState('');
    const [lastName, setLastName] = useState('');
    const [username, setUsername] = useState('');
    const [signupEmail, setSignupEmail] = useState('');
    const [signupCode, setSignupCode] = useState('');
    const [signupStep, setSignupStep] = useState<'details' | 'code'>('details');
    const [countdown, setCountdown] = useState(0);
    const [notice, setNotice] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

    useEffect(() => {
        return () => clearCountdown();
    }, []);

    useEffect(() => {
        if (!open) {
            return;
        }

        clearCountdown();
        setTab(initialMode === 'signup' ? 'signup' : 'login');
        setLoginStep('email');
        setSignupStep('details');
        setLoginCode('');
        setSignupCode('');
        setError(null);
        setNotice(null);
    }, [open, initialMode]);

    if (!open) {
        return null;
    }

    const handleOAuth = (provider: 'google' | 'github') => {
        const oauthUrl = new URL(`${API_BASE_URL}/api/v2/oauth/${provider}`);
        if (apiKey) {
            oauthUrl.searchParams.append('conversionToken', apiKey);
        }
        window.location.href = oauthUrl.toString();
    };

    const switchTab = (nextTab: Tab) => {
        clearCountdown();
        setTab(nextTab);
        setError(null);
        setNotice(null);
        setLoginStep('email');
        setSignupStep('details');
        setLoginCode('');
        setSignupCode('');
    };

    const handleSendLoginOtp = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setNotice(null);
        setLoading(true);
        try {
            const result = await sendOtp(loginEmail);
            setNotice(result.message || 'We sent a 6-digit code to your email.');
            setLoginStep('code');
            startCountdown(60);
        } catch (err: any) {
            setError(getAuthErrorMessage(err, 'Failed to send code'));
        } finally {
            setLoading(false);
        }
    };

    const handleVerifyLoginOtp = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setLoading(true);
        try {
            await verifyOtp(loginEmail, loginCode);
        } catch (err: any) {
            setError(getAuthErrorMessage(err, 'Invalid or expired code'));
        } finally {
            setLoading(false);
        }
    };

    const handleSignup = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setNotice(null);
        setLoading(true);
        try {
            const result = await signup({
                firstName,
                lastName,
                username,
                email: signupEmail,
            });
            setNotice(result.message);
            if (result.requiresOtpVerification) {
                setSignupStep('code');
                startCountdown(60);
            } else {
                hideAuthModal();
            }
        } catch (err: any) {
            setError(getAuthErrorMessage(err, 'Signup failed'));
        } finally {
            setLoading(false);
        }
    };

    const handleVerifySignupOtp = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setLoading(true);
        try {
            await verifyOtp(signupEmail, signupCode);
        } catch (err: any) {
            setError(getAuthErrorMessage(err, 'Invalid or expired code'));
        } finally {
            setLoading(false);
        }
    };

    const handleResend = async () => {
        if (countdown > 0) {
            return;
        }

        const email = tab === 'login' ? loginEmail : signupEmail;
        setError(null);
        setNotice(null);
        setLoading(true);
        try {
            const result = await sendOtp(email);
            setNotice(result.message || 'A fresh code has been sent.');
            startCountdown(60);
        } catch (err: any) {
            setError(getAuthErrorMessage(err, 'Failed to resend code'));
        } finally {
            setLoading(false);
        }
    };

    const showOAuth = (tab === 'login' && loginStep === 'email') || (tab === 'signup' && signupStep === 'details');
    const title =
        tab === 'login'
            ? loginStep === 'code'
                ? 'Enter Your Code'
                : 'Login with Email OTP'
            : signupStep === 'code'
                ? 'Verify Your Email'
                : 'Create Account';

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/78 p-4 backdrop-blur-md">
            <div className="w-full max-w-lg overflow-hidden rounded-[calc(var(--radius)+0.75rem)] border border-border/75 bg-card/95 shadow-floating backdrop-blur-xl">
                <div className="flex items-center justify-between border-b border-border/70 p-6">
                    <h2 className="text-xl font-bold text-foreground">{title}</h2>
                    <button onClick={hideAuthModal} className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-border/70 bg-background/70 text-muted-foreground transition-colors hover:border-primary/30 hover:bg-secondary hover:text-foreground">
                        <X size={20} />
                    </button>
                </div>

                <div className="p-6">
                    <div className="mb-6 flex gap-1 rounded-[1.25rem] border border-border/70 bg-background/60 p-1">
                        <button
                            type="button"
                            onClick={() => switchTab('login')}
                            className={`flex-1 rounded-lg py-2 text-sm font-semibold transition-all ${
                                tab === 'login' ? 'bg-primary text-primary-foreground shadow-soft' : 'text-muted-foreground hover:text-foreground'
                            }`}
                        >
                            Sign In
                        </button>
                        <button
                            type="button"
                            onClick={() => switchTab('signup')}
                            className={`flex-1 rounded-lg py-2 text-sm font-semibold transition-all ${
                                tab === 'signup' ? 'bg-primary text-primary-foreground shadow-soft' : 'text-muted-foreground hover:text-foreground'
                            }`}
                        >
                            Sign Up
                        </button>
                    </div>

                    {showOAuth && (
                        <>
                            <div className="mb-6 grid grid-cols-2 gap-3">
                                <button
                                    type="button"
                                    onClick={() => handleOAuth('github')}
                                    className="flex items-center justify-center gap-2 rounded-2xl border border-border/70 bg-background/70 py-3 text-sm font-semibold text-foreground transition-all active:scale-[0.99] hover:bg-secondary/80"
                                >
                                    <Github size={17} />
                                    <span>GitHub</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleOAuth('google')}
                                    className="flex items-center justify-center gap-2 rounded-2xl border border-border/70 bg-background/70 py-3 text-sm font-semibold text-foreground transition-all active:scale-[0.99] hover:bg-secondary/80"
                                >
                                    <svg className="h-4 w-4" viewBox="0 0 24 24">
                                        <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                                        <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                                        <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
                                        <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.66l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                                    </svg>
                                    <span>Google</span>
                                </button>
                            </div>

                            <div className="relative mb-6">
                                <div className="absolute inset-0 flex items-center">
                                    <div className="w-full border-t border-border/70" />
                                </div>
                                <div className="relative flex justify-center text-xs uppercase">
                                    <span className="bg-card px-3 text-muted-foreground">Or continue with email</span>
                                </div>
                            </div>
                        </>
                    )}

                    {notice && (
                        <div className="status-banner status-banner--success mb-4 px-4 py-3 text-sm text-foreground">
                            {notice}
                        </div>
                    )}

                    {error && (
                        <div className="status-banner status-banner--error mb-4 px-4 py-3 text-sm text-foreground">
                            {error}
                        </div>
                    )}

                    {tab === 'login' && loginStep === 'email' && (
                        <form onSubmit={handleSendLoginOtp} className="space-y-4">
                            <p className="text-sm text-muted-foreground">
                                We&apos;ll send a 6-digit login code to your email. No password needed.
                            </p>
                            <div className="relative">
                                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
                                <input
                                    type="email"
                                    required
                                    placeholder="your@email.com"
                                    value={loginEmail}
                                    onChange={(e) => setLoginEmail(e.target.value)}
                                    className="w-full rounded-2xl border border-input/80 bg-background/75 py-3 pl-11 pr-4 text-foreground placeholder:text-muted-foreground shadow-[inset_0_1px_0_hsl(var(--background)/0.35)] transition-[border-color,box-shadow,background-color] focus:border-primary/45 focus:outline-none focus:ring-4 focus:ring-ring/15"
                                />
                            </div>
                            <button
                                type="submit"
                                disabled={loading}
                                className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 font-semibold text-primary-foreground shadow-[0_18px_40px_-20px_hsl(var(--primary)/0.8)] transition-[transform,background-color,box-shadow,opacity] active:scale-[0.99] hover:bg-primary/92 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {loading ? <Loader2 size={18} className="animate-spin" /> : <Mail size={18} />}
                                {loading ? 'Sending...' : 'Send Code'}
                            </button>
                        </form>
                    )}

                    {tab === 'login' && loginStep === 'code' && (
                        <form onSubmit={handleVerifyLoginOtp} className="space-y-4">
                            <div className="status-banner px-4 py-3 text-center text-sm text-muted-foreground">
                                Code sent to <strong>{loginEmail}</strong>
                            </div>
                            <div>
                                <label className="mb-2 block text-center text-sm text-muted-foreground">Enter 6-digit code</label>
                                <input
                                    type="text"
                                    inputMode="numeric"
                                    pattern="\d{6}"
                                    maxLength={6}
                                    required
                                    placeholder="000000"
                                    value={loginCode}
                                    onChange={(e) => setLoginCode(e.target.value.replace(/\D/g, ''))}
                                    className="auth-code-input w-full rounded-[1.5rem] border border-input/80 bg-background/75 px-4 py-4 text-center font-mono text-3xl text-foreground placeholder:text-muted-foreground shadow-[inset_0_1px_0_hsl(var(--background)/0.35)] transition-[border-color,box-shadow,background-color] focus:border-primary/45 focus:outline-none focus:ring-4 focus:ring-ring/15"
                                />
                            </div>
                            <button
                                type="submit"
                                disabled={loading || loginCode.length !== 6}
                                className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 font-semibold text-primary-foreground shadow-[0_18px_40px_-20px_hsl(var(--primary)/0.8)] transition-[transform,background-color,box-shadow,opacity] active:scale-[0.99] hover:bg-primary/92 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {loading ? <Loader2 size={18} className="animate-spin" /> : <Shield size={18} />}
                                {loading ? 'Verifying...' : 'Verify Code'}
                            </button>
                            <div className="flex items-center justify-between text-sm">
                                <button
                                    type="button"
                                    onClick={() => {
                                        clearCountdown();
                                        setLoginStep('email');
                                        setLoginCode('');
                                        setError(null);
                                        setNotice(null);
                                    }}
                                    className="text-muted-foreground transition-colors hover:text-foreground"
                                >
                                    Change email
                                </button>
                                <button
                                    type="button"
                                    onClick={handleResend}
                                    disabled={countdown > 0 || loading}
                                    className="font-semibold text-primary transition-colors hover:text-primary/80 disabled:cursor-not-allowed disabled:text-muted-foreground"
                                >
                                    {countdown > 0 ? `Resend in ${countdown}s` : 'Resend code'}
                                </button>
                            </div>
                        </form>
                    )}

                    {tab === 'signup' && signupStep === 'details' && (
                        <form onSubmit={handleSignup} className="space-y-4">
                            <p className="text-sm text-muted-foreground">
                                Create your account details, then verify your email with a 6-digit code.
                            </p>
                            <div className="grid grid-cols-1 gap-3">
                                <div className="relative">
                                    <User className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
                                    <input
                                        type="text"
                                        required
                                        placeholder="First name"
                                        value={firstName}
                                        onChange={(e) => setFirstName(e.target.value)}
                                        className="w-full rounded-2xl border border-input/80 bg-background/75 py-3 pl-11 pr-4 text-foreground placeholder:text-muted-foreground shadow-[inset_0_1px_0_hsl(var(--background)/0.35)] transition-[border-color,box-shadow,background-color] focus:border-primary/45 focus:outline-none focus:ring-4 focus:ring-ring/15"
                                    />
                                </div>
                                <div className="relative">
                                    <User className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
                                    <input
                                        type="text"
                                        required
                                        placeholder="Last name"
                                        value={lastName}
                                        onChange={(e) => setLastName(e.target.value)}
                                        className="w-full rounded-2xl border border-input/80 bg-background/75 py-3 pl-11 pr-4 text-foreground placeholder:text-muted-foreground shadow-[inset_0_1px_0_hsl(var(--background)/0.35)] transition-[border-color,box-shadow,background-color] focus:border-primary/45 focus:outline-none focus:ring-4 focus:ring-ring/15"
                                    />
                                </div>
                                <input
                                    type="text"
                                    required
                                    placeholder="Username"
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    className="w-full rounded-2xl border border-input/80 bg-background/75 px-4 py-3 text-foreground placeholder:text-muted-foreground shadow-[inset_0_1px_0_hsl(var(--background)/0.35)] transition-[border-color,box-shadow,background-color] focus:border-primary/45 focus:outline-none focus:ring-4 focus:ring-ring/15"
                                />
                                <div className="relative">
                                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
                                    <input
                                        type="email"
                                        required
                                        placeholder="your@email.com"
                                        value={signupEmail}
                                        onChange={(e) => setSignupEmail(e.target.value)}
                                        className="w-full rounded-2xl border border-input/80 bg-background/75 py-3 pl-11 pr-4 text-foreground placeholder:text-muted-foreground shadow-[inset_0_1px_0_hsl(var(--background)/0.35)] transition-[border-color,box-shadow,background-color] focus:border-primary/45 focus:outline-none focus:ring-4 focus:ring-ring/15"
                                    />
                                </div>
                            </div>
                            <button
                                type="submit"
                                disabled={loading}
                                className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 font-semibold text-primary-foreground shadow-[0_18px_40px_-20px_hsl(var(--primary)/0.8)] transition-[transform,background-color,box-shadow,opacity] active:scale-[0.99] hover:bg-primary/92 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {loading && <Loader2 size={18} className="animate-spin" />}
                                {loading ? 'Creating...' : 'Create Account'}
                            </button>
                        </form>
                    )}

                    {tab === 'signup' && signupStep === 'code' && (
                        <form onSubmit={handleVerifySignupOtp} className="space-y-4">
                            <div className="status-banner px-4 py-3 text-center text-sm text-muted-foreground">
                                Code sent to <strong>{signupEmail}</strong>
                            </div>
                            <div>
                                <label className="mb-2 block text-center text-sm text-muted-foreground">Enter 6-digit code</label>
                                <input
                                    type="text"
                                    inputMode="numeric"
                                    pattern="\d{6}"
                                    maxLength={6}
                                    required
                                    placeholder="000000"
                                    value={signupCode}
                                    onChange={(e) => setSignupCode(e.target.value.replace(/\D/g, ''))}
                                    className="auth-code-input w-full rounded-[1.5rem] border border-input/80 bg-background/75 px-4 py-4 text-center font-mono text-3xl text-foreground placeholder:text-muted-foreground shadow-[inset_0_1px_0_hsl(var(--background)/0.35)] transition-[border-color,box-shadow,background-color] focus:border-primary/45 focus:outline-none focus:ring-4 focus:ring-ring/15"
                                />
                            </div>
                            <button
                                type="submit"
                                disabled={loading || signupCode.length !== 6}
                                className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 font-semibold text-primary-foreground shadow-[0_18px_40px_-20px_hsl(var(--primary)/0.8)] transition-[transform,background-color,box-shadow,opacity] active:scale-[0.99] hover:bg-primary/92 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {loading ? <Loader2 size={18} className="animate-spin" /> : <Shield size={18} />}
                                {loading ? 'Verifying...' : 'Verify and Continue'}
                            </button>
                            <div className="flex items-center justify-between text-sm">
                                <button
                                    type="button"
                                    onClick={() => {
                                        clearCountdown();
                                        setSignupStep('details');
                                        setSignupCode('');
                                        setError(null);
                                        setNotice(null);
                                    }}
                                    className="text-muted-foreground transition-colors hover:text-foreground"
                                >
                                    Edit details
                                </button>
                                <button
                                    type="button"
                                    onClick={handleResend}
                                    disabled={countdown > 0 || loading}
                                    className="font-semibold text-primary transition-colors hover:text-primary/80 disabled:cursor-not-allowed disabled:text-muted-foreground"
                                >
                                    {countdown > 0 ? `Resend in ${countdown}s` : 'Resend code'}
                                </button>
                            </div>
                        </form>
                    )}
                </div>
            </div>
        </div>
    );
};
