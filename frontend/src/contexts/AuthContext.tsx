import axios from 'axios';
import React, { createContext, useContext, useEffect, useState } from 'react';

// API URL from environment
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

interface User {
    id: string;
    email: string;
    name?: string;
    picture?: string;
    isAnonymous: boolean;
    currentWorkspaceType: 'PERSONAL' | 'TEAM';
    currentTeamId?: string;
}

interface AuthContextType {
    user: User | null;
    loading: boolean;
    apiKey: string | null;
    login: (email: string, password: string) => Promise<void>;
    signup: (email: string, password: string, name?: string, conversionToken?: string) => Promise<void>;
    logout: () => Promise<void>;
    refreshUser: () => Promise<void>;
    showAuthModal: (mode?: 'login' | 'signup') => void;
    hideAuthModal: () => void;
    authModalState: { open: boolean; mode: 'login' | 'signup' };
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<User | null>(null);
    const [apiKey, setApiKey] = useState<string | null>(localStorage.getItem('mockurl_api_key'));
    const [loading, setLoading] = useState(true);
    const [authModalState, setAuthModalState] = useState<{ open: boolean; mode: 'login' | 'signup' }>({
        open: false,
        mode: 'login',
    });

    const showAuthModal = (mode: 'login' | 'signup' = 'login') => setAuthModalState({ open: true, mode });
    const hideAuthModal = () => setAuthModalState({ ...authModalState, open: false });

    // NEW: Switch between Personal and Team workspaces
    const switchWorkspace = async (type: 'PERSONAL' | 'TEAM', teamId?: string) => {
        try {
            await axios.post(`${API_URL}/workspace/switch`, { type: type.toLowerCase(), teamId }, {
                headers: { 'x-api-key': apiKey }
            });
            await refreshUser();
        } catch (err) {
            console.error('Failed to switch workspace', err);
            throw err;
        }
    };

    // Initialize: Load user or create anonymous session
    useEffect(() => {
        const initAuth = async () => {
            try {
                if (apiKey) {
                    // Attempt to fetch current user with existing API key
                    try {
                        const res = await axios.get(`${API_URL}/auth/me`, {
                            headers: { 'x-api-key': apiKey }
                        });
                        setUser(res.data);
                    } catch (err) {
                        console.error('Failed to restore session', err);
                        // If key is invalid, clear it and create new anonymous
                        localStorage.removeItem('mockurl_api_key');
                        setApiKey(null);
                        await createAnonymousSession();
                    }
                } else {
                    await createAnonymousSession();
                }
            } catch (err) {
                console.error('Auth initialization failed', err);
            } finally {
                setLoading(false);
            }
        };

        initAuth();
    }, []);

    const createAnonymousSession = async () => {
        try {
            const res = await axios.post(`${API_URL}/auth/anonymous`);
            const { apiKey: newKey, user: newUser } = res.data;
            setApiKey(newKey);
            setUser(newUser);
            localStorage.setItem('mockurl_api_key', newKey);
        } catch (err) {
            console.error('Failed to create anonymous session', err);
        }
    };

    const login = async (email: string, password: string) => {
        const res = await axios.post(`${API_URL}/auth/login`, { email, password });
        const { apiKey: newKey, user: loggedInUser } = res.data;
        setApiKey(newKey);
        setUser(loggedInUser);
        localStorage.setItem('mockurl_api_key', newKey);
        hideAuthModal();
    };

    const signup = async (email: string, password: string, name?: string, conversionToken?: string) => {
        const res = await axios.post(`${API_URL}/auth/signup`, {
            email,
            password,
            name,
            conversionToken: conversionToken || (user?.isAnonymous ? apiKey : undefined)
        });
        const { apiKey: newKey, user: signedUpUser } = res.data;
        setApiKey(newKey);
        setUser(signedUpUser);
        localStorage.setItem('mockurl_api_key', newKey);
        hideAuthModal();
    };

    const logout = async () => {
        if (!apiKey) return;
        try {
            await axios.post(`${API_URL}/auth/logout`, {}, {
                headers: { 'x-api-key': apiKey }
            });
        } catch (err) {
            console.error('Logout failed on server', err);
        } finally {
            // After logout, always revert to a fresh anonymous session for "Lazy Login" UX
            localStorage.removeItem('mockurl_api_key');
            setApiKey(null);
            setUser(null);
            await createAnonymousSession();
        }
    };

    const refreshUser = async () => {
        if (!apiKey) return;
        try {
            const res = await axios.get(`${API_URL}/auth/me`, {
                headers: { 'x-api-key': apiKey }
            });
            setUser(res.data);
        } catch (err) {
            console.error('Failed to refresh user', err);
        }
    };

    return (
        <AuthContext.Provider value={{
            user,
            loading,
            apiKey,
            login,
            signup,
            logout,
            refreshUser,
            showAuthModal,
            hideAuthModal,
            authModalState
        }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};
