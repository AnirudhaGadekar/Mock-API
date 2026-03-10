import axios from 'axios';
import { Loader2, Users, XCircle } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AuthModal } from '../components/AuthModal';
import { useAuth } from '../contexts/AuthContext';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v2';

export const JoinTeamPage: React.FC = () => {
    const { token } = useParams<{ token: string }>();
    const navigate = useNavigate();
    const { user, apiKey, showAuthModal } = useAuth();

    const [inviteData, setInviteData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [joining, setJoining] = useState(false);

    useEffect(() => {
        const fetchInvite = async () => {
            try {
                const res = await axios.get(`${API_URL}/invites/${token}`);
                setInviteData(res.data);
            } catch (err: any) {
                setError(err.response?.data?.error || 'Failed to validate invitation');
            } finally {
                setLoading(false);
            }
        };

        if (token) fetchInvite();
    }, [token]);

    const handleJoin = async () => {
        if (!user || user.isAnonymous) {
            showAuthModal('signup');
            return;
        }

        setJoining(true);
        try {
            await axios.post(`${API_URL}/invites/${token}/accept`, {}, {
                headers: { 'x-api-key': apiKey }
            });
            // Success - redirect to team dashboard
            navigate(`/teams/${inviteData.team.id}`);
        } catch (err: any) {
            setError(err.response?.data?.error || 'Failed to join team');
            setJoining(false);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-950 text-white">
                <Loader2 className="animate-spin text-indigo-500" size={40} />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4">
            <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl">
                <div className="flex justify-center mb-6">
                    <div className="w-16 h-16 bg-indigo-500/10 rounded-2xl flex items-center justify-center text-indigo-400">
                        <Users size={32} />
                    </div>
                </div>

                {error ? (
                    <div className="text-center">
                        <div className="flex justify-center text-red-500 mb-4">
                            <XCircle size={48} />
                        </div>
                        <h1 className="text-2xl font-bold text-white mb-2">Invitation Error</h1>
                        <p className="text-slate-400 mb-8">{error}</p>
                        <button
                            onClick={() => navigate('/')}
                            className="w-full bg-slate-800 hover:bg-slate-700 text-white py-3 rounded-xl transition-colors"
                        >
                            Back to Home
                        </button>
                    </div>
                ) : (
                    <div className="text-center">
                        <h1 className="text-2xl font-bold text-white mb-2">You're Invited!</h1>
                        <p className="text-slate-400 mb-8">
                            <span className="text-white font-medium">{inviteData.invitedBy.name || inviteData.invitedBy.email}</span>{' '}
                            invited you to join the team <span className="text-white font-medium">{inviteData.team.name}</span>
                        </p>

                        <div className="space-y-4">
                            <button
                                onClick={handleJoin}
                                disabled={joining}
                                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-4 rounded-xl font-bold text-lg shadow-xl shadow-indigo-600/20 transition-all active:scale-95 flex items-center justify-center gap-2"
                            >
                                {joining && <Loader2 className="animate-spin" size={20} />}
                                Join {inviteData.team.name}
                            </button>

                            <button
                                onClick={() => navigate('/')}
                                className="w-full bg-slate-800 hover:bg-slate-700 text-slate-300 py-3 rounded-xl transition-colors"
                            >
                                Decline
                            </button>
                        </div>
                    </div>
                )}
            </div>

            <AuthModal />
        </div>
    );
};

