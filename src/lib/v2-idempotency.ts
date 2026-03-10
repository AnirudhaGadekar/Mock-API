import { FastifyReply, FastifyRequest } from 'fastify';
import { redis } from './redis.js';

interface StoredIdempotentResponse {
  statusCode: number;
  body: unknown;
}

function getIdempotencyKeyHeader(request: FastifyRequest): string | null {
  const raw = request.headers['idempotency-key'];
  const key = Array.isArray(raw) ? raw[0] : raw;
  if (!key) return null;
  const trimmed = String(key).trim();
  if (!trimmed) return null;
  if (trimmed.length > 128) return null;
  return trimmed;
}

function getTtlSec(): number {
  const raw = Number(process.env.V2_IDEMPOTENCY_TTL_SEC ?? 86_400);
  if (!Number.isFinite(raw) || raw < 60) return 86_400;
  return Math.floor(raw);
}

function getScopeToken(request: FastifyRequest): string {
  const v2Auth = (request as any).v2Auth;
  const user = (request as any).user;
  const actorType = v2Auth?.kind ?? (user?.id ? 'user' : 'anon');
  const actorId = v2Auth?.serviceKeyId ?? user?.id ?? 'none';
  const workspaceType = v2Auth?.workspaceType ?? user?.currentWorkspaceType ?? 'PERSONAL';
  const teamId = v2Auth?.teamId ?? user?.currentTeamId ?? 'none';
  return `${actorType}:${actorId}:${workspaceType}:${teamId}`;
}

function buildRedisKey(request: FastifyRequest, operation: string, key: string): string {
  const scope = getScopeToken(request);
  return `v2:idem:${operation}:${scope}:${key}`;
}

export async function replayIdempotentIfExists(
  request: FastifyRequest,
  reply: FastifyReply,
  operation: string,
): Promise<{ cacheKey: string | null; replayed: boolean }> {
  const idempotencyKey = getIdempotencyKeyHeader(request);
  if (!idempotencyKey) return { cacheKey: null, replayed: false };

  const cacheKey = buildRedisKey(request, operation, idempotencyKey);
  const cached = await redis.get(cacheKey);
  if (!cached) {
    return { cacheKey, replayed: false };
  }

  try {
    const parsed = JSON.parse(cached) as StoredIdempotentResponse;
    reply.header('x-idempotent-replay', 'true');
    reply.status(parsed.statusCode).send(parsed.body);
    return { cacheKey, replayed: true };
  } catch {
    await redis.del(cacheKey);
    return { cacheKey, replayed: false };
  }
}

export async function storeIdempotentResponse(
  cacheKey: string | null,
  statusCode: number,
  body: unknown,
): Promise<void> {
  if (!cacheKey) return;
  const payload: StoredIdempotentResponse = { statusCode, body };
  await redis.set(cacheKey, JSON.stringify(payload), 'EX', getTtlSec());
}
