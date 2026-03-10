/**
 * OTP Routes — Email One-Time Password authentication (Database-based)
 *
 * POST /api/v2/auth/send-otp   → generate + email OTP
 * POST /api/v2/auth/verify-otp → validate OTP, issue API key + cookie
 */
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getApiKeyCookieName, getCookieOptions, sendOtp, verifyOtp } from '../auth/otp.js';
import { logger } from '../lib/logger.js';
import { getFirstEnforcedTeamForEmail, isSamlAuthEnforcementEnabled, isSamlFeatureEnabled } from '../lib/saml-sso.js';

const sendOtpBodySchema = z.object({
    email: z.string().email(),
});

const verifyOtpBodySchema = z.object({
    email: z.string().email(),
    otp: z.string().regex(/^\d{6}$/, 'OTP must be a 6-digit number'),
});

export async function otpRoutes(fastify: FastifyInstance) {

    // ============================================
    // POST /send-otp
    // ============================================
    fastify.post<{ Body: z.infer<typeof sendOtpBodySchema> }>('/send-otp', {
        schema: {
            body: sendOtpBodySchema,
        },
    }, async (request, reply) => {
        try {
            const { email } = request.body;
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

            const result = await sendOtp({ email: normalizedEmail });

            if (!result.success) {
                const statusCode = result.error?.includes('rate limit') ? 429 : 400;
                return reply.code(statusCode).send({ error: result.error });
            }

            return reply.send({
                success: true,
                message: result.message,
                ...(result.devOtp && { devOtp: result.devOtp })
            });
        } catch (error) {
            logger.error('Send OTP route error', { error });
            return reply.code(500).send({ error: 'Internal server error' });
        }
    });

    // ============================================
    // POST /verify-otp
    // ============================================
    fastify.post<{ Body: z.infer<typeof verifyOtpBodySchema> }>('/verify-otp', {
        schema: {
            body: verifyOtpBodySchema,
        },
    }, async (request, reply) => {
        try {
            const { email, otp } = request.body;
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

            const result = await verifyOtp({ email: normalizedEmail, otp });

            if (!result.success) {
                const statusCode = result.error?.includes('expired') ? 401 : 
                                  result.error?.includes('attempts') ? 401 : 
                                  result.error?.includes('Password login') ? 401 :
                                  result.error?.includes('Security') ? 403 : 400;
                return reply.code(statusCode).send({ 
                    error: result.error,
                    ...(result.attemptsLeft !== undefined && { attemptsLeft: result.attemptsLeft })
                });
            }

            // Set cookie and return success response
            if (result.apiKey) {
                reply.setCookie(getApiKeyCookieName(), result.apiKey, getCookieOptions());
            }

            return reply.send({
                success: true,
                token: result.token,
                apiKey: result.apiKey,
                user: result.user
            });
        } catch (error) {
            logger.error('Verify OTP route error', { error });
            return reply.code(500).send({ error: 'Internal server error' });
        }
    });
}
