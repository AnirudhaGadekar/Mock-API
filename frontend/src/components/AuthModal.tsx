import { Github, Loader2, Mail, Shield, User, X } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
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
            setError(err?.response?.data?.error || 'Failed to send code');
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
            setError(err?.response?.data?.error || 'Invalid or expired code');
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
            setError(err?.response?.data?.error || 'Signup failed');
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
            setError(err?.response?.data?.error || 'Invalid or expired code');
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
            setError(err?.response?.data?.error || 'Failed to resend code');
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
            <div className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl">
                <div className="flex items-center justify-between border-b border-slate-800 p-6">
                    <h2 className="text-xl font-bold text-white">{title}</h2>
                    <button onClick={hideAuthModal} className="text-slate-400 transition-colors hover:text-white">
                        <X size={20} />
                    </button>
                </div>

                <div className="p-6">
                    <div className="mb-6 flex gap-1 rounded-xl bg-slate-950 p-1">
                        <button
                            type="button"
                            onClick={() => switchTab('login')}
                            className={`flex-1 rounded-lg py-2 text-sm font-semibold transition-all ${
                                tab === 'login' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'
                            }`}
                        >
                            Sign In
                        </button>
                        <button
                            type="button"
                            onClick={() => switchTab('signup')}
                            className={`flex-1 rounded-lg py-2 text-sm font-semibold transition-all ${
                                tab === 'signup' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'
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
                                    className="flex items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-800 py-2.5 text-sm font-medium text-white transition-all active:scale-95 hover:bg-slate-700"
                                >
                                    <Github size={17} />
                                    <span>GitHub</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleOAuth('google')}
                                    className="flex items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-800 py-2.5 text-sm font-medium text-white transition-all active:scale-95 hover:bg-slate-700"
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
                                    <div className="w-full border-t border-slate-800" />
                                </div>
                                <div className="relative flex justify-center text-xs uppercase">
                                    <span className="bg-slate-900 px-3 text-slate-500">Or continue with email</span>
                                </div>
                            </div>
                        </>
                    )}

                    {notice && (
                        <div className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-300">
                            {notice}
                        </div>
                    )}

                    {error && (
                        <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
                            {error}
                        </div>
                    )}

                    {tab === 'login' && loginStep === 'email' && (
                        <form onSubmit={handleSendLoginOtp} className="space-y-4">
                            <p className="text-sm text-slate-400">
                                We&apos;ll send a 6-digit login code to your email. No password needed.
                            </p>
                            <div className="relative">
                                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                                <input
                                    type="email"
                                    required
                                    placeholder="your@email.com"
                                    value={loginEmail}
                                    onChange={(e) => setLoginEmail(e.target.value)}
                                    className="w-full rounded-lg border border-slate-800 bg-slate-950 py-2.5 pl-10 pr-4 text-white placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                                />
                            </div>
                            <button
                                type="submit"
                                disabled={loading}
                                className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 py-3 font-semibold text-white transition-all active:scale-95 hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {loading ? <Loader2 size={18} className="animate-spin" /> : <Mail size={18} />}
                                {loading ? 'Sending...' : 'Send Code'}
                            </button>
                        </form>
                    )}

                    {tab === 'login' && loginStep === 'code' && (
                        <form onSubmit={handleVerifyLoginOtp} className="space-y-4">
                            <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/10 p-3 text-center text-sm text-indigo-300">
                                Code sent to <strong>{loginEmail}</strong>
                            </div>
                            <div>
                                <label className="mb-2 block text-center text-sm text-slate-400">Enter 6-digit code</label>
                                <input
                                    type="text"
                                    inputMode="numeric"
                                    pattern="\d{6}"
                                    maxLength={6}
                                    required
                                    placeholder="000000"
                                    value={loginCode}
                                    onChange={(e) => setLoginCode(e.target.value.replace(/\D/g, ''))}
                                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-4 text-center font-mono text-3xl tracking-[0.5em] text-white placeholder:text-slate-700 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                                />
                            </div>
                            <button
                                type="submit"
                                disabled={loading || loginCode.length !== 6}
                                className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 py-3 font-semibold text-white transition-all active:scale-95 hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
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
                                    className="text-slate-500 transition-colors hover:text-slate-300"
                                >
                                    Change email
                                </button>
                                <button
                                    type="button"
                                    onClick={handleResend}
                                    disabled={countdown > 0 || loading}
                                    className="text-indigo-400 transition-colors hover:text-indigo-300 disabled:cursor-not-allowed disabled:text-slate-600"
                                >
                                    {countdown > 0 ? `Resend in ${countdown}s` : 'Resend code'}
                                </button>
                            </div>
                        </form>
                    )}

                    {tab === 'signup' && signupStep === 'details' && (
                        <form onSubmit={handleSignup} className="space-y-4">
                            <p className="text-sm text-slate-400">
                                Create your account details, then verify your email with a 6-digit code.
                            </p>
                            <div className="grid grid-cols-1 gap-3">
                                <div className="relative">
                                    <User className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                                    <input
                                        type="text"
                                        required
                                        placeholder="First name"
                                        value={firstName}
                                        onChange={(e) => setFirstName(e.target.value)}
                                        className="w-full rounded-lg border border-slate-800 bg-slate-950 py-2.5 pl-10 pr-4 text-white placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                                    />
                                </div>
                                <div className="relative">
                                    <User className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                                    <input
                                        type="text"
                                        required
                                        placeholder="Last name"
                                        value={lastName}
                                        onChange={(e) => setLastName(e.target.value)}
                                        className="w-full rounded-lg border border-slate-800 bg-slate-950 py-2.5 pl-10 pr-4 text-white placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                                    />
                                </div>
                                <input
                                    type="text"
                                    required
                                    placeholder="Username"
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    className="w-full rounded-lg border border-slate-800 bg-slate-950 px-4 py-2.5 text-white placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                                />
                                <div className="relative">
                                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                                    <input
                                        type="email"
                                        required
                                        placeholder="your@email.com"
                                        value={signupEmail}
                                        onChange={(e) => setSignupEmail(e.target.value)}
                                        className="w-full rounded-lg border border-slate-800 bg-slate-950 py-2.5 pl-10 pr-4 text-white placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                                    />
                                </div>
                            </div>
                            <button
                                type="submit"
                                disabled={loading}
                                className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 py-3 font-semibold text-white transition-all active:scale-95 hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {loading && <Loader2 size={18} className="animate-spin" />}
                                {loading ? 'Creating...' : 'Create Account'}
                            </button>
                        </form>
                    )}

                    {tab === 'signup' && signupStep === 'code' && (
                        <form onSubmit={handleVerifySignupOtp} className="space-y-4">
                            <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/10 p-3 text-center text-sm text-indigo-300">
                                Code sent to <strong>{signupEmail}</strong>
                            </div>
                            <div>
                                <label className="mb-2 block text-center text-sm text-slate-400">Enter 6-digit code</label>
                                <input
                                    type="text"
                                    inputMode="numeric"
                                    pattern="\d{6}"
                                    maxLength={6}
                                    required
                                    placeholder="000000"
                                    value={signupCode}
                                    onChange={(e) => setSignupCode(e.target.value.replace(/\D/g, ''))}
                                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-4 text-center font-mono text-3xl tracking-[0.5em] text-white placeholder:text-slate-700 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                                />
                            </div>
                            <button
                                type="submit"
                                disabled={loading || signupCode.length !== 6}
                                className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 py-3 font-semibold text-white transition-all active:scale-95 hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
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
                                    className="text-slate-500 transition-colors hover:text-slate-300"
                                >
                                    Edit details
                                </button>
                                <button
                                    type="button"
                                    onClick={handleResend}
                                    disabled={countdown > 0 || loading}
                                    className="text-indigo-400 transition-colors hover:text-indigo-300 disabled:cursor-not-allowed disabled:text-slate-600"
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
