/**
 * OTP Authentication Module — Database-based Implementation
 * 
 * Provides secure one-time password authentication with database storage,
 * comprehensive error handling, and production-ready security.
 */

import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { getDeactivatedAccountError, isDeactivatedAccount } from '../lib/account-status.js';
import { prisma } from '../lib/db.js';
import { ApiError } from '../lib/errors.js';
import { getApiKeyCookieName as getSharedApiKeyCookieName, getApiKeyCookieOptions } from '../lib/auth-cookie.js';
import { logger } from '../lib/logger.js';
import { sendOtpEmail } from '../lib/mailer.js';
import { generateApiKey, hashApiKey } from '../utils/apiKey.js';

// Environment variable validation at module load time
const MISSING_ENV_VARS: string[] = [];

if (!process.env.OTP_SECRET) {
    MISSING_ENV_VARS.push('OTP_SECRET');
}

if (!process.env.JWT_SECRET) {
    MISSING_ENV_VARS.push('JWT_SECRET');
}

if (!process.env.JWT_EXPIRY && !process.env.JWT_EXPIRES_IN) {
    MISSING_ENV_VARS.push('JWT_EXPIRY or JWT_EXPIRES_IN');
}

if (MISSING_ENV_VARS.length > 0) {
    throw new Error(`❌ Missing required environment variables: ${MISSING_ENV_VARS.join(', ')}`);
}

// Configuration constants
const OTP_SECRET = process.env.OTP_SECRET!;
const JWT_SECRET = process.env.JWT_SECRET!;
const JWT_EXPIRY = process.env.JWT_EXPIRY ?? process.env.JWT_EXPIRES_IN ?? '7d';
const OTP_TTL_MINUTES = 5; // 5 minutes
const MAX_VERIFY_ATTEMPTS = 5; // lockout after 5 wrong guesses

/**
 * Interface for JWT payload
 */
export interface JWTPayload {
    sub: string; // user ID
    email: string;
    iat?: number;
    exp?: number;
}

/**
 * Interface for API response
 */
export interface ApiResponse {
    success: boolean;
    error?: string;
    code?: string;
    statusCode?: number;
    [key: string]: any;
}

/**
 * Interface for OTP send request
 */
export interface SendOtpRequest {
    email: string;
}

/**
 * Interface for OTP verify request
 */
export interface VerifyOtpRequest {
    email: string;
    otp: string;
}

/**
 * Constant-time HMAC hash of an OTP string
 */
function hashOtp(otp: string): string {
    return crypto
        .createHmac('sha256', OTP_SECRET)
        .update(otp)
        .digest('hex');
}

/**
 * Constant-time string comparison to prevent timing attacks
 */
function safeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Validate email format
 */
function isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Generate JWT token for authenticated user
 */
function generateJwtToken(userId: string, email: string): string {
    const payload: Omit<JWTPayload, 'iat' | 'exp'> = {
        sub: userId,
        email,
    };
    
    return jwt.sign(payload, JWT_SECRET, {
        expiresIn: JWT_EXPIRY,
    } as jwt.SignOptions);
}

/**
 * Send OTP to user's email
 * 
 * @param request - OTP send request containing email
 * @returns Promise resolving to API response
 */
