
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchTeam, inviteMember, removeMember, updateMemberRole } from "@/lib/api";
import { useTeamStore } from "@/store/teamStore";
import { Loader2, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "react-hot-toast";

export default function TeamSettings() {
    const { currentTeamId, getCurrentRole } = useTeamStore();
    const [teamDetails, setTeamDetails] = useState<any>(null);
    const [loading, setLoading] = useState(false);

    const [inviteEmail, setInviteEmail] = useState("");
    const [inviteRole, setInviteRole] = useState("MEMBER");
    const [isInviting, setIsInviting] = useState(false);

    const isAdmin = ["OWNER", "ADMIN"].includes(getCurrentRole() || "");

    const loadTeam = async () => {
        if (!currentTeamId) return;
        setLoading(true);
        try {
            const data = await fetchTeam(currentTeamId);
            setTeamDetails(data);
        } catch (error) {
            toast.error("Failed to load team details");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadTeam();
    }, [currentTeamId]);

    const handleInvite = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!currentTeamId || !inviteEmail) return;

        setIsInviting(true);
        try {
            await inviteMember(currentTeamId, inviteEmail, inviteRole);
            toast.success("Invitation sent!");
            setInviteEmail("");
            loadTeam(); // Reload to show pending invites if we were displaying them
        } catch (error: any) {
            toast.error(error.response?.data?.message || "Failed to send invitation");
        } finally {
            setIsInviting(false);
        }
    };

    const handleRemoveMember = async (userId: string) => {
        if (!currentTeamId || !confirm("Are you sure you want to remove this member?")) return;
        try {
            await removeMember(currentTeamId, userId);
            toast.success("Member removed");
            loadTeam();
        } catch (error) {
            toast.error("Failed to remove member");
        }
    };

    const handleRoleChange = async (userId: string, newRole: string) => {
        if (!currentTeamId) return;
        try {
            await updateMemberRole(currentTeamId, userId, newRole);
            toast.success("Role updated");
            loadTeam();
        } catch (error) {
            toast.error("Failed to update role");
        }
    };

    if (!currentTeamId) {
        return (
            <div className="flex flex-col items-center justify-center h-[50vh] text-muted-foreground">
                <p>Select a team to manage settings</p>
            </div>
        );
    }

    if (loading && !teamDetails) {
        return <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>;
    }

    return (
        <div className="space-y-8">
            <div>
                <h2 className="text-3xl font-bold tracking-tight">Team Settings</h2>
                <p className="text-muted-foreground">Manage members and permissions for {teamDetails?.name}</p>
            </div>

            {isAdmin && (
                <Card>
                    <CardHeader>
                        <CardTitle>Invite Member</CardTitle>
                        <CardDescription>Send an email invitation to join this team.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={handleInvite} className="flex gap-4 items-end">
                            <div className="grid w-full max-w-sm items-center gap-1.5">
                                <Label htmlFor="email">Email</Label>
                                <Input
                                    type="email"
                                    id="email"
                                    placeholder="colleague@example.com"
                                    value={inviteEmail}
                                    onChange={(e) => setInviteEmail(e.target.value)}
                                    required
                                />
                            </div>
                            <div className="grid w-full max-w-[150px] items-center gap-1.5">
                                <Label htmlFor="role">Role</Label>
                                <Select value={inviteRole} onValueChange={setInviteRole}>
                                    <SelectTrigger id="role">
                                        <SelectValue placeholder="Select role" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="ADMIN">Admin</SelectItem>
                                        <SelectItem value="MEMBER">Member</SelectItem>
                                        <SelectItem value="VIEWER">Viewer</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <Button type="submit" disabled={isInviting}>
                                {isInviting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                Invite
                            </Button>
                        </form>
                    </CardContent>
                </Card>
            )}

            <Card>
                <CardHeader>
                    <CardTitle>Members</CardTitle>
                    <CardDescription>People with access to this team.</CardDescription>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>User</TableHead>
                                <TableHead>Role</TableHead>
                                <TableHead>Joined</TableHead>
                                {isAdmin && <TableHead className="text-right">Actions</TableHead>}
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {teamDetails?.members?.map((member: any) => (
                                <TableRow key={member.id}>
                                    <TableCell>
                                        <div className="font-medium">{member.user.email}</div>
                                    </TableCell>
                                    <TableCell>
                                        {isAdmin && member.role !== 'OWNER' ? (
                                            <Select
                                                defaultValue={member.role}
                                                onValueChange={(val) => handleRoleChange(member.user.id, val)}
                                            >
                                                <SelectTrigger className="w-[110px] h-8">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="ADMIN">Admin</SelectItem>
                                                    <SelectItem value="MEMBER">Member</SelectItem>
                                                    <SelectItem value="VIEWER">Viewer</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        ) : (
                                            <span className="text-sm border px-2 py-1 rounded bg-muted">{member.role}</span>
                                        )}
                                    </TableCell>
                                    <TableCell className="text-muted-foreground text-sm">
                                        {new Date(member.joinedAt).toLocaleDateString()}
                                    </TableCell>
                                    {isAdmin && (
                                        <TableCell className="text-right">
                                            {member.role !== 'OWNER' && (
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="text-red-500 hover:text-red-600 hover:bg-red-50"
                                                    onClick={() => handleRemoveMember(member.user.id)}
                                                >
                                                    <Trash2 size={16} />
                                                </Button>
                                            )}
                                        </TableCell>
                                    )}
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            {teamDetails?.invitations?.length > 0 && (
                <Card>
                    <CardHeader>
                        <CardTitle>Pending Invitations</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Email</TableHead>
                                    <TableHead>Role</TableHead>
                                    <TableHead>Sent</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {teamDetails.invitations.map((inv: any) => (
                                    <TableRow key={inv.id}>
                                        <TableCell>{inv.email}</TableCell>
                                        <TableCell>{inv.role}</TableCell>
                                        <TableCell>{new Date(inv.createdAt).toLocaleDateString()}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
