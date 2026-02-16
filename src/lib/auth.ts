import jwt from 'jsonwebtoken';
import { hashApiKey } from '../utils/apiKey.js';
import { prisma } from './db.js';
import { logger } from './logger.js';

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  if (process.env.NODE_ENV !== 'test') {
    console.warn('JWT_SECRET must be set and at least 32 characters long');
  }
}

export interface JWTPayload {
  userId: string;
  email: string;
  iat?: number;
  exp?: number;
}

/**
 * Generate JWT token for user
 */
export function generateToken(payload: Omit<JWTPayload, 'iat' | 'exp'>): string {
  if (!JWT_SECRET) throw new Error('JWT_SECRET is not defined');
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  } as any);
}

/**
 * Verify and decode JWT token
 */
export function verifyToken(token: string): JWTPayload | null {
  if (!JWT_SECRET) return null;
  try {
    return jwt.verify(token, JWT_SECRET) as JWTPayload;
  } catch (error) {
    logger.warn('JWT verification failed', { error });
    return null;
  }
}

/**
 * Validate API key and return user (Uses SHA-256 Hash)
 */
export async function validateApiKey(apiKey: string) {
  try {
    const apiKeyHash = hashApiKey(apiKey);
    const user = await prisma.user.findUnique({
      where: { apiKeyHash },
      select: {
        id: true,
        email: true,
      },
    });

    return user;
  } catch (error) {
    logger.error('API key validation failed', { error });
    return null;
  }
}

/**
 * Extract token from Authorization header or X-API-KEY
 */
export function extractToken(authHeader: string | undefined): {
  type: 'jwt' | 'apikey' | null;
  token: string | null;
} {
  if (!authHeader) {
    return { type: null, token: null };
  }

  // Handle "Bearer <token>"
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7).trim();
    return token ? { type: 'jwt', token } : { type: null, token: null };
  }

  // Handle "ApiKey <key>"
  if (authHeader.startsWith('ApiKey ')) {
    const token = authHeader.substring(7).trim();
    return token ? { type: 'apikey', token } : { type: null, token: null };
  }

  return { type: null, token: null };
}
