import crypto from 'crypto';

const API_KEY_SECRET = process.env.API_KEY_SECRET;

if (!API_KEY_SECRET && process.env.NODE_ENV === 'production') {
    throw new Error('❌ SECURITY ERROR: API_KEY_SECRET must be set in production to prevent session invalidation on restart.');
}

if (!API_KEY_SECRET) {
    console.warn('[WARN] API_KEY_SECRET is not set. Using a random fallback. Set this env var for stable API key hashing!');
}

// Always have a usable secret — random fallback if env var is missing (non-prod only)
const EFFECTIVE_SECRET = API_KEY_SECRET || crypto.randomBytes(32).toString('hex');

/**
 * Generate a new API key with prefix
 */
export function generateApiKey(): string {
    const random = crypto.randomBytes(32).toString('hex');
    return `key_live_${random}`;
}

/**
 * Hash API key using HMAC-SHA256
 * This is fast and secure for API key hashing
 */
export function hashApiKey(apiKey: string): string {
    return crypto
        .createHmac('sha256', EFFECTIVE_SECRET)
        .update(apiKey)
        .digest('hex');
}

/**
 * Verify an API key against a hash
 */
export function verifyApiKey(apiKey: string, hash: string): boolean {
    const computedHash = hashApiKey(apiKey);
    try {
        return crypto.timingSafeEqual(
            Buffer.from(computedHash),
            Buffer.from(hash)
        );
    } catch (e) {
        return false;
    }
}

/**
 * Get masked version of API key for display
 * Shows: key_live_abc...xyz
 */
export function maskApiKey(apiKey: string): string {
    if (!apiKey || apiKey.length < 16) return '***';
    const prefix = apiKey.substring(0, 12); // "key_live_abc"
    const suffix = apiKey.substring(apiKey.length - 3); // "xyz"
    return `${prefix}...${suffix}`;
}
