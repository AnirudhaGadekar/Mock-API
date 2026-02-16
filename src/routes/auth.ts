import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { authenticateApiKey, invalidateUserCache } from '../middleware/auth.middleware.js';
import { generateApiKey, hashApiKey } from '../utils/apiKey.js';

export async function authRoutes(fastify: FastifyInstance) {

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
        const { email, password, name, conversionToken } = request.body as any;

        if (!email || !password) {
            return reply.code(400).send({ error: 'Email and password required' });
        }

        try {
            const existingUser = await prisma.user.findUnique({
                where: { email }
            });

            if (existingUser && existingUser.authProvider !== 'ANONYMOUS') {
                return reply.code(409).send({ error: 'Email already registered' });
            }

            const hashedPassword = await bcrypt.hash(password, 10);

            let user;
            let apiKey;

            // Conversion logic
            if (conversionToken) {
                const conversionHash = hashApiKey(conversionToken);
                const anonymousUser = await prisma.user.findUnique({
                    where: { apiKeyHash: conversionHash }
                });

                if (anonymousUser && anonymousUser.authProvider === 'ANONYMOUS') {
                    apiKey = conversionToken; // Keep same key
                    user = await prisma.user.update({
                        where: { id: anonymousUser.id },
                        data: {
                            email,
                            password: hashedPassword,
                            name,
                            authProvider: 'LOCAL'
                        }
                    });
                } else {
                    return reply.code(400).send({ error: 'Invalid conversion token' });
                }
            } else {
                apiKey = generateApiKey();
                const apiKeyHash = hashApiKey(apiKey);
                user = await prisma.user.create({
                    data: {
                        email,
                        password: hashedPassword,
                        name,
                        apiKeyHash,
                        authProvider: 'LOCAL'
                    }
                });
            }

            logger.info('User signed up', { userId: user.id, isConversion: !!conversionToken });

            return {
                apiKey,
                user: {
                    id: user.id,
                    email: user.email,
                    name: user.name
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

            return {
                apiKey,
                user: {
                    id: user.id,
                    email: user.email,
                    name: user.name
                }
            };
        } catch (error) {
            logger.error('Login failed', { error });
            return reply.code(500).send({ error: 'Login failed' });
        }
    });

    // ============================================
    // LOGOUT
    // ============================================
    fastify.post('/logout', {
        preHandler: [authenticateApiKey]
    }, async (request: any, _reply) => {
        const apiKey = request.headers['x-api-key'] || request.headers.authorization?.replace('Bearer ', '');
        if (apiKey) {
            await invalidateUserCache(apiKey as string);
        }
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
            const oldApiKey = request.headers['x-api-key'] || request.headers.authorization?.replace('Bearer ', '');

            if (oldApiKey) {
                await invalidateUserCache(oldApiKey as string);
            }

            const newApiKey = generateApiKey();
            const newApiKeyHash = hashApiKey(newApiKey);

            await prisma.user.update({
                where: { id: userId },
                data: { apiKeyHash: newApiKeyHash }
            });

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
