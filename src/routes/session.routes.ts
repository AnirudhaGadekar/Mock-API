/**
 * Session routes — Beeceptor-style zero-signup auth.
 *
 * POST /api/v1/session       → auto-create anonymous user, return API key
 * GET  /api/v1/session/me    → validate session and return user info
 */
import crypto from 'crypto';
import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { hashApiKey } from '../middleware/auth.middleware.js';
import { checkRateLimit } from '../middleware/rate-limit.middleware.js';

function generateApiKey(): string {
    return crypto.randomBytes(32).toString('hex');
}

function generateAnonEmail(): string {
    const id = crypto.randomBytes(6).toString('hex');
    return `anon-${id}@mockurl.local`;
}

export const sessionRoutes: FastifyPluginAsync = async (fastify) => {
    /**
     * POST /api/v1/session
     * Auto-create an anonymous user and return their API key.
     * No auth required — this IS the signup.
     */
    fastify.post('/', async (_request, reply) => {
        try {
            const rateLimit = await checkRateLimit(`session:create:${reply.request.ip}`, 20, 60);
            if (!rateLimit.allowed) {
                return reply.status(429).send({
                    success: false,
                    error: {
                        code: 'RATE_LIMIT_EXCEEDED',
                        message: 'Too many session creation requests. Please try again later.',
                        retryAfter: Math.ceil((rateLimit.resetAt.getTime() - Date.now()) / 1000),
                    },
                    timestamp: new Date().toISOString(),
                });
            }

            const apiKey = generateApiKey();
            const apiKeyHash = hashApiKey(apiKey);
            const email = generateAnonEmail();

            const user = await prisma.user.create({
                data: {
                    email,
                    apiKeyHash,
                },
                select: {
                    id: true,
                    email: true,
                    apiKeyHash: true,
                },
            });

            logger.info('Anonymous session created', { userId: user.id });

            return reply.status(201).send({
                success: true,
                session: {
                    apiKey, // RETURN RAW KEY ONCE
                    userId: user.id,
                    email: user.email,
                },
                timestamp: new Date().toISOString(),
            });
        } catch (error) {
            logger.error('Failed to create session', { error });
            return reply.status(500).send({
                success: false,
                error: {
                    code: 'SESSION_CREATE_FAILED',
                    message: 'Failed to create session',
                },
                timestamp: new Date().toISOString(),
            });
        }
    });

    /**
     * GET /api/v1/session/me
     * Validate an existing API key and return user info.
     * Requires X-API-Key header.
     */
    fastify.get('/me', async (request, reply) => {
        try {
            const apiKey = request.headers['x-api-key'] as string | undefined;

            if (!apiKey) {
                return reply.status(401).send({
                    success: false,
                    error: {
                        code: 'NO_SESSION',
                        message: 'No API key provided',
                    },
                    timestamp: new Date().toISOString(),
                });
            }

            const apiKeyHash = hashApiKey(apiKey);

            const user = await prisma.user.findUnique({
                where: { apiKeyHash },
                select: {
                    id: true,
                    email: true,
                    _count: { select: { endpoints: true } },
                },
            });

            if (!user) {
                return reply.status(401).send({
                    success: false,
                    error: {
                        code: 'INVALID_SESSION',
                        message: 'Invalid or expired session',
                    },
                    timestamp: new Date().toISOString(),
                });
            }

            return reply.status(200).send({
                success: true,
                user: {
                    id: user.id,
                    email: user.email,
                    endpointCount: user._count.endpoints,
                },
                timestamp: new Date().toISOString(),
            });
        } catch (error) {
            logger.error('Failed to validate session', { error });
            return reply.status(500).send({
                success: false,
                error: {
                    code: 'INTERNAL_ERROR',
                    message: 'Failed to validate session',
                },
                timestamp: new Date().toISOString(),
            });
        }
    });
};
