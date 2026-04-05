import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { FastifyInstance } from 'fastify';
import { sendOtp } from '../auth/otp.js';
import { getApiKeyCookieName, getApiKeyCookieOptions } from '../lib/auth-cookie.js';
import { prisma } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { sendVerificationEmail } from '../lib/mailer.js';
import { getFirstEnforcedTeamForEmail, isSamlAuthEnforcementEnabled, isSamlFeatureEnabled } from '../lib/saml-sso.js';
import { authenticateApiKey, extractApiKey, invalidateUserCache } from '../middleware/auth.middleware.js';
import { generateApiKey, hashApiKey } from '../utils/apiKey.js';

export async function authRoutes(fastify: FastifyInstance) {
    const API_KEY_COOKIE = getApiKeyCookieName();

    // ============================================
    // CREATE ANONYMOUS USER
    // ============================================
    fastify.post('/anonymous', async (_request, reply) => {
        try {
            const anonymousEmail = `anon-${crypto.randomBytes(8).toString('hex')}@mockapi.local`;

            // Use hashing utility
            const apiKey = generateApiKey();
            const apiKeyHash = hashApiKey(apiKey);

            const user = await prisma.user.create({
                data: {
                    email: anonymousEmail,
                    apiKeyHash,
                    authProvider: 'ANONYMOUS',
                    currentWorkspaceType: 'PERSONAL'
                },
                select: {
                    id: true,
                    email: true,
                    authProvider: true
                }
            });

            logger.info('Created anonymous user', { userId: user.id });

            reply.setCookie(API_KEY_COOKIE, apiKey, getApiKeyCookieOptions());
            return {
                apiKey, // Return plaintext to user (ONCE!)
                user: {
                    id: user.id,
                    email: user.email,
                    isAnonymous: true
                }
            };
        } catch (error) {
            logger.error('Failed to create anonymous user', { error });
            return reply.code(500).send({ error: 'Failed to create anonymous user' });
        }
    });

    // ============================================
    // SIGN UP (OTP-first with optional anonymous conversion)
    // ============================================
    fastify.post('/signup', async (request, reply) => {
        const { firstName, lastName, username, email, password, conversionToken } = request.body as any;

        if (!firstName || !lastName || !username || !email) {
            return reply.code(400).send({ error: 'firstName, lastName, username and email are required' });
        }

        try {
            const normalizedEmail = String(email).toLowerCase().trim();
            const normalizedUsername = String(username).toLowerCase().trim();
            const trimmedFirstName = String(firstName).trim();
            const trimmedLastName = String(lastName).trim();
            const normalizedPassword = typeof password === 'string' ? password.trim() : '';

            if (!normalizedUsername || normalizedUsername.length < 3) {
                return reply.code(400).send({ error: 'Username must be at least 3 characters' });
            }

            const existingUserByEmail = await prisma.user.findUnique({
                where: { email: normalizedEmail },
                select: {
                    id: true,
                    authProvider: true,
                    username: true,
                    firstName: true,
                    lastName: true,
                    emailVerified: true,
                    currentWorkspaceType: true,
                    currentTeamId: true,
                }
            });

            let anonymousUser: { id: string; authProvider: string } | null = null;

            if (conversionToken) {
                anonymousUser = await prisma.user.findUnique({
                    where: { apiKeyHash: hashApiKey(conversionToken) },
                    select: { id: true, authProvider: true }
                });

                if (!anonymousUser || anonymousUser.authProvider !== 'ANONYMOUS') {
                    return reply.code(400).send({ error: 'Invalid conversion token' });
                }
            }

            const existingUsername = await prisma.user.findUnique({
                where: { username: normalizedUsername },
                select: { id: true }
            });

            const targetUserId = anonymousUser?.id ?? existingUserByEmail?.id ?? null;
            if (existingUsername && existingUsername.id !== targetUserId) {
                return reply.code(409).send({ error: 'Username is already taken' });
            }

            const generatedApiKeyHash = hashApiKey(generateApiKey());
            const hashedPassword = normalizedPassword ? await bcrypt.hash(normalizedPassword, 10) : null;
            const accountName = `${trimmedFirstName} ${trimmedLastName}`.trim();

            let user;

            if (anonymousUser) {
                if (existingUserByEmail && existingUserByEmail.id !== anonymousUser.id) {
                    return reply.code(409).send({ error: 'Email already registered. Please log in instead.' });
                }

                user = await prisma.user.update({
                    where: { id: anonymousUser.id },
                    data: {
                        email: normalizedEmail,
                        username: normalizedUsername,
                        firstName: trimmedFirstName,
                        lastName: trimmedLastName,
                        name: accountName,
                        authProvider: 'EMAIL_OTP',
                        emailVerified: false,
                        verificationToken: null,
                        apiKeyHash: generatedApiKeyHash,
                        ...(hashedPassword ? { password: hashedPassword } : {}),
                    },
                    select: {
                        id: true,
                        email: true,
                        username: true,
                        firstName: true,
                        lastName: true,
                        name: true,
                        authProvider: true,
                        emailVerified: true,
                        currentWorkspaceType: true,
                        currentTeamId: true,
                    }
                });
                await invalidateUserCache(conversionToken);
            } else if (existingUserByEmail) {
                const profileAlreadyCompleted = Boolean(
                    existingUserByEmail.username || existingUserByEmail.firstName || existingUserByEmail.lastName
                );

                if (profileAlreadyCompleted) {
                    return reply.code(409).send({ error: 'Email already registered. Please log in instead.' });
                }

                user = await prisma.user.update({
                    where: { id: existingUserByEmail.id },
                    data: {
                        username: normalizedUsername,
                        firstName: trimmedFirstName,
                        lastName: trimmedLastName,
                        name: accountName,
                        authProvider: existingUserByEmail.authProvider === 'ANONYMOUS' ? 'EMAIL_OTP' : existingUserByEmail.authProvider,
                        verificationToken: null,
                        apiKeyHash: generatedApiKeyHash,
                        ...(hashedPassword ? { password: hashedPassword } : {}),
                    },
                    select: {
                        id: true,
                        email: true,
                        username: true,
                        firstName: true,
                        lastName: true,
                        name: true,
                        authProvider: true,
                        emailVerified: true,
                        currentWorkspaceType: true,
                        currentTeamId: true,
                    }
                });
            } else {
                user = await prisma.user.create({
                    data: {
                        email: normalizedEmail,
                        username: normalizedUsername,
                        firstName: trimmedFirstName,
                        lastName: trimmedLastName,
                        name: accountName,
                        apiKeyHash: generatedApiKeyHash,
                        authProvider: 'EMAIL_OTP',
                        emailVerified: false,
                        verificationToken: null,
                        ...(hashedPassword ? { password: hashedPassword } : {}),
                    },
                    select: {
                        id: true,
                        email: true,
                        username: true,
                        firstName: true,
                        lastName: true,
                        name: true,
                        authProvider: true,
                        emailVerified: true,
                        currentWorkspaceType: true,
                        currentTeamId: true,
                    }
                });
            }

            const otpResult = await sendOtp({ email: normalizedEmail });
            if (!otpResult.success) {
                const statusCode = otpResult.error?.includes('rate limit') ? 429 : 500;
                return reply.code(statusCode).send({ error: otpResult.error || 'Failed to send OTP' });
            }

            const cookieOptions = getApiKeyCookieOptions();
            reply.clearCookie(API_KEY_COOKIE, {
                path: cookieOptions.path,
                domain: cookieOptions.domain,
                secure: cookieOptions.secure,
                sameSite: cookieOptions.sameSite,
            });

            logger.info('User signed up and OTP sent', { userId: user.id, isConversion: !!conversionToken });

            return {
                success: true,
                message: 'Account created. Enter the 6-digit code sent to your email to finish signing in.',
                requiresOtpVerification: true,
                requiresEmailVerification: false,
                ...(otpResult.devOtp ? { devOtp: otpResult.devOtp } : {}),
                user: {
                    id: user.id,
                    email: user.email,
                    username: user.username,
                    firstName: user.firstName,
                    lastName: user.lastName,
                    name: user.name,
                    authProvider: user.authProvider,
                    emailVerified: user.emailVerified,
                    currentWorkspaceType: user.currentWorkspaceType,
                    currentTeamId: user.currentTeamId,
                }
            };
        } catch (error) {
            logger.error('Signup failed', { error });
            return reply.code(500).send({ error: 'Signup failed' });
        }
    });

    // ============================================
    // LOGIN (Email/Password)
    // ============================================
    fastify.post('/login', async (request, reply) => {
        const { email, password } = request.body as any;

        if (!email || !password) {
            return reply.code(400).send({ error: 'Email and password required' });
        }

        try {
            const normalizedEmail = String(email).toLowerCase().trim();
            if (isSamlFeatureEnabled() && isSamlAuthEnforcementEnabled()) {
                const enforcedTeamId = await getFirstEnforcedTeamForEmail(normalizedEmail);
                if (enforcedTeamId) {
                    return reply.code(403).send({
                        error: 'SSO required for this account',
                        code: 'SSO_REQUIRED',
                        teamId: enforcedTeamId,
                    });
                }
            }

            const user = await prisma.user.findUnique({
                where: { email: normalizedEmail }
            });

            if (!user || !user.password) {
                return reply.code(401).send({ error: 'Invalid credentials' });
            }

            if (!user.emailVerified) {
                return reply.code(403).send({
                    error: 'Please verify your email before logging in',
                    verificationRequired: true,
                    email: user.email
                });
            }

            const isPasswordValid = await bcrypt.compare(password, user.password);

            if (!isPasswordValid) {
                return reply.code(401).send({ error: 'Invalid credentials' });
            }

            // Generate NEW API key on login for security
            const apiKey = generateApiKey();
            const apiKeyHash = hashApiKey(apiKey);

            await prisma.user.update({
                where: { id: user.id },
                data: { apiKeyHash }
            });

            logger.info('User logged in', { userId: user.id });

            reply.setCookie(API_KEY_COOKIE, apiKey, getApiKeyCookieOptions());
            return {
                apiKey,
                user: {
                    id: user.id,
                    email: user.email,
                    name: user.name,
                    username: user.username,
                    firstName: user.firstName,
                    lastName: user.lastName,
                    authProvider: user.authProvider,
                    emailVerified: user.emailVerified,
                    currentWorkspaceType: user.currentWorkspaceType,
                    currentTeamId: user.currentTeamId,
                }
            };
        } catch (error) {
            logger.error('Login failed', { error });
            return reply.code(500).send({ error: 'Login failed' });
        }
    });

    fastify.post('/resend-verification', async (request, reply) => {
        const { email } = request.body as any;
        if (!email) {
            return reply.code(400).send({ error: 'Email is required' });
        }

        try {
            const normalizedEmail = String(email).toLowerCase().trim();
            const user = await prisma.user.findUnique({
                where: { email: normalizedEmail }
            });

            if (!user) {
                return reply.code(404).send({ error: 'Account not found' });
            }

            if (user.emailVerified) {
                return reply.send({ success: true, message: 'Email is already verified' });
            }

            const verificationToken = crypto.randomBytes(32).toString('hex');
            await prisma.user.update({
                where: { id: user.id },
                data: { verificationToken }
            });

            await sendVerificationEmail(user.email, verificationToken);
            return reply.send({
                success: true,
                message: 'Verification email sent. Please check your inbox.'
            });
        } catch (error) {
            logger.error('Resend verification failed', { error });
            return reply.code(500).send({ error: 'Failed to resend verification email' });
        }
    });

    fastify.post('/verify-email', async (request, reply) => {
        const { token } = request.body as any;
        if (!token) {
            return reply.code(400).send({ error: 'Verification token is required' });
        }

        try {
            const user = await prisma.user.findFirst({
                where: { verificationToken: String(token).trim() }
            });

            if (!user) {
                return reply.code(400).send({ error: 'Invalid or expired verification link' });
            }

            await prisma.user.update({
                where: { id: user.id },
                data: {
                    emailVerified: true,
                    verificationToken: null
                }
            });

            return reply.send({
                success: true,
                message: 'Email verified successfully. You can now log in.'
            });
        } catch (error) {
            logger.error('Verify email failed', { error });
            return reply.code(500).send({ error: 'Failed to verify email' });
        }
    });

    // ============================================
    // LOGOUT
    // ============================================
    fastify.post('/logout', {
        preHandler: [authenticateApiKey]
    }, async (request: any, _reply) => {
        const apiKey = extractApiKey(request);
        if (apiKey) {
            await invalidateUserCache(apiKey as string);
        }
        const cookieOptions = getApiKeyCookieOptions();
        _reply.clearCookie(API_KEY_COOKIE, {
            path: cookieOptions.path,
            domain: cookieOptions.domain,
            secure: cookieOptions.secure,
            sameSite: cookieOptions.sameSite,
        });
        logger.info('User logged out', { userId: request.user.id });
        return { success: true };
    });

    // ============================================
    // REGENERATE API KEY
    // ============================================
    fastify.post('/regenerate-key', {
        preHandler: [authenticateApiKey]
    }, async (request: any, reply) => {
        try {
            const userId = request.user.id;
            const oldApiKey = extractApiKey(request);

            if (oldApiKey) {
                await invalidateUserCache(oldApiKey as string);
            }

            const newApiKey = generateApiKey();
            const newApiKeyHash = hashApiKey(newApiKey);

            await prisma.user.update({
                where: { id: userId },
                data: { apiKeyHash: newApiKeyHash }
            });

            reply.setCookie(API_KEY_COOKIE, newApiKey, getApiKeyCookieOptions());
            return {
                apiKey: newApiKey,
                message: 'API key regenerated successfully.'
            };
        } catch (error) {
            logger.error('Failed to regenerate key', { error });
            return reply.code(500).send({ error: 'Failed to regenerate key' });
        }
    });

    // ============================================
    // GET ME
    // ============================================
    fastify.get('/me', {
        preHandler: [authenticateApiKey]
    }, async (request: any, reply) => {
        try {
            const user = await prisma.user.findUnique({
                where: { id: request.user.id },
                select: {
                    id: true,
                    email: true,
                    username: true,
                    firstName: true,
                    lastName: true,
                    name: true,
                    picture: true,
                    authProvider: true,
                    emailVerified: true,
                    currentWorkspaceType: true,
                    currentTeamId: true
                }
            });

            return user;
        } catch (error) {
            logger.error('Failed to fetch profile', { error });
            return reply.code(500).send({ error: 'Failed to fetch profile' });
        }
    });
}
