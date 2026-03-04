/**
 * AuthCallback — OAuth redirect landing page.
 * After Google/GitHub OAuth, the backend sets the cookie and
 * redirects here. We call refreshUser() and bounce to home.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function AuthCallback() {
    const { refreshUser } = useAuth();
    const navigate = useNavigate();
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const finish = async () => {
            try {
                await refreshUser();
                navigate('/', { replace: true });
            } catch (err) {
                console.error('OAuth callback error', err);
                setError('Failed to complete login. Please try again.');
            }
        };
        finish();
    }, []);

    if (error) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-950">
                <div className="text-center space-y-4">
                    <div className="text-red-400 text-lg font-semibold">{error}</div>
                    <button
                        onClick={() => navigate('/', { replace: true })}
                        className="text-indigo-400 hover:text-indigo-300 text-sm underline"
                    >
                        Go back home
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-slate-950">
            <div className="text-center space-y-6">
                {/* Spinner */}
                <div className="relative mx-auto w-16 h-16">
                    <div className="absolute inset-0 rounded-full border-4 border-slate-800" />
                    <div className="absolute inset-0 rounded-full border-4 border-t-indigo-500 animate-spin" />
                </div>
                <div>
                    <p className="text-white text-lg font-semibold">Signing you in…</p>
                    <p className="text-slate-500 text-sm mt-1">Just a moment</p>
                </div>
            </div>
        </div>
    );
}
