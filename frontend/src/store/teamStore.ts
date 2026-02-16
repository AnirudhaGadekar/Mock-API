
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Team } from '../lib/api';
import { fetchUserTeams } from '../lib/api';

interface TeamState {
    teams: Team[];
    currentTeamId: string | null;
    isLoading: boolean;

    // Actions
    refreshTeams: () => Promise<void>;
    selectTeam: (teamId: string | null) => void;
    getCurrentTeam: () => Team | undefined;
    getCurrentRole: () => string | undefined;
}

export const useTeamStore = create<TeamState>()(
    persist(
        (set, get) => ({
            teams: [],
            currentTeamId: null,
            isLoading: false,

            refreshTeams: async () => {
                set({ isLoading: true });
                try {
                    const teams = await fetchUserTeams();
                    set({ teams, isLoading: false });

                    // If current team is no longer valid, reset
                    const { currentTeamId } = get();
                    if (currentTeamId && !teams.find(t => t.id === currentTeamId)) {
                        set({ currentTeamId: null });
                    }
                } catch (error) {
                    console.error('Failed to fetch teams', error);
                    set({ isLoading: false });
                }
            },

            selectTeam: (teamId) => {
                set({ currentTeamId: teamId });
            },

            getCurrentTeam: () => {
                const { teams, currentTeamId } = get();
                return teams.find((t) => t.id === currentTeamId);
            },

            getCurrentRole: () => {
                const team = get().getCurrentTeam();
                if (!team) return undefined;
                // In the list API, we might not have the full member record, 
                // but let's assume the API returns the user's role in the team object
                // or we find it in the members array if populated.
                // For now, let's assume the API adds a 'role' field to the Team object for the current user.
                return team.role;
            }
        }),
        {
            name: 'mockurl-team-store',
            partialize: (state) => ({ currentTeamId: state.currentTeamId }),
        }
    )
);