export async function sendOtp(request: SendOtpRequest): Promise<ApiResponse> {
    try {
        const { email } = request;
        const normalizedEmail = email?.toLowerCase().trim() ?? '';
        const deactivatedAccountError = getDeactivatedAccountError();

        // Input validation
        if (!normalizedEmail || !isValidEmail(normalizedEmail)) {
            return {
                success: false,
                error: 'Valid email required',
            };
        }

        const existingUser = await prisma.user.findUnique({
            where: { email: normalizedEmail },
            select: {
                id: true,
                accountStatus: true,
                deactivatedAt: true,
            },
        });

        if (isDeactivatedAccount(existingUser)) {
            return {
                success: false,
                error: deactivatedAccountError.message,
                code: deactivatedAccountError.code,
                statusCode: 403,
            };
        }

        // Rate limiting check using existing OTP records
        const existingOtp = await prisma.otp.findFirst({
            where: {
                email: normalizedEmail,
                createdAt: {
                    gte: new Date(Date.now() - 10 * 60 * 1000), // Within last 10 minutes
                },
            },
            orderBy: {
                createdAt: 'desc'
            }
        });

        if (existingOtp && existingOtp.attempts >= 3) {
            logger.warn('OTP rate limit exceeded', { email: normalizedEmail, attempts: existingOtp.attempts });
            return {
                success: false,
                error: 'Too many OTP requests. Please wait before requesting another code.',
            };
        }

        // Generate OTP
        const otp = crypto.randomInt(100000, 999999).toString();
        const otpHash = hashOtp(otp);

        // Delete any existing OTP records for this email
        await prisma.otp.deleteMany({
            where: { email: normalizedEmail }
        });

        // Store new OTP in database
        await prisma.otp.create({
            data: {
                email: normalizedEmail,
                hash: otpHash,
                attempts: 0,
                expiresAt: new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000),
            },
        });

        await sendOtpEmail(normalizedEmail, otp);
        logger.info('OTP generated', { email: normalizedEmail });

        const response: ApiResponse = {
            success: true,
            message: 'OTP sent. Check your inbox.',
        };

        // Dev bypass for testing
        if (process.env.NODE_ENV !== 'production' && process.env.AUTH_MODE === 'dev-bypass') {
            response.devOtp = otp;
        }

        return response;
    } catch (error) {
        logger.error('Failed to send OTP', { error });

        if (error instanceof ApiError) {
            return {
                success: false,
                error: error.message,
                code: error.code,
                statusCode: error.statusCode,
            };
        }

        return {
            success: false,
            error: 'Failed to send OTP. Please try again.',
        };
    }
}

/**
 * Verify OTP and authenticate user
 * 
 * @param request - OTP verify request containing email and OTP
 * @returns Promise resolving to API response with JWT token on success
 */
export async function verifyOtp(request: VerifyOtpRequest): Promise<ApiResponse> {
    try {
        const { email, otp } = request;
        const normalizedEmail = email?.toLowerCase().trim() ?? '';

        // Input validation
        if (!normalizedEmail || !otp) {
            return {
                success: false,
                error: 'Email and OTP are required',
            };
        }

        if (!isValidEmail(normalizedEmail)) {
            return {
                success: false,
                error: 'Valid email required',
            };
        }

        if (!/^\d{6}$/.test(otp)) {
            return {
                success: false,
                error: 'OTP must be a 6-digit number',
            };
        }

        // Production security check
        if (process.env.NODE_ENV === 'production' && otp === '000000') {
            logger.error('CRITICAL: Static OTP 000000 attempt blocked in production', { email });
            return {
                success: false,
                error: 'Security violation',
            };
        }

        const incomingHash = hashOtp(otp);

        // Find OTP record
        const otpRecord = await prisma.otp.findFirst({
            where: { email: normalizedEmail },
            orderBy: { createdAt: 'desc' }
        });

        if (!otpRecord) {
            return {
                success: false,
                error: 'OTP has expired. Please request a new one.',
            };
        }

        // Check if OTP has expired
        if (new Date() > otpRecord.expiresAt) {
            await prisma.otp.delete({ where: { id: otpRecord.id } });
            return {
                success: false,
                error: 'OTP has expired. Please request a new one.',
            };
        }

        // Check if max attempts exceeded
        if (otpRecord.attempts >= MAX_VERIFY_ATTEMPTS) {
            await prisma.otp.delete({ where: { id: otpRecord.id } });
            logger.warn('OTP max attempts exceeded', { email: normalizedEmail });
            return {
                success: false,
                error: 'Too many failed attempts. Please request a new OTP.',
            };
        }

        // Compare hash
        if (!safeCompare(incomingHash, otpRecord.hash)) {
            // Increment attempts
            await prisma.otp.update({
                where: { id: otpRecord.id },
                data: { attempts: otpRecord.attempts + 1 }
            });

            logger.info('OTP verify failed: invalid code', { 
                email: normalizedEmail, 
                attempt: otpRecord.attempts + 1 
            });
            
            return {
                success: false,
                error: 'Invalid OTP.',
                attemptsLeft: MAX_VERIFY_ATTEMPTS - (otpRecord.attempts + 1),
            };
        }

        // OTP verified successfully - delete record and authenticate
        await prisma.otp.delete({ where: { id: otpRecord.id } });
        
        return await authenticateUser(normalizedEmail);
    } catch (error) {
        logger.error('OTP verification failed', { error });
        return {
            success: false,
            error: 'OTP verification failed. Please try again.',
        };
    }
}

