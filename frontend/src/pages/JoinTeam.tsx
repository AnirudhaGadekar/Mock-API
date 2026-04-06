import axios from "axios";
import { Button } from "@/components/ui/button";
import { Loader2, UserPlus2, Users, XCircle } from "lucide-react";
import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AuthModal } from "../components/AuthModal";
import { useAuth } from "../contexts/AuthContext";
import { API_BASE_URL } from "../lib/api";

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
                const res = await axios.get(`${API_BASE_URL}/api/v2/invites/${token}`);
                setInviteData(res.data);
            } catch (err: any) {
                setError(err.response?.data?.error || "Failed to validate invitation");
            } finally {
                setLoading(false);
            }
        };

        if (token) fetchInvite();
    }, [token]);

    const handleJoin = async () => {
        if (!user || user.isAnonymous) {
            showAuthModal("signup");
            return;
        }

        setJoining(true);
        try {
            await axios.post(
                `${API_BASE_URL}/api/v2/invites/${token}/accept`,
                {},
                {
                    headers: { "x-api-key": apiKey }
                }
            );
            navigate(`/teams/${inviteData.team.id}`);
        } catch (err: any) {
            setError(err.response?.data?.error || "Failed to join team");
            setJoining(false);
        }
    };

    if (loading) {
        return (
            <div className="screen-center">
                <div className="screen-card space-y-6 text-center">
                    <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[1.4rem] border border-primary/20 bg-primary/12 text-primary shadow-soft">
                        <Loader2 className="h-8 w-8 animate-spin" />
                    </div>
                    <div className="space-y-3">
                        <div className="auth-kicker mx-auto w-fit">
                            <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
                            Team invitation
                        </div>
                        <h1 className="text-3xl font-semibold">Validating invitation...</h1>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="screen-center">
            <div className="screen-card screen-card-lg space-y-8 text-center">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[1.4rem] border border-primary/20 bg-primary/12 text-primary shadow-soft">
                    {error ? <XCircle className="h-8 w-8 text-destructive" /> : <Users className="h-8 w-8" />}
                </div>

                {error ? (
                    <div className="space-y-4">
                        <div className="auth-kicker mx-auto w-fit">
                            <span className="h-2 w-2 rounded-full bg-destructive" />
                            Invitation error
                        </div>
                        <h1 className="text-3xl font-semibold">Unable to join team</h1>
                        <p className="mx-auto max-w-xl text-sm leading-6 text-muted-foreground">{error}</p>
                        <Button variant="outline" className="w-full" onClick={() => navigate("/")}>
                            Back to home
                        </Button>
                    </div>
                ) : (
                    <div className="space-y-6">
                        <div className="space-y-3">
                            <div className="auth-kicker mx-auto w-fit">
                                <span className="h-2 w-2 rounded-full bg-success" />
                                Team invitation
                            </div>
                            <h1 className="text-3xl font-semibold">You&apos;re invited</h1>
                            <p className="mx-auto max-w-xl text-sm leading-6 text-muted-foreground">
                                <span className="font-semibold text-foreground">
                                    {inviteData.invitedBy.name || inviteData.invitedBy.email}
                                </span>{" "}
                                invited you to join{" "}
                                <span className="font-semibold text-foreground">{inviteData.team.name}</span>.
                                Accept the invite to collaborate on shared endpoints, state, and traffic workflows.
                            </p>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                            <div className="status-banner px-4 py-4 text-left">
                                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                                    Team
                                </div>
                                <div className="mt-2 text-lg font-semibold">{inviteData.team.name}</div>
                            </div>
                            <div className="status-banner px-4 py-4 text-left">
                                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                                    Invited by
                                </div>
                                <div className="mt-2 text-lg font-semibold">
                                    {inviteData.invitedBy.name || inviteData.invitedBy.email}
                                </div>
                            </div>
                        </div>

                        <div className="flex flex-col gap-3 sm:flex-row">
                            <Button className="h-12 flex-1" onClick={handleJoin} disabled={joining}>
                                {joining ? <Loader2 className="animate-spin" /> : <UserPlus2 className="h-4 w-4" />}
                                {joining ? "Joining..." : `Join ${inviteData.team.name}`}
                            </Button>
                            <Button variant="outline" className="h-12 flex-1" onClick={() => navigate("/")}>
                                Decline
                            </Button>
                        </div>
                    </div>
                )}
            </div>

            <AuthModal />
        </div>
    );
};
