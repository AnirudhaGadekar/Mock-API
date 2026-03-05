import { useAuth } from '@/contexts/AuthContext';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

export default function Login() {
  const { login, resendVerificationEmail, user } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [verificationPending, setVerificationPending] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user && !user.isAnonymous) {
      navigate('/');
    }
  }, [navigate, user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setVerificationPending(false);
    setLoading(true);
    try {
      await login(email, password);
      navigate('/');
    } catch (err: any) {
      const verificationRequired = Boolean(err?.response?.data?.verificationRequired);
      setVerificationPending(verificationRequired);
      setError(err?.response?.data?.error || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setLoading(true);
    setError(null);
    try {
      await resendVerificationEmail(email);
      setError('Verification email sent. Please check your inbox.');
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to resend verification email');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
        <h1 className="text-2xl font-bold">Login</h1>
        <p className="mt-2 text-sm text-slate-400">Use your email and password.</p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <input
            type="email"
            required
            placeholder="Gmail"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-slate-100"
          />
          <input
            type="password"
            required
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-slate-100"
          />

          {error && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-sky-600 py-2.5 font-semibold text-white hover:bg-sky-500 disabled:opacity-60"
          >
            {loading ? 'Please wait...' : 'Login'}
          </button>

          {verificationPending && (
            <button
              type="button"
              onClick={handleResend}
              disabled={loading}
              className="w-full rounded-lg border border-slate-700 py-2.5 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-60"
            >
              Resend verification email
            </button>
          )}
        </form>

        <p className="mt-6 text-sm text-slate-400">
          No account? <Link to="/signup" className="text-sky-400 hover:underline">Sign up</Link>
        </p>
      </div>
    </div>
  );
}
