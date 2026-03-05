import axios from 'axios';
import React, { createContext, useContext, useEffect, useState } from 'react';
import { API_BASE_URL, setApiKeyRef } from '../lib/api';

// API URL from environment — must match api.ts pattern
const API_URL = API_BASE_URL;
axios.defaults.withCredentials = true;

interface User {
    id: string;
    email: string;
    username?: string;
    firstName?: string;
    lastName?: string;
    name?: string;
    picture?: string;
    isAnonymous: boolean;
    authProvider?: string;
    emailVerified?: boolean;
    currentWorkspaceType: 'PERSONAL' | 'TEAM';
    currentTeamId?: string;
}

interface AuthContextType {
    user: User | null;
    loading: boolean;
    apiKey: string | null;
    isAnonymous: boolean;
    login: (email: string, password: string) => Promise<void>;
    signup: (payload: {
        firstName: string;
        lastName: string;
        username: string;
        email: string;
        password: string;
    }) => Promise<{
        success: boolean;
        message: string;
        requiresEmailVerification: boolean;
        user: User;
    }>;
    resendVerificationEmail: (email: string) => Promise<void>;
    verifyEmailToken: (token: string) => Promise<void>;
    logout: () => Promise<void>;
    refreshUser: (options?: { throwOnError?: boolean; retries?: number; retryDelayMs?: number }) => Promise<User | null>;
    switchWorkspace: (type: 'PERSONAL' | 'TEAM', teamId?: string) => Promise<void>;
    showAuthModal: (mode?: 'login' | 'signup') => void;
    hideAuthModal: () => void;
    authModalState: { open: boolean; mode: 'login' | 'signup' };
    sendOtp: (email: string) => Promise<void>;
    verifyOtp: (email: string, otp: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<User | null>(null);
    const [apiKey, setApiKey] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [authModalState, setAuthModalState] = useState<{ open: boolean; mode: 'login' | 'signup' }>({
        open: false,
        mode: 'login',
    });

    const showAuthModal = (mode: 'login' | 'signup' = 'login') => setAuthModalState({ open: true, mode });
    const hideAuthModal = () => setAuthModalState({ ...authModalState, open: false });

    // Computed: is the current user anonymous?
    const isAnonymous = !user || user.isAnonymous;

    // ──── BRIDGE: sync apiKey with api.ts interceptor ────
    const syncApiKey = (key: string | null) => {
        setApiKey(key);
        setApiKeyRef(key ?? '');
    };

    // Switch workspace
    const switchWorkspace = async (type: 'PERSONAL' | 'TEAM', teamId?: string) => {
        try {
            await axios.post(`${API_URL}/api/v1/workspace/switch`, { type: type.toLowerCase(), teamId });
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
                try {
                    const res = await axios.get(`${API_URL}/api/v1/auth/me`);
                    const userData = res.data;
                    setUser({
                        ...userData,
                        isAnonymous: userData.authProvider === 'ANONYMOUS' || userData.email?.endsWith('@mockurl.local')
                    });
                    setApiKey(null);
                    setApiKeyRef('');
                } catch {
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
            // Try new auth endpoint first
            const res = await axios.post(`${API_URL}/api/v1/auth/anonymous`);
            const { apiKey: newKey, user: newUser } = res.data;
            syncApiKey(newKey);
            setUser({ ...newUser, isAnonymous: true });
        } catch (err) {
            console.error('New auth/anonymous failed, trying old session endpoint', err);
            try {
                // Fallback: old session endpoint for backward compatibility
                const res = await axios.post(`${API_URL}/api/v1/session`);
                if (res.data.success && res.data.session?.apiKey) {
                    const newKey = res.data.session.apiKey;
                    syncApiKey(newKey);
                    setUser({
                        id: res.data.session.userId,
                        email: res.data.session.email,
                        isAnonymous: true,
                        currentWorkspaceType: 'PERSONAL'
                    });
                }
            } catch (fallbackErr) {
                console.error('Failed to create any session', fallbackErr);
            }
        }
    };

    const login = async (email: string, password: string) => {
        const res = await axios.post(`${API_URL}/api/v1/auth/login`, { email, password });
        const { apiKey: newKey, user: loggedInUser } = res.data;
        syncApiKey(newKey);
        setUser({ ...loggedInUser, isAnonymous: false });
        hideAuthModal();
    };

    const signup = async (payload: {
        firstName: string;
        lastName: string;
        username: string;
        email: string;
        password: string;
    }) => {
        const res = await axios.post(`${API_URL}/api/v1/auth/signup`, {
            ...payload,
            conversionToken: isAnonymous ? apiKey : undefined
        });
        return {
            success: Boolean(res.data?.success),
            message: res.data?.message || 'Account created. Please verify your email.',
            requiresEmailVerification: Boolean(res.data?.requiresEmailVerification),
            user: {
                ...res.data.user,
                isAnonymous: false,
                currentWorkspaceType: 'PERSONAL',
            } as User,
        };
    };

    const resendVerificationEmail = async (email: string) => {
        await axios.post(`${API_URL}/api/v1/auth/resend-verification`, { email });
    };

    const verifyEmailToken = async (token: string) => {
        await axios.post(`${API_URL}/api/v1/auth/verify-email`, { token });
    };

    const logout = async () => {
        try {
            await axios.post(`${API_URL}/api/v1/auth/logout`);
        } catch (err) {
            console.error('Logout failed on server', err);
        } finally {
            syncApiKey(null);
            setUser(null);
            await createAnonymousSession();
        }
    };

    const sendOtp = async (email: string): Promise<void> => {
        await axios.post(`${API_URL}/api/v1/auth/send-otp`, { email });
    };

    const verifyOtp = async (email: string, otp: string): Promise<void> => {
        const res = await axios.post(`${API_URL}/api/v1/auth/verify-otp`, { email, otp });
        const { apiKey: newKey, user: loggedInUser } = res.data;
        syncApiKey(newKey);
        setUser({ ...loggedInUser, isAnonymous: false });
        hideAuthModal();
    };

    const refreshUser = async (options?: { throwOnError?: boolean; retries?: number; retryDelayMs?: number }) => {
        const retries = Math.max(0, options?.retries ?? 0);
        const retryDelayMs = Math.max(100, options?.retryDelayMs ?? 350);

        for (let attempt = 0; attempt <= retries; attempt += 1) {
            try {
                const res = await axios.get(`${API_URL}/api/v1/auth/me`);
                const userData = res.data;
                const normalized = {
                    ...userData,
                    isAnonymous: userData.authProvider === 'ANONYMOUS' || userData.email?.endsWith('@mockurl.local')
                } as User;
                setUser(normalized);
                return normalized;
            } catch (err) {
                const isLast = attempt === retries;
                if (isLast) {
                    console.error('Failed to refresh user', err);
                    if (options?.throwOnError) {
                        throw err;
                    }
                    return null;
                }
                await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
            }
        }

        return null;
    };

    return (
        <AuthContext.Provider value={{
            user,
            loading,
            apiKey,
            isAnonymous,
            login,
            signup,
            resendVerificationEmail,
            verifyEmailToken,
            logout,
            refreshUser,
            switchWorkspace,
            showAuthModal,
            hideAuthModal,
            authModalState,
            sendOtp,
            verifyOtp,
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
