import axios from 'axios';
import crypto from 'crypto';
import { FastifyInstance } from 'fastify';
import { getApiKeyCookieName, getApiKeyCookieOptions } from '../lib/auth-cookie.js';
import { prisma } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { redis } from '../lib/redis.js';
import { generateApiKey, hashApiKey } from '../utils/apiKey.js';

function isDeployedEnvironment(): boolean {
    return (
        process.env.NODE_ENV === 'production' ||
        process.env.RENDER === 'true' ||
        Boolean(process.env.RENDER_EXTERNAL_URL)
    );
}

function isLocalhostLike(hostOrUrl: string | undefined): boolean {
    if (!hostOrUrl) return false;
    let candidate = hostOrUrl.trim();
    if (!candidate) return false;
    if (!candidate.includes('://')) {
        candidate = `http://${candidate}`;
    }
    try {
        const parsed = new URL(candidate);
        const host = parsed.hostname.toLowerCase();
        return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.localhost');
    } catch {
        return false;
    }
}
function getDefaultApiBaseUrl(): string {
    if (isDeployedEnvironment()) {
        return process.env.RENDER_EXTERNAL_URL || 'https://mock-url-9rwn.onrender.com';
    }
    return 'http://localhost:3000';
}

function getDefaultFrontendUrl(): string {
    if (isDeployedEnvironment()) {
        return process.env.RENDER_EXTERNAL_URL || 'https://mock-url-9rwn.onrender.com';
    }
    return 'http://localhost:5173';
}

const DEFAULT_API_BASE_URL = getDefaultApiBaseUrl();

// OAuth credentials from env
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || `${DEFAULT_API_BASE_URL}/api/v1/oauth/google/callback`;

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const GITHUB_REDIRECT_URI = process.env.GITHUB_REDIRECT_URI || `${DEFAULT_API_BASE_URL}/api/v1/oauth/github/callback`;

const FRONTEND_URL = process.env.FRONTEND_URL || getDefaultFrontendUrl();

const isDeployed = isDeployedEnvironment();
if (isDeployed && !process.env.FRONTEND_URL) {
    logger.warn('FRONTEND_URL not set in production. OAuth redirects may fail.');
}
if (isDeployed && (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET)) {
    logger.error('CONFIG ERROR: Missing Google OAuth credentials in deployed environment.');
}
if (isDeployed && (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET)) {
    logger.error('CONFIG ERROR: Missing GitHub OAuth credentials in deployed environment.');
}
if (isDeployed && isLocalhostLike(GOOGLE_REDIRECT_URI)) {
    logger.error('CONFIG ERROR: GOOGLE_REDIRECT_URI points to localhost in deployed environment.', { GOOGLE_REDIRECT_URI });
}
if (isDeployed && isLocalhostLike(GITHUB_REDIRECT_URI)) {
    logger.error('CONFIG ERROR: GITHUB_REDIRECT_URI points to localhost in deployed environment.', { GITHUB_REDIRECT_URI });
}
if (isDeployed && isLocalhostLike(FRONTEND_URL)) {
    logger.error('CONFIG ERROR: FRONTEND_URL points to localhost in deployed environment.', { FRONTEND_URL });
}
const API_KEY_COOKIE = getApiKeyCookieName();

function getDisplayNameFromGoogleUser(googleUser: any): string {
    if (googleUser?.name && typeof googleUser.name === 'string') {
        return googleUser.name;
    }
    const given = typeof googleUser?.given_name === 'string' ? googleUser.given_name : '';
    const family = typeof googleUser?.family_name === 'string' ? googleUser.family_name : '';
    const combined = `${given} ${family}`.trim();
    if (combined) {
        return combined;
    }
    if (typeof googleUser?.email === 'string' && googleUser.email.includes('@')) {
        return googleUser.email.split('@')[0];
    }
    return 'Google User';
}

/**
 * Helper to join a team via invite token
 */
async function handleTeamInvite(userId: string, inviteToken: string) {
    try {
        const invite = await prisma.teamInvite.findUnique({
            where: { token: inviteToken }
        });

        if (!invite) return;
        if (invite.expiresAt < new Date()) return;
        if (invite.maxUses && invite.usedCount >= invite.maxUses) return;

        // Check if already a member
        const existing = await prisma.teamMember.findUnique({
            where: { userId_teamId: { userId, teamId: invite.teamId } }
        });
        if (existing) return;

        await prisma.$transaction([
            prisma.teamMember.create({
                data: { teamId: invite.teamId, userId, role: 'MEMBER' }
            }),
            prisma.teamInvite.update({
                where: { id: invite.id },
                data: { usedCount: { increment: 1 } }
            })
        ]);
        logger.info('User joined team via OAuth invite', { userId, teamId: invite.teamId });
    } catch (err) {
        logger.error('Failed to handle team invite in OAuth', { err, userId, inviteToken });
    }
}

