import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { FastifyInstance } from 'fastify';
import { getApiKeyCookieName, getApiKeyCookieOptions } from '../lib/auth-cookie.js';
import { prisma } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { sendVerificationEmail } from '../lib/mailer.js';
import { authenticateApiKey, extractApiKey, invalidateUserCache } from '../middleware/auth.middleware.js';
import { generateApiKey, hashApiKey } from '../utils/apiKey.js';

export async function authRoutes(fastify: FastifyInstance) {
    const API_KEY_COOKIE = getApiKeyCookieName();

    // ============================================
    // CREATE ANONYMOUS USER
    // ============================================
    fastify.post('/anonymous', async (_request, reply) => {
        try {
            const anonymousEmail = `anon-${crypto.randomBytes(8).toString('hex')}@mockurl.local`;

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
    // SIGN UP (Email/Password or Conversion)
    // ============================================
    fastify.post('/signup', async (request, reply) => {
        const { firstName, lastName, username, email, password, conversionToken } = request.body as any;

        if (!firstName || !lastName || !username || !email || !password) {
            return reply.code(400).send({ error: 'firstName, lastName, username, email and password are required' });
        }

        try {
            const normalizedEmail = String(email).toLowerCase().trim();
            const normalizedUsername = String(username).toLowerCase().trim();
            const trimmedFirstName = String(firstName).trim();
            const trimmedLastName = String(lastName).trim();

            if (!normalizedUsername || normalizedUsername.length < 3) {
                return reply.code(400).send({ error: 'Username must be at least 3 characters' });
            }

            const existingUser = await prisma.user.findUnique({
                where: { email: normalizedEmail }
            });

            if (existingUser && existingUser.authProvider !== 'ANONYMOUS') {
                return reply.code(409).send({ error: 'Email already registered' });
            }

            const existingUsername = await prisma.user.findUnique({
                where: { username: normalizedUsername }
            });

            if (existingUsername) {
                return reply.code(409).send({ error: 'Username is already taken' });
            }

            const hashedPassword = await bcrypt.hash(password, 10);
            const verificationToken = crypto.randomBytes(32).toString('hex');
            const generatedApiKeyHash = hashApiKey(generateApiKey());

            let user;

            // Conversion logic
            if (conversionToken) {
                const conversionHash = hashApiKey(conversionToken);
                const anonymousUser = await prisma.user.findUnique({
                    where: { apiKeyHash: conversionHash }
                });

                if (anonymousUser && anonymousUser.authProvider === 'ANONYMOUS') {
                    user = await prisma.user.update({
                        where: { id: anonymousUser.id },
                        data: {
                            email: normalizedEmail,
                            password: hashedPassword,
                            username: normalizedUsername,
                            firstName: trimmedFirstName,
                            lastName: trimmedLastName,
                            name: `${trimmedFirstName} ${trimmedLastName}`.trim(),
                            authProvider: 'LOCAL',
                            emailVerified: false,
                            verificationToken,
                            apiKeyHash: generatedApiKeyHash,
                        }
                    });
                    await invalidateUserCache(conversionToken);
                } else {
                    return reply.code(400).send({ error: 'Invalid conversion token' });
                }
            } else {
                user = await prisma.user.create({
                    data: {
                        email: normalizedEmail,
                        password: hashedPassword,
                        username: normalizedUsername,
                        firstName: trimmedFirstName,
                        lastName: trimmedLastName,
                        name: `${trimmedFirstName} ${trimmedLastName}`.trim(),
                        apiKeyHash: generatedApiKeyHash,
                        authProvider: 'LOCAL',
                        emailVerified: false,
                        verificationToken,
                    }
                });
            }

            await sendVerificationEmail(user.email, verificationToken);

            const cookieOptions = getApiKeyCookieOptions();
            reply.clearCookie(API_KEY_COOKIE, {
                path: cookieOptions.path,
                domain: cookieOptions.domain,
                secure: cookieOptions.secure,
                sameSite: cookieOptions.sameSite,
            });

            logger.info('User signed up and pending email verification', { userId: user.id, isConversion: !!conversionToken });

            return {
                success: true,
                message: 'Account created. Please verify your email before signing in.',
                requiresEmailVerification: true,
                user: {
                    id: user.id,
                    email: user.email,
                    username: user.username,
                    firstName: user.firstName,
                    lastName: user.lastName,
                    emailVerified: user.emailVerified,
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
            const user = await prisma.user.findUnique({
                where: { email }
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
                    emailVerified: user.emailVerified,
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
