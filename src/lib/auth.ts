import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { prisma } from './db.js';
import { logger } from './logger.js';

//const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
//const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN;

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be set and at least 32 characters long');
}
if (!JWT_EXPIRES_IN) {
  throw new Error('JWT_EXPIRES_IN must be set');
}


export interface JWTPayload {
  userId: string;
  email: string;
  iat?: number;
  exp?: number;
}

/**
 * Generate API key for new users
 */
export function generateApiKey(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Generate JWT token for user
 */
export function generateToken(payload: Omit<JWTPayload, 'iat' | 'exp'>): string {
  return jwt.sign(payload, JWT_SECRET as any, {
    expiresIn: JWT_EXPIRES_IN as any,
  });
}

/**
 * Verify and decode JWT token
 */
export function verifyToken(token: string): JWTPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JWTPayload;
  } catch (error) {
    logger.warn('JWT verification failed', { error });
    return null;
  }
}

/**
 * Validate API key and return user
 */
import { hashApiKey } from '../middleware/auth.middleware.js';

/**
 * Validate API key and return user
 */
export async function validateApiKey(apiKey: string) {
  try {
    const apiKeyHash = hashApiKey(apiKey);
    const user = await prisma.user.findUnique({
      where: { apiKeyHash } as any,
      select: {
        id: true,
        email: true,
        // apiKey: true, // No longer exists
      },
    });

    return user;
  } catch (error) {
    logger.error('API key validation failed', { error });
    return null;
  }
}

/**
 * Extract token from Authorization header
 * Supports: "Bearer <token>" and "ApiKey <key>"
 */
export function extractToken(authHeader: string | undefined): {
  type: 'jwt' | 'apikey' | null;
  token: string | null;
} {
  if (!authHeader) {
    return { type: null, token: null };
  }

  const [type, token] = authHeader.split(' ');

  if (type === 'Bearer' && token) {
    return { type: 'jwt', token };
  }

  if (type === 'ApiKey' && token) {
    return { type: 'apikey', token };
  }

  return { type: null, token: null };
}
