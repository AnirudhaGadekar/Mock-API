import crypto from 'crypto';

const API_KEY_SECRET = process.env.API_KEY_SECRET;

if (!API_KEY_SECRET) {
    // In development, we can fallback to a default but log a warning
    // In production, the system should fail fast (handled in index.ts)
    if (process.env.NODE_ENV === 'production') {
        throw new Error('API_KEY_SECRET environment variable is required in production!');
    }
}

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
    if (!API_KEY_SECRET) {
        // Fallback for development if not set yet, but not ideal
        return crypto.createHash('sha256').update(apiKey).digest('hex');
    }
    return crypto
        .createHmac('sha256', API_KEY_SECRET)
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
