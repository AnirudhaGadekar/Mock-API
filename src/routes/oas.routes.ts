import { FastifyPluginAsync } from 'fastify';
import { parseOpenAPISpec } from '../engine/oas-import.js';
import { prisma } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { V2_ERROR_CODES } from '../lib/v2-error-codes.js';
import { v2Error } from '../lib/v2-response.js';
import { authenticateV2ApiKey, requireV2Scopes } from '../middleware/auth-v2.middleware.js';
import { endpointNameSchema } from '../validators/endpoint.validator.js';

function normalizeEndpointBaseUrl(base: string): string {
  const trimmed = base.trim().replace(/\/+$/, '');
  return trimmed.endsWith('/e') ? trimmed : `${trimmed}/e`;
}

function endpointPublicUrl(slug: string): string {
  const configuredBase = process.env.BASE_ENDPOINT_URL?.trim();
  const base = configuredBase ? normalizeEndpointBaseUrl(configuredBase) : 'http://localhost:3000/e';
  return `${base}/${slug}`;
}

function getWorkspaceWhere(request: any): { userId?: string; teamId?: string } | null {
  const workspaceType = request.v2Auth?.workspaceType;
  if (workspaceType === 'TEAM') {
    if (!request.v2Auth?.teamId) return null;
    return { teamId: request.v2Auth.teamId };
  }
  if (!request.user?.id) return null;
  return { userId: request.user.id };
}

async function ensureWorkspaceId(workspaceWhere: { userId?: string; teamId?: string }): Promise<string> {
  if (workspaceWhere.teamId) {
    const ws = await prisma.workspace.upsert({
      where: { teamId: workspaceWhere.teamId },
      update: { updatedAt: new Date() },
      create: { id: `ws_team_${workspaceWhere.teamId}`, type: 'TEAM', teamId: workspaceWhere.teamId },
    });
    return ws.id;
  }
  if (workspaceWhere.userId) {
    const id = `ws_personal_${workspaceWhere.userId}`;
    const ws = await prisma.workspace.upsert({
      where: { id },
      update: { updatedAt: new Date() },
      create: { id, type: 'PERSONAL', personalOwnerUserId: workspaceWhere.userId },
    });
    return ws.id;
  }
  throw new Error('Cannot resolve workspaceId');
}

function buildEndpointSlug(base: string): string {
  const sanitized = base
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  const fallback = `api-import-${Date.now().toString().slice(-6)}`;
  const candidate = sanitized || fallback;
  const clipped = candidate.slice(0, 40);
  if (endpointNameSchema.safeParse(clipped).success) return clipped;
  return fallback.slice(0, 40);
}

function extractSpecString(body: unknown): { specString?: string; url?: string } {
  if (typeof body === 'string') return { specString: body };
  if (!body || typeof body !== 'object') return {};
  const obj = body as Record<string, unknown>;
  if (typeof obj.url === 'string' && obj.url.trim()) return { url: obj.url.trim() };
  if (typeof obj.spec === 'string' && obj.spec.trim()) return { specString: obj.spec };
  if (obj.openapi || obj.swagger) return { specString: JSON.stringify(obj) };
  return {};
}

async function resolveSpecString(body: unknown): Promise<string> {
  const extracted = extractSpecString(body);
  if (extracted.specString) return extracted.specString;
  if (extracted.url) {
    const res = await fetch(extracted.url, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) {
      throw new Error(`Failed to fetch OpenAPI URL (status ${res.status})`);
    }
    return await res.text();
  }
  throw new Error('Body must contain OpenAPI spec content or a public URL');
}

async function resolveUniqueSlug(workspaceWhere: { userId?: string; teamId?: string }, baseSlug: string): Promise<string> {
  let index = 0;
  while (index < 200) {
    const suffix = index === 0 ? '' : `-${index}`;
    const trimmedBase = baseSlug.slice(0, Math.max(5, 40 - suffix.length));
    const candidate = `${trimmedBase}${suffix}`;
    const existing = await prisma.endpoint.findFirst({ where: { slug: candidate, ...workspaceWhere } });
    if (!existing) return candidate;
    index += 1;
  }
  return `${baseSlug.slice(0, 34)}-${Date.now().toString().slice(-5)}`;
}

async function handleImport(request: any, reply: any) {
  try {
    const workspaceWhere = getWorkspaceWhere(request);
    if (!workspaceWhere) {
      return v2Error(request, reply, 400, {
        code: V2_ERROR_CODES.TEAM_CONTEXT_REQUIRED,
        message: 'teamId is required for TEAM workspace key',
      });
    }

    const specString = await resolveSpecString(request.body);
    const generated = parseOpenAPISpec(specString);
    const allRules = generated.flatMap((g) => g.rules);
    if (allRules.length === 0) {
      return v2Error(request, reply, 400, {
        code: V2_ERROR_CODES.VALIDATION_ERROR,
        message: 'OpenAPI spec has no importable routes',
      });
    }

    const timestampSuffix = Date.now().toString().slice(-6);
    const baseSlug = buildEndpointSlug(`${generated[0]?.name || 'api-import'}-${timestampSuffix}`);
    const uniqueSlug = await resolveUniqueSlug(workspaceWhere, baseSlug);
    const workspaceId = await ensureWorkspaceId(workspaceWhere);

    const rules = allRules.map((rule) => {
      let body: unknown = rule.body;
      try {
        body = JSON.parse(rule.body);
      } catch {
        body = rule.body;
      }
      return {
        path: rule.path,
        method: rule.method,
        response: {
          status: rule.status,
          headers: rule.headers,
          body,
        },
      };
    });

    const endpoint = await prisma.endpoint.create({
      data: {
        name: uniqueSlug,
        slug: uniqueSlug,
        userId: workspaceWhere.userId ?? null,
        teamId: workspaceWhere.teamId ?? null,
        workspaceId,
        rules: rules as any,
        requestCount: 0,
        lastActiveAt: new Date(),
      },
    });

    return reply.status(201).send({
      success: true,
      endpoint: {
        id: endpoint.id,
        name: endpoint.name,
        subdomain: endpoint.slug,
        url: endpointPublicUrl(endpoint.slug),
      },
      rulesCreated: rules.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error: unknown) {
    logger.error('OAS import failed', { error: String((error as Error)?.message ?? error) });
    return v2Error(request, reply, 400, {
      code: V2_ERROR_CODES.VALIDATION_ERROR,
      message: String((error as Error)?.message ?? 'Failed to import OpenAPI spec'),
    });
  }
}

export const oasRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', authenticateV2ApiKey);

  fastify.post('/endpoints/import/openapi', {
    preHandler: [requireV2Scopes(['endpoints:write'])],
  }, handleImport);

  // Backward-compatible alias for existing UI/client calls.
  fastify.post('/oas-import', {
    preHandler: [requireV2Scopes(['endpoints:write'])],
  }, handleImport);
};
