import { FastifyReply, FastifyRequest } from 'fastify';
import { V2_ERROR_CODES } from '../lib/v2-error-codes.js';
import { prisma } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { v2Error } from '../lib/v2-response.js';
import { hashApiKey } from '../utils/apiKey.js';
import { authenticateApiKey, extractApiKey } from './auth.middleware.js';

export type V2Scope = 'endpoints:read' | 'endpoints:write' | 'security:read' | 'security:write' | 'traffic:read' | '*';

export interface V2AuthContext {
  kind: 'service' | 'user';
  scopes: V2Scope[];
  serviceKeyId?: string;
  workspaceType: 'PERSONAL' | 'TEAM';
  teamId?: string | null;
}

const USER_FALLBACK_SCOPES: V2Scope[] = [
  'endpoints:read',
  'endpoints:write',
  'security:read',
  'security:write',
  'traffic:read',
];

function isStrictServiceKeyModeEnabled(): boolean {
  const raw = process.env.FEATURE_V2_STRICT_SERVICE_KEYS?.trim().toLowerCase();
  if (!raw) return false;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function isServiceKeyBootstrapRoute(request: FastifyRequest): boolean {
  const path = request.url.split('?')[0] || request.url;
  return path === '/api/v2/service-keys' || path.startsWith('/api/v2/service-keys/');
}

function hasScope(assigned: string[], required: V2Scope): boolean {
  if (assigned.includes('*')) return true;
  return assigned.includes(required);
}

function normalizeScopes(input: unknown): V2Scope[] {
  if (!Array.isArray(input)) return [];
  return input.filter((s): s is V2Scope => typeof s === 'string') as V2Scope[];
}

export function requireV2Scopes(required: V2Scope[]) {
  return async function enforceV2Scopes(request: FastifyRequest, reply: FastifyReply) {
    const context = request.v2Auth;
    if (!context) {
      return v2Error(request, reply, 401, {
        code: V2_ERROR_CODES.AUTHENTICATION_REQUIRED,
        message: 'Missing v2 auth context',
      });
    }

    const allowed = required.every((scope) => hasScope(context.scopes, scope));
    if (!allowed) {
      return v2Error(request, reply, 403, {
        code: V2_ERROR_CODES.INSUFFICIENT_SCOPE,
        message: `Required scope(s): ${required.join(', ')}`,
      });
    }
  };
}

export async function authenticateV2ApiKey(request: FastifyRequest, reply: FastifyReply) {
  const apiKey = extractApiKey(request);

  if (!apiKey) {
    return v2Error(request, reply, 401, {
      code: V2_ERROR_CODES.AUTHENTICATION_REQUIRED,
      message: 'Missing API key',
    });
  }

  try {
    const isServiceStyleKey = apiKey.startsWith('murl_sk_');
    let serviceKey: any = null;

    if (isServiceStyleKey) {
      const keyHash = hashApiKey(apiKey);
      serviceKey = await prisma.serviceApiKey.findUnique({
        where: { keyHash },
        include: {
          user: {
            include: {
              ownedTeams: { select: { id: true, slug: true, name: true } },
              teamMemberships: {
                include: { team: { select: { id: true, slug: true, name: true } } },
              },
            },
          },
        },
      });
    }
    if (!isServiceStyleKey && !apiKey.startsWith('key_live_')) {
      return v2Error(request, reply, 403, {
        code: V2_ERROR_CODES.FORBIDDEN,
        message: 'Invalid API key',
      });
    }

    if (isStrictServiceKeyModeEnabled() && !isServiceStyleKey && !isServiceKeyBootstrapRoute(request)) {
      return v2Error(request, reply, 403, {
        code: V2_ERROR_CODES.FORBIDDEN,
        message: 'Only scoped service keys are allowed for v2 routes',
      });
    }

    if (
      serviceKey &&
      !serviceKey.revokedAt &&
      (!serviceKey.expiresAt || serviceKey.expiresAt > new Date())
    ) {
      const contextualUser = {
        ...serviceKey.user,
        currentWorkspaceType: serviceKey.workspaceType,
        currentTeamId: serviceKey.teamId,
      };

      request.user = contextualUser;
      request.v2Auth = {
        kind: 'service',
        scopes: normalizeScopes(serviceKey.scopes),
        serviceKeyId: serviceKey.id,
        workspaceType: serviceKey.workspaceType,
        teamId: serviceKey.teamId,
      };

      await prisma.serviceApiKey.update({
        where: { id: serviceKey.id },
        data: { lastUsedAt: new Date() },
      });

      return;
    }

    if (serviceKey && (serviceKey.revokedAt || (serviceKey.expiresAt && serviceKey.expiresAt <= new Date()))) {
      return v2Error(request, reply, 403, {
        code: V2_ERROR_CODES.FORBIDDEN,
        message: 'Invalid API key',
      });
    }

    if (isServiceStyleKey && !serviceKey) {
      return v2Error(request, reply, 403, {
        code: V2_ERROR_CODES.FORBIDDEN,
        message: 'Invalid API key',
      });
    }

    // Fallback for existing user API keys: keep access broad for backward compatibility.
    await authenticateApiKey(request, reply);
    if (reply.sent) {
      return;
    }

    const fallbackUser = (request as any).user;
    if (!fallbackUser) {
      return;
    }

    request.v2Auth = {
      kind: 'user',
      scopes: USER_FALLBACK_SCOPES,
      workspaceType: fallbackUser.currentWorkspaceType,
      teamId: fallbackUser.currentTeamId,
    };
  } catch (error) {
    logger.error('V2 authentication failed', { error });
    return v2Error(request, reply, 500, {
      code: V2_ERROR_CODES.AUTH_INTERNAL_ERROR,
      message: 'Failed to authenticate request',
    });
  }
}
