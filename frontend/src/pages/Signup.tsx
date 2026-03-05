import { useAuth } from '@/contexts/AuthContext';
import { useState } from 'react';
import { Link } from 'react-router-dom';

export default function Signup() {
  const { signup, resendVerificationEmail } = useAuth();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);

    try {
      const result = await signup({ firstName, lastName, username, email, password });
      if (result.requiresEmailVerification) {
        setSuccess(result.message || 'Account created. Please verify your email before logging in.');
      }
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Signup failed');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setError(null);
    setLoading(true);
    try {
      await resendVerificationEmail(email);
      setSuccess('Verification email sent again. Please check your inbox.');
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to resend verification email');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
        <h1 className="text-2xl font-bold">Create account</h1>
        <p className="mt-2 text-sm text-slate-400">Sign up with full details, then verify Gmail.</p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <input type="text" required placeholder="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-slate-100" />
          <input type="text" required placeholder="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-slate-100" />
          <input type="text" required placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-slate-100" />
          <input type="email" required placeholder="Gmail" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-slate-100" />
          <input type="password" required placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-slate-100" />

          {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}
          {success && <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-300">{success}</div>}

          <button type="submit" disabled={loading} className="w-full rounded-lg bg-sky-600 py-2.5 font-semibold text-white hover:bg-sky-500 disabled:opacity-60">
            {loading ? 'Please wait...' : 'Create account'}
          </button>

          {success && (
            <button type="button" onClick={handleResend} disabled={loading} className="w-full rounded-lg border border-slate-700 py-2.5 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-60">
              Resend verification email
            </button>
          )}
        </form>

        <p className="mt-6 text-sm text-slate-400">
          Already have an account? <Link to="/login" className="text-sky-400 hover:underline">Login</Link>
        </p>
      </div>
    </div>
  );
}
