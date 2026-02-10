/**
 * Stateful mocking - store/retrieve state per endpoint
 */
import { redis } from './redis.js';
import { logger } from './logger.js';

const STATE_TTL = 7 * 24 * 60 * 60; // 7 days

/**
 * Get state for endpoint
 */
export async function getState(endpointId: string, key: string): Promise<unknown> {
  try {
    const stateKey = `state:${endpointId}:${key}`;
    const value = await redis.get(stateKey);
    return value ? JSON.parse(value) : null;
  } catch (error) {
    logger.error({ error, endpointId, key }, 'Failed to get state');
    return null;
  }
}

/**
 * Set state for endpoint
 */
export async function setState(endpointId: string, key: string, value: unknown): Promise<void> {
  try {
    const stateKey = `state:${endpointId}:${key}`;
    await redis.setex(stateKey, STATE_TTL, JSON.stringify(value));
  } catch (error) {
    logger.error({ error, endpointId, key }, 'Failed to set state');
  }
}

/**
 * Delete state for endpoint
 */
export async function deleteState(endpointId: string, key: string): Promise<void> {
  try {
    const stateKey = `state:${endpointId}:${key}`;
    await redis.del(stateKey);
  } catch (error) {
    logger.error({ error, endpointId, key }, 'Failed to delete state');
  }
}

/**
 * Get all state keys for endpoint
 */
export async function listStateKeys(endpointId: string): Promise<string[]> {
  try {
    const pattern = `state:${endpointId}:*`;
    const keys = await redis.keys(pattern);
    return keys.map((k) => k.replace(`state:${endpointId}:`, ''));
  } catch (error) {
    logger.error({ error, endpointId }, 'Failed to list state keys');
    return [];
  }
}
