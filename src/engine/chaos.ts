/**
 * chaos.ts — Chaos engineering middleware for mock endpoints.
 *
 * Configurable per-endpoint:
 *   delay:       { min: 100, max: 2000 }  — Random response delay (ms)
 *   timeout:     { probability: 0.1 }      — 10% chance of timeout (no response)
 *   errorInject: { probability: 0.2, status: 500, body: "Server Error" }
 *   jitter:      { ms: 50 }               — Random ±50ms jitter added to delay
 *   rateLimit:   { rpm: 10, perIp: true }  — Rate limit per minute
 *
 * All settings stored in Redis, configurable via API.
 */
import { FastifyReply } from 'fastify';
import { logger } from '../lib/logger.js';
import { redis } from '../lib/redis.js';

const CHAOS_PREFIX = 'mockurl:chaos:';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ChaosConfig {
    enabled: boolean;
    delay?: { min: number; max: number };
    timeout?: { probability: number; durationMs?: number };
    errorInject?: { probability: number; status: number; body?: string };
    jitter?: { ms: number };
    rateLimit?: { rpm: number; perIp: boolean };
}

export interface ChaosResult {
    applied: string[];       // What chaos effects were applied
    delayed?: number;        // Actual delay applied (ms)
    timedOut?: boolean;      // Whether the request was timed out
    errorInjected?: boolean; // Whether an error was injected
    rateLimited?: boolean;   // Whether rate limit was hit
    injectedStatus?: number; // Status code of injected error
    injectedBody?: string;   // Body of injected error
}

const DEFAULT_CONFIG: ChaosConfig = { enabled: false };

// ─── Config management ─────────────────────────────────────────────────────

function chaosKey(endpointId: string): string {
    return CHAOS_PREFIX + endpointId;
}

/**
 * Get chaos config for an endpoint.
 */
export async function getChaosConfig(endpointId: string): Promise<ChaosConfig> {
    try {
        const raw = await redis.get(chaosKey(endpointId));
        if (raw) return JSON.parse(raw) as ChaosConfig;
    } catch (err) {
        logger.error(`Chaos config load error: ${(err as Error).message}`);
    }
    return DEFAULT_CONFIG;
}

/**
 * Set chaos config for an endpoint.
 */
export async function setChaosConfig(endpointId: string, config: Partial<ChaosConfig>): Promise<ChaosConfig> {
    const current = await getChaosConfig(endpointId);
    const merged: ChaosConfig = { ...current, ...config };
    try {
        await redis.set(chaosKey(endpointId), JSON.stringify(merged));
    } catch (err) {
        logger.error(`Chaos config save error: ${(err as Error).message}`);
    }
    return merged;
}

/**
 * Clear chaos config for an endpoint.
 */
export async function clearChaosConfig(endpointId: string): Promise<void> {
    try {
        await redis.del(chaosKey(endpointId));
    } catch (err) {
        logger.error(`Chaos config clear error: ${(err as Error).message}`);
    }
}

// ─── Rate limit tracking ───────────────────────────────────────────────────

async function checkRateLimit(endpointId: string, ip: string, config: ChaosConfig): Promise<boolean> {
    if (!config.rateLimit) return false;

    const key = config.rateLimit.perIp
        ? `${CHAOS_PREFIX}rl:${endpointId}:${ip}`
        : `${CHAOS_PREFIX}rl:${endpointId}`;

    try {
        const count = await redis.incr(key);
        if (count === 1) {
            await redis.expire(key, 60); // 1 minute window
        }
        return count > config.rateLimit.rpm;
    } catch {
        return false;
    }
}

// ─── Chaos engine ───────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Apply chaos effects before sending a mock response.
 * Returns a ChaosResult describing what happened.
 * If the chaos engine sends a response (timeout/error/rateLimit), it sets replied=true.
 */
export async function applyChaos(
    endpointId: string,
    ip: string,
    reply?: FastifyReply,
): Promise<ChaosResult> {
    const config = await getChaosConfig(endpointId);

    if (!config.enabled) {
        return { applied: [] };
    }

    const result: ChaosResult = { applied: [] };

    // 1. Rate limiting
    if (config.rateLimit) {
        const limited = await checkRateLimit(endpointId, ip, config);
        if (limited) {
            result.applied.push('rateLimit');
            result.rateLimited = true;

            if (reply) {
                reply.status(429).send({
                    error: 'Too Many Requests',
                    message: `Rate limit exceeded: ${config.rateLimit.rpm} requests per minute`,
                    retryAfter: 60,
                });
            }
            return result;
        }
    }

    // 2. Timeout simulation
    if (config.timeout && Math.random() < config.timeout.probability) {
        result.applied.push('timeout');
        result.timedOut = true;

        const duration = config.timeout.durationMs ?? 30_000;
        if (reply) {
            // Simulate timeout by waiting and then sending 504
            await sleep(Math.min(duration, 30_000));
            reply.status(504).send({
                error: 'Gateway Timeout',
                message: 'Simulated timeout (chaos engineering)',
            });
        }
        return result;
    }

    // 3. Delay + jitter
    if (config.delay) {
        let delayMs = config.delay.min + Math.random() * (config.delay.max - config.delay.min);

        if (config.jitter) {
            delayMs += (Math.random() - 0.5) * 2 * config.jitter.ms;
        }

        delayMs = Math.max(0, Math.round(delayMs));
        result.applied.push('delay');
        result.delayed = delayMs;

        await sleep(delayMs);
    }

    // 4. Error injection
    if (config.errorInject && Math.random() < config.errorInject.probability) {
        result.applied.push('errorInject');
        result.errorInjected = true;
        result.injectedStatus = config.errorInject.status;
        result.injectedBody = config.errorInject.body;

        if (reply) {
            reply.status(config.errorInject.status).send(
                config.errorInject.body ?? {
                    error: 'Simulated Error',
                    message: 'Error injected by chaos engineering',
                    status: config.errorInject.status,
                },
            );
        }
        return result;
    }

    return result;
}