export async function oauthRoutes(fastify: FastifyInstance) {

    // ============================================
    // GOOGLE OAUTH
    // ============================================
    fastify.get('/google', async (request: any, reply) => {
        const { conversionToken, inviteToken } = request.query;
        const state = crypto.randomBytes(32).toString('hex');

        // Store state and tokens in Redis (10m TTL)
        await redis.setex(`oauth:state:${state}`, 600, JSON.stringify({ conversionToken, inviteToken }));

        const rootUrl = 'https://accounts.google.com/o/oauth2/v2/auth';
        const options = {
            redirect_uri: GOOGLE_REDIRECT_URI,
            client_id: GOOGLE_CLIENT_ID!,
            access_type: 'offline',
            response_type: 'code',
            prompt: 'consent',
            scope: [
                'https://www.googleapis.com/auth/userinfo.profile',
                'https://www.googleapis.com/auth/userinfo.email',
            ].join(' '),
            state,
        };

        const qs = new URLSearchParams(options);
        return reply.redirect(`${rootUrl}?${qs.toString()}`);
    });

    fastify.get('/google/callback', async (request: any, reply) => {
        const { code, state } = request.query;

        const savedStateData = await redis.get(`oauth:state:${state}`);
        if (!savedStateData) return reply.code(400).send({ error: 'Invalid or expired state' });
        const { conversionToken, inviteToken } = JSON.parse(savedStateData);
        await redis.del(`oauth:state:${state}`);

        try {
            const tokenRes = await axios.post('https://oauth2.googleapis.com/token', {
                code,
                client_id: GOOGLE_CLIENT_ID,
                client_secret: GOOGLE_CLIENT_SECRET,
                redirect_uri: GOOGLE_REDIRECT_URI,
                grant_type: 'authorization_code',
            });

            const { id_token, access_token } = tokenRes.data;
            const userRes = await axios.get(`https://www.googleapis.com/oauth2/v1/userinfo?alt=json&access_token=${access_token}`, {
                headers: { Authorization: `Bearer ${id_token}` }
            });

            const googleUser = userRes.data;
            if (!googleUser?.email) {
                logger.error('Google OAuth response missing email');
                return reply.redirect(`${FRONTEND_URL}/auth/error?message=Google account has no email`);
            }
            const displayName = getDisplayNameFromGoogleUser(googleUser);
            let user = await prisma.user.findUnique({ where: { email: googleUser.email } });
            let apiKey;

            if (user) {
                apiKey = generateApiKey();
                const apiKeyHash = hashApiKey(apiKey);
                user = await prisma.user.update({
                    where: { id: user.id },
                    data: {
                        googleId: googleUser.id,
                        picture: googleUser.picture,
                        name: displayName,
                        apiKeyHash,
                        authProvider: 'GOOGLE'
                    }
                });
            } else {
                if (conversionToken) {
                    const conversionHash = hashApiKey(conversionToken);
                    const anonUser = await prisma.user.findUnique({ where: { apiKeyHash: conversionHash } });
                    if (anonUser && anonUser.authProvider === 'ANONYMOUS') {
                        apiKey = conversionToken;
                        user = await prisma.user.update({
                            where: { id: anonUser.id },
                            data: {
                                email: googleUser.email,
                                googleId: googleUser.id,
                                name: displayName,
                                picture: googleUser.picture,
                                authProvider: 'GOOGLE',
                                emailVerified: googleUser.verified_email
                            }
                        });
                    }
                }

                if (!user) {
                    apiKey = generateApiKey();
                    const apiKeyHash = hashApiKey(apiKey);
                    user = await prisma.user.create({
                        data: {
                            email: googleUser.email,
                            googleId: googleUser.id,
                            name: displayName,
                            picture: googleUser.picture,
                            authProvider: 'GOOGLE',
                            apiKeyHash,
                            emailVerified: googleUser.verified_email
                        }
                    });
                }
            }

            if (inviteToken) {
                await handleTeamInvite(user.id, inviteToken);
            }

            if (apiKey) {
                reply.setCookie(API_KEY_COOKIE, apiKey, getApiKeyCookieOptions());
            }
            return reply.redirect(`${FRONTEND_URL}/auth/callback`);
        } catch (error) {
            logger.error('Google OAuth failed', error);
            return reply.redirect(`${FRONTEND_URL}/auth/error?message=Google login failed`);
        }
    });

    // ============================================
    // GITHUB OAUTH
    // ============================================
    fastify.get('/github', async (request: any, reply) => {
        const { conversionToken, inviteToken } = request.query;
        const state = crypto.randomBytes(32).toString('hex');
        await redis.setex(`oauth:state:${state}`, 600, JSON.stringify({ conversionToken, inviteToken }));

        const rootUrl = 'https://github.com/login/oauth/authorize';
        const options = {
            client_id: GITHUB_CLIENT_ID!,
            redirect_uri: GITHUB_REDIRECT_URI,
            scope: 'read:user user:email',
            state,
        };

        const qs = new URLSearchParams(options);
        return reply.redirect(`${rootUrl}?${qs.toString()}`);
    });

    fastify.get('/github/callback', async (request: any, reply) => {
        const { code, state } = request.query;

        const savedStateData = await redis.get(`oauth:state:${state}`);
        if (!savedStateData) return reply.code(400).send({ error: 'Invalid or expired state' });
        const { conversionToken, inviteToken } = JSON.parse(savedStateData);
        await redis.del(`oauth:state:${state}`);

        try {
            const tokenRes = await axios.post('https://github.com/login/oauth/access_token', {
                client_id: GITHUB_CLIENT_ID,
                client_secret: GITHUB_CLIENT_SECRET,
                code,
            }, {
                headers: { Accept: 'application/json' }
            });

            const { access_token } = tokenRes.data;
            const userRes = await axios.get('https://api.github.com/user', {
                headers: { Authorization: `token ${access_token}` }
            });
            const githubUser = userRes.data;

            let email = githubUser.email;
            if (!email) {
                const emailsRes = await axios.get('https://api.github.com/user/emails', {
                    headers: { Authorization: `token ${access_token}` }
                });
                const primary = emailsRes.data.find((e: any) => e.primary);
                email = primary?.email;
            }
            if (!email) {
                logger.error('GitHub OAuth response missing email');
                return reply.redirect(`${FRONTEND_URL}/auth/error?message=GitHub account has no public email`);
            }

            let user = await prisma.user.findUnique({ where: { email } });
            let apiKey;

            if (user) {
                apiKey = generateApiKey();
                const apiKeyHash = hashApiKey(apiKey);
                user = await prisma.user.update({
                    where: { id: user.id },
                    data: {
                        githubId: githubUser.id.toString(),
                        name: githubUser.name || githubUser.login,
                        picture: githubUser.avatar_url,
                        apiKeyHash,
                        authProvider: 'GITHUB'
                    }
                });
            } else {
                if (conversionToken) {
                    const conversionHash = hashApiKey(conversionToken);
                    const anonUser = await prisma.user.findUnique({ where: { apiKeyHash: conversionHash } });
                    if (anonUser && anonUser.authProvider === 'ANONYMOUS') {
                        apiKey = conversionToken;
                        user = await prisma.user.update({
                            where: { id: anonUser.id },
                            data: {
                                email,
                                githubId: githubUser.id.toString(),
                                name: githubUser.name || githubUser.login,
                                picture: githubUser.avatar_url,
                                authProvider: 'GITHUB',
                                emailVerified: true
                            }
                        });
                    }
                }

                if (!user) {
                    apiKey = generateApiKey();
                    const apiKeyHash = hashApiKey(apiKey);
                    user = await prisma.user.create({
                        data: {
                            email,
                            githubId: githubUser.id.toString(),
                            name: githubUser.name || githubUser.login,
                            picture: githubUser.avatar_url,
                            authProvider: 'GITHUB',
                            apiKeyHash,
                            emailVerified: true
                        }
                    });
                }
            }

            if (inviteToken) {
                await handleTeamInvite(user.id, inviteToken);
            }

            if (apiKey) {
                reply.setCookie(API_KEY_COOKIE, apiKey, getApiKeyCookieOptions());
            }
            return reply.redirect(`${FRONTEND_URL}/auth/callback`);
        } catch (error) {
            logger.error('GitHub OAuth failed', error);
            return reply.redirect(`${FRONTEND_URL}/auth/error?message=GitHub login failed`);
        }
    });
}

