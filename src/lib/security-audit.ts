import { FastifyRequest } from 'fastify';
import { prisma } from './db.js';
import { logger } from './logger.js';

export type SecurityAuditResult = 'SUCCESS' | 'DENIED' | 'ERROR';

export interface SecurityAuditEventInput {
  actorUserId?: string | null;
  actorKind: 'USER' | 'SERVICE_KEY' | 'SYSTEM';
  action: string;
  targetType: string;
  targetId?: string | null;
  workspaceType?: 'PERSONAL' | 'TEAM' | null;
  teamId?: string | null;
  result: SecurityAuditResult;
  reason?: string | null;
  diff?: unknown;
  metadata?: unknown;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export function securityAuditContextFromRequest(
  request: FastifyRequest,
  overrides: Partial<SecurityAuditEventInput>,
): SecurityAuditEventInput {
  const user = (request as any).user;
  const v2Auth = (request as any).v2Auth;
  const actorKind: SecurityAuditEventInput['actorKind'] = v2Auth?.kind === 'service'
    ? 'SERVICE_KEY'
    : user?.id
      ? 'USER'
      : 'SYSTEM';

  return {
    actorUserId: user?.id ?? null,
    actorKind,
    action: overrides.action ?? 'UNKNOWN',
    targetType: overrides.targetType ?? 'UNKNOWN',
    targetId: overrides.targetId ?? null,
    workspaceType: overrides.workspaceType ?? v2Auth?.workspaceType ?? user?.currentWorkspaceType ?? 'PERSONAL',
    teamId: overrides.teamId ?? v2Auth?.teamId ?? user?.currentTeamId ?? null,
    result: overrides.result ?? 'SUCCESS',
    reason: overrides.reason ?? null,
    diff: overrides.diff,
    metadata: {
      ...(typeof overrides.metadata === 'object' && overrides.metadata ? overrides.metadata as Record<string, unknown> : {}),
      method: request.method,
      url: request.url,
      requestId: request.id,
      serviceKeyId: v2Auth?.serviceKeyId ?? null,
    },
    ip: overrides.ip ?? request.ip ?? null,
    userAgent: overrides.userAgent ?? (request.headers['user-agent'] ?? null),
    requestId: overrides.requestId ?? request.id,
  };
}

export async function emitSecurityAuditEvent(event: SecurityAuditEventInput): Promise<void> {
  try {
    const client = prisma as any;
    if (!client.auditSecurityEvent) {
      logger.warn('Security audit model is unavailable on Prisma client; skipping audit write');
      return;
    }

    await client.auditSecurityEvent.create({
      data: {
        actorUserId: event.actorUserId ?? null,
        actorKind: event.actorKind,
        action: event.action,
        targetType: event.targetType,
        targetId: event.targetId ?? null,
        workspaceType: event.workspaceType ?? 'PERSONAL',
        teamId: event.teamId ?? null,
        result: event.result,
        reason: event.reason ?? null,
        diff: event.diff ?? null,
        metadata: event.metadata ?? null,
        ip: event.ip ?? null,
        userAgent: event.userAgent ?? null,
        requestId: event.requestId ?? null,
      },
    });
  } catch (error) {
    logger.warn('Failed to persist security audit event', { error, action: event.action, targetType: event.targetType });
  }
}