/**
 * Authenticate user and issue JWT token
 * 
 * @param email - Verified user email
 * @returns Promise resolving to API response with JWT token
 */
async function authenticateUser(email: string): Promise<ApiResponse> {
    try {
        const deactivatedAccountError = getDeactivatedAccountError();

        // Find or create user
        let user = await prisma.user.findUnique({ 
            where: { email },
            select: {
                id: true,
                email: true,
                name: true,
                authProvider: true,
                password: true,
                username: true,
                firstName: true,
                lastName: true,
                picture: true,
                accountStatus: true,
                deactivatedAt: true,
                emailVerified: true,
                currentWorkspaceType: true,
                currentTeamId: true,
            },
        });

        const newApiKey = generateApiKey();
        const newApiKeyHash = hashApiKey(newApiKey);

        if (user) {
            if (isDeactivatedAccount(user)) {
                return {
                    success: false,
                    error: deactivatedAccountError.message,
                    code: deactivatedAccountError.code,
                    statusCode: 403,
                };
            }

            const nextAuthProvider =
                user.authProvider === 'ANONYMOUS' || user.authProvider === 'LOCAL'
                    ? 'EMAIL_OTP'
                    : user.authProvider;

            // Update existing user
            user = await prisma.user.update({
                where: { id: user.id },
                data: {
                    apiKeyHash: newApiKeyHash,
                    emailVerified: true,
                    authProvider: nextAuthProvider,
                },
                select: {
                    id: true,
                    email: true,
                    name: true,
                    authProvider: true,
                    password: true,
                    username: true,
                    firstName: true,
                    lastName: true,
                    picture: true,
                    accountStatus: true,
                    deactivatedAt: true,
                    emailVerified: true,
                    currentWorkspaceType: true,
                    currentTeamId: true,
                },
            });
        } else {
            // Create new user
            user = await prisma.user.create({
                data: {
                    email,
                    authProvider: 'EMAIL_OTP',
                    apiKeyHash: newApiKeyHash,
                    emailVerified: true,
                },
                select: {
                    id: true,
                    email: true,
                    name: true,
                    authProvider: true,
                    password: true,
                    username: true,
                    firstName: true,
                    lastName: true,
                    picture: true,
                    accountStatus: true,
                    deactivatedAt: true,
                    emailVerified: true,
                    currentWorkspaceType: true,
                    currentTeamId: true,
                },
            });
        }

        // Generate JWT token
        const jwtToken = generateJwtToken(user.id, user.email);

        logger.info('User authenticated via OTP', { userId: user.id, email });

        return {
            success: true,
            token: jwtToken,
            apiKey: newApiKey,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                username: user.username,
                firstName: user.firstName,
                lastName: user.lastName,
                picture: user.picture,
                authProvider: user.authProvider,
                emailVerified: user.emailVerified,
                currentWorkspaceType: user.currentWorkspaceType,
                currentTeamId: user.currentTeamId,
                isAnonymous: false,
            },
        };
    } catch (error) {
        logger.error('User authentication failed', { error });
        return {
            success: false,
            error: 'Authentication failed. Please try again.',
        };
    }
}

/**
 * Get cookie options for API key
 * 
 * @returns Cookie configuration object
 */
export function getCookieOptions() {
    return getApiKeyCookieOptions();
}

/**
 * Get API key cookie name
 * 
 * @returns Cookie name string
 */
export function getApiKeyCookieName(): string {
    return getSharedApiKeyCookieName();
}
