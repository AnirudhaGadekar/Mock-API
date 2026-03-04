/**
 * AuthError — shown when OAuth fails.
 * The backend redirects here with ?message=...
 */
import { useNavigate, useSearchParams } from 'react-router-dom';

export default function AuthError() {
    const navigate = useNavigate();
    const [params] = useSearchParams();
    const message = params.get('message') ?? 'Authentication failed. Please try again.';

    return (
        <div className="min-h-screen flex items-center justify-center bg-slate-950 p-4">
            <div className="max-w-sm w-full bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center space-y-6">
                <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto">
                    <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                    </svg>
                </div>
                <div>
                    <h1 className="text-white text-xl font-bold">Login Failed</h1>
                    <p className="text-slate-400 text-sm mt-2">{message}</p>
                </div>
                <button
                    onClick={() => navigate('/', { replace: true })}
                    className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 rounded-lg transition-all"
                >
                    Back to Home
                </button>
            </div>
        </div>
    );
}
