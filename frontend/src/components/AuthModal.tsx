import { Github, Loader2, Mail, Shield, User, X } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

type Tab = 'login' | 'signup' | 'otp';

export const AuthModal: React.FC = () => {
    const { authModalState, hideAuthModal, login, signup, apiKey, sendOtp, verifyOtp } = useAuth();
    const { open, mode: initialMode } = authModalState;

    const [tab, setTab] = useState<Tab>(initialMode === 'signup' ? 'signup' : 'login');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [name, setName] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    // OTP state
    const [otpStep, setOtpStep] = useState<'email' | 'code'>('email');
    const [otpCode, setOtpCode] = useState('');
    const [otpEmail, setOtpEmail] = useState('');
    const [otpCountdown, setOtpCountdown] = useState(0);
    const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Reset state when modal opens/closes
    useEffect(() => {
        if (open) {
            setTab(initialMode === 'signup' ? 'signup' : 'login');
            setError(null);
            setEmail('');
            setPassword('');
            setName('');
            setOtpStep('email');
            setOtpCode('');
            setOtpEmail('');
        }
    }, [open, initialMode]);

    // Countdown timer for OTP resend
    const startCountdown = (seconds = 60) => {
        setOtpCountdown(seconds);
        if (countdownRef.current) clearInterval(countdownRef.current);
        countdownRef.current = setInterval(() => {
            setOtpCountdown((s) => {
                if (s <= 1) {
                    clearInterval(countdownRef.current!);
                    return 0;
                }
                return s - 1;
            });
        }, 1000);
    };

    if (!open) return null;

    // ── Email/Password submit ──────────────────────────────────────────────
    const handleEmailPasswordSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setLoading(true);
        try {
            if (tab === 'login') {
                await login(email, password);
            } else {
                await signup(email, password, name);
            }
        } catch (err: any) {
            setError(err.response?.data?.error || 'Authentication failed');
        } finally {
            setLoading(false);
        }
    };

    // ── OTP: Send ─────────────────────────────────────────────────────────
    const handleSendOtp = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setLoading(true);
        try {
            await sendOtp(otpEmail);
            setOtpStep('code');
            startCountdown(60);
        } catch (err: any) {
            setError(err.response?.data?.error || 'Failed to send OTP');
        } finally {
            setLoading(false);
        }
    };

    // ── OTP: Verify ───────────────────────────────────────────────────────
    const handleVerifyOtp = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setLoading(true);
        try {
            await verifyOtp(otpEmail, otpCode);
        } catch (err: any) {
            setError(err.response?.data?.error || 'Invalid or expired OTP');
        } finally {
            setLoading(false);
        }
    };

    // ── OTP: Resend ───────────────────────────────────────────────────────
    const handleResendOtp = async () => {
        if (otpCountdown > 0) return;
        setError(null);
        setLoading(true);
        try {
            await sendOtp(otpEmail);
            startCountdown(60);
        } catch (err: any) {
            setError(err.response?.data?.error || 'Failed to resend OTP');
        } finally {
            setLoading(false);
        }
    };

    // ── OAuth ─────────────────────────────────────────────────────────────
    const handleOAuth = (provider: 'google' | 'github') => {
        const oauthUrl = new URL(`${import.meta.env.VITE_API_URL || 'http://localhost:3000'}/api/v1/oauth/${provider}`);
        if (apiKey) oauthUrl.searchParams.append('conversionToken', apiKey);
        window.location.href = oauthUrl.toString();
    };

    // ── Tab bar ───────────────────────────────────────────────────────────
    const tabs: { id: Tab; label: string }[] = [
        { id: 'login', label: 'Sign In' },
        { id: 'signup', label: 'Sign Up' },
        { id: 'otp', label: 'Email OTP' },
    ];

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="bg-slate-900 border border-slate-800 w-full max-w-md rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">

                {/* Header */}
                <div className="flex justify-between items-center p-6 border-b border-slate-800">
                    <h2 className="text-xl font-bold text-white">
                        {tab === 'otp'
                            ? otpStep === 'email' ? 'Login with Email OTP' : 'Enter Your Code'
                            : tab === 'login' ? 'Welcome Back' : 'Create Account'}
                    </h2>
                    <button onClick={hideAuthModal} className="text-slate-400 hover:text-white transition-colors">
                        <X size={20} />
                    </button>
                </div>

                <div className="p-6">
                    {/* Tab bar */}
                    <div className="flex bg-slate-950 rounded-xl p-1 mb-6 gap-1">
                        {tabs.map((t) => (
                            <button
                                key={t.id}
                                onClick={() => { setTab(t.id); setError(null); setOtpStep('email'); }}
                                className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all ${tab === t.id
                                        ? 'bg-indigo-600 text-white shadow'
                                        : 'text-slate-400 hover:text-white'
                                    }`}
                            >
                                {t.id === 'otp' && <Shield className="inline-block w-3.5 h-3.5 mr-1 -mt-0.5" />}
                                {t.label}
                            </button>
                        ))}
                    </div>

                    {/* ─── OTP TAB ────────────────────────────────────────────────────── */}
                    {tab === 'otp' && (
                        <div>
                            {otpStep === 'email' ? (
                                <form onSubmit={handleSendOtp} className="space-y-4">
                                    <p className="text-slate-400 text-sm">
                                        We'll send a 6-digit login code to your email. No password needed.
                                    </p>
                                    <div className="relative">
                                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                                        <input
                                            type="email"
                                            placeholder="your@email.com"
                                            required
                                            value={otpEmail}
                                            onChange={(e) => setOtpEmail(e.target.value)}
                                            className="w-full bg-slate-950 border border-slate-800 rounded-lg py-2.5 pl-10 pr-4 text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all"
                                        />
                                    </div>
                                    {error && (
                                        <div className="p-3 bg-red-500/10 border border-red-500/50 text-red-400 text-sm rounded-lg">
                                            {error}
                                        </div>
                                    )}
                                    <button
                                        type="submit"
                                        disabled={loading}
                                        className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-lg shadow-lg shadow-indigo-600/20 transition-all active:scale-95"
                                    >
                                        {loading ? <Loader2 size={18} className="animate-spin" /> : <Mail size={18} />}
                                        {loading ? 'Sending…' : 'Send OTP'}
                                    </button>
                                </form>
                            ) : (
                                <form onSubmit={handleVerifyOtp} className="space-y-4">
                                    <div className="p-3 bg-indigo-500/10 border border-indigo-500/30 rounded-lg">
                                        <p className="text-indigo-300 text-sm text-center">
                                            Code sent to <strong>{otpEmail}</strong>
                                        </p>
                                    </div>

                                    {/* 6-digit OTP input */}
                                    <div>
                                        <label className="block text-slate-400 text-sm mb-2 text-center">
                                            Enter 6-digit code
                                        </label>
                                        <input
                                            type="text"
                                            inputMode="numeric"
                                            pattern="\d{6}"
                                            maxLength={6}
                                            placeholder="000000"
                                            required
                                            value={otpCode}
                                            onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                                            className="w-full bg-slate-950 border border-slate-700 rounded-xl py-4 px-4 text-white text-center text-3xl font-mono tracking-[0.5em] placeholder:text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all"
                                        />
                                    </div>

                                    {error && (
                                        <div className="p-3 bg-red-500/10 border border-red-500/50 text-red-400 text-sm rounded-lg">
                                            {error}
                                        </div>
                                    )}

                                    <button
                                        type="submit"
                                        disabled={loading || otpCode.length !== 6}
                                        className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-lg shadow-lg shadow-indigo-600/20 transition-all active:scale-95"
                                    >
                                        {loading ? <Loader2 size={18} className="animate-spin" /> : <Shield size={18} />}
                                        {loading ? 'Verifying…' : 'Verify Code'}
                                    </button>

                                    <div className="flex items-center justify-between text-sm">
                                        <button
                                            type="button"
                                            onClick={() => { setOtpStep('email'); setOtpCode(''); setError(null); }}
                                            className="text-slate-500 hover:text-slate-300 transition-colors"
                                        >
                                            ← Change email
                                        </button>
                                        <button
                                            type="button"
                                            onClick={handleResendOtp}
                                            disabled={otpCountdown > 0 || loading}
                                            className="text-indigo-400 hover:text-indigo-300 disabled:text-slate-600 disabled:cursor-not-allowed transition-colors"
                                        >
                                            {otpCountdown > 0 ? `Resend in ${otpCountdown}s` : 'Resend code'}
                                        </button>
                                    </div>
                                </form>
                            )}
                        </div>
                    )}

                    {/* ─── LOGIN / SIGNUP TAB ─────────────────────────────────────────── */}
                    {tab !== 'otp' && (
                        <div>
                            {/* OAuth buttons */}
                            <div className="grid grid-cols-2 gap-3 mb-6">
                                <button
                                    onClick={() => handleOAuth('github')}
                                    className="flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 text-white py-2.5 rounded-lg border border-slate-700 transition-all active:scale-95 text-sm font-medium"
                                >
                                    <Github size={17} />
                                    <span>GitHub</span>
                                </button>
                                <button
                                    onClick={() => handleOAuth('google')}
                                    className="flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 text-white py-2.5 rounded-lg border border-slate-700 transition-all active:scale-95 text-sm font-medium"
                                >
                                    <svg className="w-4 h-4" viewBox="0 0 24 24">
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

                            <form onSubmit={handleEmailPasswordSubmit} className="space-y-4">
                                {tab === 'signup' && (
                                    <div className="relative">
                                        <User className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                                        <input
                                            type="text"
                                            placeholder="Full Name"
                                            required
                                            value={name}
                                            onChange={(e) => setName(e.target.value)}
                                            className="w-full bg-slate-950 border border-slate-800 rounded-lg py-2.5 pl-10 pr-4 text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all"
                                        />
                                    </div>
                                )}

                                <div className="relative">
                                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                                    <input
                                        type="email"
                                        placeholder="Email Address"
                                        required
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        className="w-full bg-slate-950 border border-slate-800 rounded-lg py-2.5 pl-10 pr-4 text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all"
                                    />
                                </div>

                                <div className="relative">
                                    <input
                                        type="password"
                                        placeholder="Password"
                                        required
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        className="w-full bg-slate-950 border border-slate-800 rounded-lg py-2.5 px-4 text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all"
                                    />
                                </div>

                                {error && (
                                    <div className="p-3 bg-red-500/10 border border-red-500/50 text-red-400 text-sm rounded-lg">
                                        {error}
                                    </div>
                                )}

                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-lg shadow-lg shadow-indigo-600/20 transition-all active:scale-95"
                                >
                                    {loading && <Loader2 size={18} className="animate-spin" />}
                                    {loading ? 'Processing…' : tab === 'login' ? 'Sign In' : 'Create Account'}
                                </button>
                            </form>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
