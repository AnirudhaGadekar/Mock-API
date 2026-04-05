import axios from 'axios';
import React, { createContext, useContext, useEffect, useState } from 'react';
import { API_BASE_URL, setApiKeyRef } from '../lib/api';

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

interface SignupPayload {
    firstName: string;
    lastName: string;
    username: string;
    email: string;
}

interface SignupResult {
    success: boolean;
    message: string;
    requiresOtpVerification: boolean;
    requiresEmailVerification: boolean;
    devOtp?: string;
    user: User;
}

interface OtpSendResult {
    success: boolean;
    message?: string;
    devOtp?: string;
}

interface AuthContextType {
    user: User | null;
    loading: boolean;
    apiKey: string | null;
    isAnonymous: boolean;
    signup: (payload: SignupPayload) => Promise<SignupResult>;
    resendVerificationEmail: (email: string) => Promise<void>;
    verifyEmailToken: (token: string) => Promise<void>;
    logout: () => Promise<void>;
    refreshUser: (options?: { throwOnError?: boolean; retries?: number; retryDelayMs?: number }) => Promise<User | null>;
    switchWorkspace: (type: 'PERSONAL' | 'TEAM', teamId?: string) => Promise<void>;
    showAuthModal: (mode?: 'login' | 'signup') => void;
    hideAuthModal: () => void;
    authModalState: { open: boolean; mode: 'login' | 'signup' };
    sendOtp: (email: string) => Promise<OtpSendResult>;
    verifyOtp: (email: string, otp: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function normalizeUser(userData: Partial<User> & { email?: string; authProvider?: string }): User {
    const isAnonymous =
        userData.authProvider === 'ANONYMOUS' ||
        Boolean(userData.email && userData.email.endsWith('@mockapi.local'));

    return {
        id: userData.id ?? '',
        email: userData.email ?? '',
        username: userData.username,
        firstName: userData.firstName,
        lastName: userData.lastName,
        name: userData.name,
        picture: userData.picture,
        authProvider: userData.authProvider,
        emailVerified: userData.emailVerified,
        currentWorkspaceType: userData.currentWorkspaceType ?? 'PERSONAL',
        currentTeamId: userData.currentTeamId,
        isAnonymous,
    };
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<User | null>(null);
    const [apiKey, setApiKey] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [authModalState, setAuthModalState] = useState<{ open: boolean; mode: 'login' | 'signup' }>({
        open: false,
        mode: 'login',
    });

    const showAuthModal = (mode: 'login' | 'signup' = 'login') => setAuthModalState({ open: true, mode });
    const hideAuthModal = () => setAuthModalState((current) => ({ ...current, open: false }));

    const isAnonymous = !user || user.isAnonymous;

    const syncApiKey = (key: string | null) => {
        setApiKey(key);
        setApiKeyRef(key ?? '');
    };

    const switchWorkspace = async (type: 'PERSONAL' | 'TEAM', teamId?: string) => {
        try {
            await axios.post(`${API_URL}/api/v2/workspace/switch`, { type: type.toLowerCase(), teamId });
            await refreshUser();
        } catch (err) {
            console.error('Failed to switch workspace', err);
            throw err;
        }
    };

    useEffect(() => {
        const initAuth = async () => {
            try {
                try {
                    const res = await axios.get(`${API_URL}/api/v2/auth/me`);
                    setUser(normalizeUser(res.data));
                    syncApiKey(null);
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
            const res = await axios.post(`${API_URL}/api/v2/auth/anonymous`);
            const { apiKey: newKey, user: newUser } = res.data;
            syncApiKey(newKey);
            setUser(normalizeUser({ ...newUser, isAnonymous: true, currentWorkspaceType: 'PERSONAL' }));
        } catch (err) {
            console.error('New auth/anonymous failed, trying old session endpoint', err);
            try {
                const res = await axios.post(`${API_URL}/api/v2/session`);
                if (res.data.success && res.data.session?.apiKey) {
                    const newKey = res.data.session.apiKey;
                    syncApiKey(newKey);
                    setUser(normalizeUser({
                        id: res.data.session.userId,
                        email: res.data.session.email,
                        authProvider: 'ANONYMOUS',
                        currentWorkspaceType: 'PERSONAL',
                    }));
                }
            } catch (fallbackErr) {
                console.error('Failed to create any session', fallbackErr);
            }
        }
    };

    const signup = async (payload: SignupPayload): Promise<SignupResult> => {
        const res = await axios.post(`${API_URL}/api/v2/auth/signup`, {
            ...payload,
            conversionToken: isAnonymous ? apiKey : undefined,
        });

        return {
            success: Boolean(res.data?.success),
            message: res.data?.message || 'Account created. Check your email for the login code.',
            requiresOtpVerification: Boolean(res.data?.requiresOtpVerification),
            requiresEmailVerification: Boolean(res.data?.requiresEmailVerification),
            devOtp: res.data?.devOtp,
            user: normalizeUser(res.data?.user ?? {}),
        };
    };

    const resendVerificationEmail = async (email: string) => {
        await axios.post(`${API_URL}/api/v2/auth/resend-verification`, { email });
    };

    const verifyEmailToken = async (token: string) => {
        await axios.post(`${API_URL}/api/v2/auth/verify-email`, { token });
    };

    const logout = async () => {
        try {
            await axios.post(`${API_URL}/api/v2/auth/logout`);
        } catch (err) {
            console.error('Logout failed on server', err);
        } finally {
            syncApiKey(null);
            setUser(null);
            await createAnonymousSession();
        }
    };

    const sendOtp = async (email: string): Promise<OtpSendResult> => {
        const res = await axios.post(`${API_URL}/api/v2/auth/send-otp`, { email });
        return {
            success: Boolean(res.data?.success),
            message: res.data?.message,
            devOtp: res.data?.devOtp,
        };
    };

    const verifyOtp = async (email: string, otp: string): Promise<void> => {
        const res = await axios.post(`${API_URL}/api/v2/auth/verify-otp`, { email, otp });
        const { apiKey: newKey, user: loggedInUser } = res.data;
        syncApiKey(newKey);
        setUser(normalizeUser(loggedInUser));
        hideAuthModal();
    };

    const refreshUser = async (options?: { throwOnError?: boolean; retries?: number; retryDelayMs?: number }) => {
        const retries = Math.max(0, options?.retries ?? 0);
        const retryDelayMs = Math.max(100, options?.retryDelayMs ?? 350);

        for (let attempt = 0; attempt <= retries; attempt += 1) {
            try {
                const res = await axios.get(`${API_URL}/api/v2/auth/me`);
                const normalized = normalizeUser(res.data);
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
        <AuthContext.Provider
            value={{
                user,
                loading,
                apiKey,
                isAnonymous,
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
            }}
        >
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
