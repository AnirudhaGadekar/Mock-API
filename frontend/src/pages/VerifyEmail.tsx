import { useAuth } from '@/contexts/AuthContext';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

export default function VerifyEmail() {
  const { verifyEmailToken } = useAuth();
  const [searchParams] = useSearchParams();
  const token = useMemo(() => searchParams.get('token') || '', [searchParams]);

  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Verifying your email...');

  useEffect(() => {
    const run = async () => {
      if (!token) {
        setStatus('error');
        setMessage('Invalid verification link.');
        return;
      }
      try {
        await verifyEmailToken(token);
        setStatus('success');
        setMessage('Email verified successfully. You can now login.');
      } catch (err: any) {
        setStatus('error');
        setMessage(err?.response?.data?.error || 'Verification failed. The link may be expired.');
      }
    };

    run();
  }, [token, verifyEmailToken]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
        <h1 className="text-2xl font-bold">Email verification</h1>
        <p className="mt-4 text-sm text-slate-300">{message}</p>

        {status !== 'loading' && (
          <Link to="/login" className="mt-6 inline-flex rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500">
            Go to login
          </Link>
        )}
      </div>
    </div>
  );
}
