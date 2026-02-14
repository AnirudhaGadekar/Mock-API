/**
 * Stateful mocking - store/retrieve state per endpoint.
 *
 * All public functions validate their inputs before touching Redis.
 * Errors are thrown (not swallowed) so callers can return proper HTTP responses.
 */
import { logger } from './logger.js';
import { redis } from './redis.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const STATE_TTL = 7 * 24 * 60 * 60; // 7 days in seconds
const MAX_KEY_LENGTH = 100;
const MAX_VALUE_BYTES = 100 * 1024; // 100 KB

// ─── Validation ──────────────────────────────────────────────────────────────

const ENDPOINT_ID_REGEX = /^[a-zA-Z0-9-]+$/;
const STATE_KEY_REGEX = /^[a-zA-Z0-9-_:.]+$/;

function validateEndpointId(endpointId: string): void {
  if (!endpointId || !ENDPOINT_ID_REGEX.test(endpointId)) {
    throw new Error('Invalid endpoint ID format — allowed: alphanumeric and dashes');
  }
}

function validateStateKey(key: string): void {
  if (!key || !STATE_KEY_REGEX.test(key)) {
    throw new Error(
      'Invalid state key format — allowed characters: a-z, A-Z, 0-9, -, _, :, .',
    );
  }
  if (key.length > MAX_KEY_LENGTH) {
    throw new Error(`State key too long — max ${MAX_KEY_LENGTH} characters`);
  }
}

function validateStateValue(value: unknown): void {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new Error('State value must be JSON-serializable');
  }
  if (serialized.length > MAX_VALUE_BYTES) {
    throw new Error(`State value too large — max ${MAX_VALUE_BYTES / 1024}KB`);
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Get state for an endpoint key.
 * Returns null if the key does not exist.
 * Throws on validation failure or Redis error.
 */
export async function getState(endpointId: string, key: string): Promise<unknown> {
  validateEndpointId(endpointId);
  validateStateKey(key);

  try {
    const stateKey = `state:${endpointId}:${key}`;
    const value = await redis.get(stateKey);

    if (!value) return null;

    try {
      return JSON.parse(value);
    } catch (parseError) {
      logger.error('Failed to parse state value — returning null', { parseError, endpointId, key });
      return null;
    }
  } catch (error) {
    logger.error('Failed to get state', { error, endpointId, key });
    throw error;
  }
}

/**
 * Set state for an endpoint key with a 7-day TTL.
 * Throws on validation failure or Redis error.
 */
export async function setState(endpointId: string, key: string, value: unknown): Promise<void> {
  validateEndpointId(endpointId);
  validateStateKey(key);
  validateStateValue(value);

  try {
    const stateKey = `state:${endpointId}:${key}`;
    await redis.setex(stateKey, STATE_TTL, JSON.stringify(value));
  } catch (error) {
    logger.error('Failed to set state', { error, endpointId, key });
    throw error;
  }
}

/**
 * Delete a state key for an endpoint.
 * Throws on validation failure or Redis error.
 */
export async function deleteState(endpointId: string, key: string): Promise<void> {
  validateEndpointId(endpointId);
  validateStateKey(key);

  try {
    const stateKey = `state:${endpointId}:${key}`;
    await redis.del(stateKey);
  } catch (error) {
    logger.error('Failed to delete state', { error, endpointId, key });
    throw error;
  }
}

/**
 * List all state keys for an endpoint.
 * Returns key names stripped of the Redis prefix.
 * Throws on validation failure or Redis error.
 */
export async function listStateKeys(endpointId: string): Promise<string[]> {
  validateEndpointId(endpointId);

  try {
    const pattern = `state:${endpointId}:*`;
    const keys = await redis.keys(pattern);
    return keys.map((k: string) => k.replace(`state:${endpointId}:`, ''));
  } catch (error) {
    logger.error('Failed to list state keys', { error, endpointId });
    throw error;
  }
}