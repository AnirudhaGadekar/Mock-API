
import { Check, ChevronsUpDown, Plus, Users } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
    CommandSeparator,
} from "@/components/ui/command";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { createTeam } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useTeamStore } from "@/store/teamStore";
import { toast } from "react-hot-toast";

function slugifyTeamName(name: string): string {
    const base = name
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40);
    const suffix = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    return `${base || 'team'}-${suffix}`;
}

export function TeamSwitcher({ className }: { className?: string }) {
    const [open, setOpen] = useState(false);
    const [showNewTeamDialog, setShowNewTeamDialog] = useState(false);
    const { teams, currentTeamId, refreshTeams, selectTeam, getCurrentTeam } = useTeamStore();

    const [newTeamName, setNewTeamName] = useState("");
    const [isCreating, setIsCreating] = useState(false);

    useEffect(() => {
        refreshTeams();
    }, []);

    const currentTeam = getCurrentTeam();

    const handleCreateTeam = async () => {
        if (!newTeamName.trim()) return;

        setIsCreating(true);
        try {
            const slug = slugifyTeamName(newTeamName);
            const team = await createTeam(newTeamName, slug);
            await refreshTeams();
            await selectTeam(team.id);
            setShowNewTeamDialog(false);
            setNewTeamName("");
            toast.success("Team created!");
        } catch (error: any) {
            toast.error(error?.response?.data?.error || "Failed to create team");
        } finally {
            setIsCreating(false);
        }
    };

    return (
        <Dialog open={showNewTeamDialog} onOpenChange={setShowNewTeamDialog}>
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={open}
                        aria-label="Select a team"
                        className={cn("w-full justify-between", className)}
                    >
                        <Users className="mr-2 h-4 w-4" />
                        {currentTeam ? currentTeam.name : "Personal Workspace"}
                        <ChevronsUpDown className="ml-auto h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[200px] p-0">
                    <Command>
                        <CommandList>
                            <CommandInput placeholder="Search team..." />
                            <CommandEmpty>No team found.</CommandEmpty>
                            <CommandGroup heading="Personal">
                                <CommandItem
                                    onSelect={() => {
                                        void selectTeam(null).catch(() => {
                                            toast.error("Failed to switch workspace");
                                        });
                                        setOpen(false);
                                    }}
                                    className="text-sm"
                                >
                                    <Users className="mr-2 h-4 w-4" />
                                    Personal Workspace
                                    {currentTeamId === null && (
                                        <Check className="ml-auto h-4 w-4" />
                                    )}
                                </CommandItem>
                            </CommandGroup>
                            <CommandSeparator />
                            <CommandGroup heading="Teams">
                                {teams.map((team) => (
                                    <CommandItem
                                        key={team.id}
                                        onSelect={() => {
                                            void selectTeam(team.id).catch(() => {
                                                toast.error("Failed to switch workspace");
                                            });
                                            setOpen(false);
                                        }}
                                        className="text-sm"
                                    >
                                        <Users className="mr-2 h-4 w-4" />
                                        {team.name}
                                        {currentTeamId === team.id && (
                                            <Check className="ml-auto h-4 w-4" />
                                        )}
                                    </CommandItem>
                                ))}
                            </CommandGroup>
                        </CommandList>
                        <CommandSeparator />
                        <CommandList>
                            <CommandGroup>
                                <DialogTrigger asChild>
                                    <CommandItem
                                        onSelect={() => {
                                            setOpen(false);
                                            setShowNewTeamDialog(true);
                                        }}
                                    >
                                        <Plus className="mr-2 h-5 w-5" />
                                        Create Team
                                    </CommandItem>
                                </DialogTrigger>
                            </CommandGroup>
                        </CommandList>
                    </Command>
                </PopoverContent>
            </Popover>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Create team</DialogTitle>
                    <DialogDescription>
                        Add a new team to manage endpoints and collaborators.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-2 pb-4">
                    <div className="space-y-2">
                        <Label htmlFor="name">Team name</Label>
                        <Input
                            id="name"
                            placeholder="Acme Inc."
                            value={newTeamName}
                            onChange={(e) => setNewTeamName(e.target.value)}
                        />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => setShowNewTeamDialog(false)}>
                        Cancel
                    </Button>
                    <Button onClick={handleCreateTeam} disabled={isCreating}>
                        {isCreating ? "Creating..." : "Create Team"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
