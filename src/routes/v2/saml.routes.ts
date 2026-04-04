import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getApiKeyCookieName, getApiKeyCookieOptions } from '../../lib/auth-cookie.js';
import { prisma } from '../../lib/db.js';
import { logger } from '../../lib/logger.js';
import { redis } from '../../lib/redis.js';
import { emitSecurityAuditEvent, securityAuditContextFromRequest } from '../../lib/security-audit.js';
import { resolveRelayStateTeamId } from '../../lib/saml-relaystate.js';
import {
  getTeamSsoConfig,
  getTeamSsoEnforced,
  isSamlFeatureEnabled,
  setTeamSsoConfig,
  setTeamSsoEnforced,
} from '../../lib/saml-sso.js';
import { verifySamlXmlSignature } from '../../lib/saml-signature.js';
import { V2_ERROR_CODES } from '../../lib/v2-error-codes.js';
import { v2Error, v2Success } from '../../lib/v2-response.js';
import { authenticateV2ApiKey, requireV2Scopes } from '../../middleware/auth-v2.middleware.js';
import { generateApiKey, hashApiKey } from '../../utils/apiKey.js';

const samlAcsBodySchema = z.object({
  SAMLResponse: z.string().min(1),
  RelayState: z.string().optional(),
});

const teamEnforcementParamsSchema = z.object({
  teamId: z.string(),
});

const teamEnforcementBodySchema = z.object({
  enforced: z.boolean(),
});

const teamSsoConfigBodySchema = z.object({
  idpEntityId: z.string().min(1).optional(),
  idpCertificates: z.array(z.string().min(1)).optional(),
  emailAttribute: z.string().min(1).default('NameID'),
  teamAttribute: z.string().min(1).optional(),
});

function getSamlEntityId(): string {
  return process.env.SAML_SP_ENTITY_ID?.trim() || 'mockapi:v2:saml:sp';
}

function getSamlAcsUrl(): string {
  const configured = process.env.SAML_SP_ACS_URL?.trim();
  if (configured) return configured;

  const base = process.env.BASE_ENDPOINT_URL?.trim() || 'http://localhost:3000';
  return `${base.replace(/\/+$/, '')}/api/v2/saml/acs`;
}

function getClockSkewSec(): number {
  const raw = Number(process.env.SAML_CLOCK_SKEW_SEC ?? 180);
  if (!Number.isFinite(raw) || raw < 0) return 180;
  return Math.floor(raw);
}

function requiresStrictSignature(): boolean {
  const raw = process.env.FEATURE_SAML_STRICT_SIGNATURE?.trim().toLowerCase();
  if (!raw) return false;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function getGlobalIdpKeysFromEnv(): string[] {
  const raw = process.env.SAML_IDP_CERT_PEM?.trim();
  if (!raw) return [];
  return [raw];
}

function getMaxSamlResponseBytes(): number {
  const raw = Number(process.env.SAML_MAX_RESPONSE_BYTES ?? 262_144);
  if (!Number.isFinite(raw) || raw < 10_000) return 262_144;
  return Math.floor(raw);
}

function shouldRequireSignedRelayState(): boolean {
  const raw = process.env.FEATURE_SAML_REQUIRE_SIGNED_RELAYSTATE?.trim().toLowerCase();
  if (!raw) return false;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function replayKeyFromAssertionId(assertionId: string): string {
  const encoded = Buffer.from(assertionId, 'utf8').toString('base64url');
  return `saml:assertion:${encoded}`;
}

function buildMetadataXml(): string {
  const entityId = getSamlEntityId();
  const acs = getSamlAcsUrl();
  return `<?xml version="1.0" encoding="UTF-8"?>
<EntityDescriptor entityID="${entityId}" xmlns="urn:oasis:names:tc:SAML:2.0:metadata">
  <SPSSODescriptor AuthnRequestsSigned="false" WantAssertionsSigned="true" protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${acs}" index="0" isDefault="true"/>
  </SPSSODescriptor>
</EntityDescriptor>`;
}

function extractXmlTagValue(xml: string, tag: string): string | null {
  const regex = new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`, 'i');
  const match = xml.match(regex);
  return match?.[1]?.trim() || null;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractSamlAttributeValue(xml: string, attributeName: string): string | null {
  const values = extractSamlAttributeValues(xml, attributeName);
  return values[0] ?? null;
}

function extractSamlAttributeValues(xml: string, attributeName: string): string[] {
  const escaped = escapeRegex(attributeName);
  const attributeRegex = new RegExp(
    `<(?:\\w+:)?Attribute\\b[^>]*\\bName="${escaped}"[^>]*>[\\s\\S]*?<` +
    `\\/(?:\\w+:)?Attribute>`,
    'ig',
  );
  const valueRegex = new RegExp(
    `<(?:\\w+:)?AttributeValue\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?AttributeValue>`,
    'i',
  );
  const out: string[] = [];

  const attributeBlocks = xml.match(attributeRegex) ?? [];
  for (const block of attributeBlocks) {
    const allValues = block.match(new RegExp(valueRegex.source, 'ig')) ?? [];
    for (const raw of allValues) {
      const single = raw.match(valueRegex);
      if (!single?.[1]) continue;
      const cleaned = single[1].replace(/<[^>]+>/g, '').trim();
      if (!cleaned) continue;
      const splitValues = cleaned
        .split(/[;,]/g)
        .map((v) => v.trim())
        .filter(Boolean);
      out.push(...splitValues);
    }
  }

  return out;
}

function normalizeEmail(email: string | null): string | null {
  if (!email) return null;
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return null;
  return normalized;
}

function getEmailFromAssertion(xml: string, configuredEmailAttribute?: string): string | null {
  const attr = configuredEmailAttribute?.trim();
  if (attr && attr.toLowerCase() !== 'nameid') {
    const byConfiguredAttr = normalizeEmail(extractSamlAttributeValue(xml, attr));
    if (byConfiguredAttr) return byConfiguredAttr;
  }

  const nameId = normalizeEmail(extractXmlTagValue(xml, 'saml:NameID') || extractXmlTagValue(xml, 'NameID'));
  if (nameId) return nameId;

  const commonEmailAttrs = [
    'email',
    'mail',
    'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
  ];
  for (const key of commonEmailAttrs) {
    const val = normalizeEmail(extractSamlAttributeValue(xml, key));
    if (val) return val;
  }

  return null;
}

function getTeamAttributeCandidates(teamAttribute?: string): string[] {
  const configured = process.env.SAML_TEAM_ATTRIBUTE?.trim();
  const candidates = [
    teamAttribute?.trim(),
    configured,
    'groups',
    'group',
    'team',
    'teamId',
    'teamSlug',
    'http://schemas.xmlsoap.org/claims/Group',
  ].filter((v): v is string => Boolean(v && v.length > 0));

  return [...new Set(candidates)];
}

async function resolveMappedTeamId(
  relayStateTeamId: string | null,
  xml: string,
  teamAttribute?: string,
): Promise<{ teamId: string | null; teamAttributeUsed: string | null }> {
  if (relayStateTeamId) {
    const byId = await prisma.team.findUnique({ where: { id: relayStateTeamId }, select: { id: true } });
    return {
      teamId: byId?.id ?? null,
      teamAttributeUsed: null,
    };
  }

  const attributes = getTeamAttributeCandidates(teamAttribute);
  for (const attr of attributes) {
    const values = extractSamlAttributeValues(xml, attr);
    for (const value of values) {
      const candidate = value.trim();
      if (!candidate) continue;

      const byId = await prisma.team.findUnique({ where: { id: candidate }, select: { id: true } });
      if (byId) {
        return { teamId: byId.id, teamAttributeUsed: attr };
      }

      const bySlug = await prisma.team.findUnique({ where: { slug: candidate }, select: { id: true } });
      if (bySlug) {
        return { teamId: bySlug.id, teamAttributeUsed: attr };
      }
    }
  }

  return {
    teamId: null,
    teamAttributeUsed: null,
  };
}

function extractAssertionId(xml: string): string | null {
  const match = xml.match(/<saml(?:2)?:Assertion[^>]*\sID="([^"]+)"/i) || xml.match(/<Assertion[^>]*\sID="([^"]+)"/i);
  return match?.[1] || null;
}

function extractIssueInstant(xml: string): string | null {
  const assertionMatch = xml.match(/<saml(?:2)?:Assertion[^>]*\sIssueInstant="([^"]+)"/i) || xml.match(/<Assertion[^>]*\sIssueInstant="([^"]+)"/i);
  if (assertionMatch?.[1]) return assertionMatch[1];
  return extractXmlTagValue(xml, 'saml:IssueInstant') || extractXmlTagValue(xml, 'IssueInstant');
}

function decodeSamlResponse(payload: string): string | null {
  if (Buffer.byteLength(payload, 'utf8') > getMaxSamlResponseBytes() * 2) {
    return null;
  }
  try {
    const decoded = Buffer.from(payload, 'base64').toString('utf8');
    if (!decoded.includes('<')) return null;
    if (Buffer.byteLength(decoded, 'utf8') > getMaxSamlResponseBytes()) return null;
    return decoded;
  } catch {
    return null;
  }
}

function containsBlockedXmlConstructs(xml: string): boolean {
  return /<!DOCTYPE|<!ENTITY/i.test(xml);
}

async function ensureTeamAdminOrOwner(teamId: string, userId: string): Promise<boolean> {
  const membership = await prisma.teamMember.findUnique({
    where: {
      userId_teamId: { userId, teamId },
    },
    select: { role: true },
  });
  if (!membership) return false;
  return membership.role === 'OWNER' || membership.role === 'ADMIN';
}

export const v2SamlRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', async (request, reply) => {
    if (!isSamlFeatureEnabled()) {
      return v2Error(request, reply, 404, {
        code: V2_ERROR_CODES.NOT_FOUND,
        message: 'SAML feature is disabled',
      });
    }
  });

  fastify.get('/metadata', async (_request, reply) => {
    reply.header('content-type', 'application/samlmetadata+xml; charset=utf-8');
    return reply.status(200).send(buildMetadataXml());
  });

  fastify.post('/acs', async (request, reply) => {
    const samlAudit = (event: string, details: Record<string, unknown>) => {
      logger.info('SAML ACS audit', {
        event,
        requestId: request.id,
        ip: request.ip,
        userAgent: request.headers['user-agent'],
        ...details,
      });
    };

    const parsed = samlAcsBodySchema.safeParse(request.body);
    if (!parsed.success) {
      samlAudit('SAML_ACS_REJECTED', { reason: 'invalid_payload_schema' });
      return v2Error(request, reply, 400, {
        code: V2_ERROR_CODES.VALIDATION_ERROR,
        message: 'Invalid ACS payload',
        details: parsed.error.flatten(),
      });
    }

    const xml = decodeSamlResponse(parsed.data.SAMLResponse);
    if (!xml) {
      samlAudit('SAML_ACS_REJECTED', { reason: 'invalid_or_oversized_samlresponse' });
      return v2Error(request, reply, 400, {
        code: V2_ERROR_CODES.SAML_PAYLOAD_TOO_LARGE,
        message: 'SAMLResponse is invalid or exceeds size limits',
      });
    }
    if (containsBlockedXmlConstructs(xml)) {
      samlAudit('SAML_ACS_REJECTED', { reason: 'blocked_xml_construct' });
      return v2Error(request, reply, 400, {
        code: V2_ERROR_CODES.SAML_INVALID_RESPONSE,
        message: 'SAMLResponse contains blocked XML constructs',
      });
    }

    const assertionId = extractAssertionId(xml);
    const issueInstantRaw = extractIssueInstant(xml);
    if (!assertionId || !issueInstantRaw) {
      samlAudit('SAML_ACS_REJECTED', { reason: 'missing_assertion_metadata' });
      return v2Error(request, reply, 400, {
        code: V2_ERROR_CODES.SAML_INVALID_RESPONSE,
        message: 'Missing required Assertion ID or IssueInstant',
      });
    }

    const issueInstant = new Date(issueInstantRaw);
    if (Number.isNaN(issueInstant.getTime())) {
      samlAudit('SAML_ACS_REJECTED', { reason: 'invalid_issue_instant', assertionId });
      return v2Error(request, reply, 400, {
        code: V2_ERROR_CODES.SAML_INVALID_RESPONSE,
        message: 'IssueInstant is not a valid timestamp',
      });
    }

    const skewMs = getClockSkewSec() * 1000;
    const now = Date.now();
    if (Math.abs(now - issueInstant.getTime()) > skewMs) {
      samlAudit('SAML_ACS_REJECTED', { reason: 'assertion_expired', assertionId, issueInstantRaw });
      return v2Error(request, reply, 401, {
        code: V2_ERROR_CODES.SAML_ASSERTION_EXPIRED,
        message: 'SAML assertion is outside allowed clock skew window',
      });
    }

    const relayStateResolution = resolveRelayStateTeamId(parsed.data.RelayState);
    if (!relayStateResolution.valid) {
      samlAudit('SAML_ACS_REJECTED', {
        reason: 'relaystate_invalid',
        assertionId,
        relayStateSigned: relayStateResolution.signed,
      });
      return v2Error(request, reply, 403, {
        code: V2_ERROR_CODES.SAML_RELAYSTATE_INVALID,
        message: relayStateResolution.reason || 'RelayState is invalid',
      });
    }
    if (shouldRequireSignedRelayState() && parsed.data.RelayState && !relayStateResolution.signed) {
      samlAudit('SAML_ACS_REJECTED', {
        reason: 'unsigned_relaystate_rejected',
        assertionId,
      });
      return v2Error(request, reply, 403, {
        code: V2_ERROR_CODES.SAML_RELAYSTATE_INVALID,
        message: 'RelayState must be signed',
      });
    }

    const relayTeamId = relayStateResolution.teamId;
    const teamConfig = relayTeamId ? await getTeamSsoConfig(relayTeamId) : null;
    const configuredKeys = [
      ...(teamConfig?.idpCertificates ?? []),
      ...getGlobalIdpKeysFromEnv(),
    ];

    if (configuredKeys.length > 0 || requiresStrictSignature()) {
      const verified = verifySamlXmlSignature(xml, configuredKeys);
      if (!verified.ok) {
        samlAudit('SAML_ACS_REJECTED', { reason: 'signature_invalid', assertionId });
        return v2Error(request, reply, 403, {
          code: V2_ERROR_CODES.SAML_SIGNATURE_INVALID,
          message: verified.reason || 'Signature verification failed',
        });
      }
    }

    const replayKey = replayKeyFromAssertionId(assertionId);
    const replaySet = await redis.set(replayKey, '1', 'EX', Math.max(60, getClockSkewSec() * 2), 'NX');
    if (replaySet !== 'OK') {
      samlAudit('SAML_ACS_REJECTED', { reason: 'assertion_replayed', assertionId });
      return v2Error(request, reply, 409, {
        code: V2_ERROR_CODES.SAML_ASSERTION_REPLAYED,
        message: 'SAML assertion replay detected',
      });
    }

    const email = getEmailFromAssertion(xml, teamConfig?.emailAttribute);
    if (!email) {
      samlAudit('SAML_ACS_REJECTED', { reason: 'missing_email_claim', assertionId });
      return v2Error(request, reply, 400, {
        code: V2_ERROR_CODES.SAML_INVALID_RESPONSE,
        message: 'SAML assertion does not contain a valid email claim',
      });
    }

    const { teamId: mappedTeamId, teamAttributeUsed } = await resolveMappedTeamId(
      relayTeamId,
      xml,
      teamConfig?.teamAttribute,
    );
    if (relayTeamId && !mappedTeamId) {
      samlAudit('SAML_ACS_REJECTED', {
        reason: 'relaystate_team_not_mapped',
        assertionId,
        relayTeamId,
      });
      return v2Error(request, reply, 403, {
        code: V2_ERROR_CODES.FORBIDDEN,
        message: 'RelayState team is invalid or unavailable for SAML mapping',
      });
    }

    const firstName = extractSamlAttributeValue(xml, 'given_name') || extractSamlAttributeValue(xml, 'firstName');
    const lastName = extractSamlAttributeValue(xml, 'family_name') || extractSamlAttributeValue(xml, 'lastName');
    const displayName = `${firstName ?? ''} ${lastName ?? ''}`.trim() || null;

    const apiKey = generateApiKey();
    const apiKeyHash = hashApiKey(apiKey);
    const existingUser = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        authProvider: true,
        firstName: true,
        lastName: true,
        name: true,
      },
    });

    const user = existingUser
      ? await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          apiKeyHash,
          emailVerified: true,
          ...(existingUser.authProvider === 'ANONYMOUS' ? { authProvider: 'LOCAL' } : {}),
          ...(firstName && !existingUser.firstName ? { firstName } : {}),
          ...(lastName && !existingUser.lastName ? { lastName } : {}),
          ...(displayName && !existingUser.name ? { name: displayName } : {}),
          currentWorkspaceType: mappedTeamId ? 'TEAM' : 'PERSONAL',
          currentTeamId: mappedTeamId,
        },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          name: true,
          currentWorkspaceType: true,
          currentTeamId: true,
        },
      })
      : await prisma.user.create({
        data: {
          email,
          authProvider: 'LOCAL',
          apiKeyHash,
          emailVerified: true,
          firstName: firstName ?? undefined,
          lastName: lastName ?? undefined,
          name: displayName ?? undefined,
          currentWorkspaceType: mappedTeamId ? 'TEAM' : 'PERSONAL',
          currentTeamId: mappedTeamId,
        },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          name: true,
          currentWorkspaceType: true,
          currentTeamId: true,
        },
      });

    if (mappedTeamId) {
      await prisma.teamMember.upsert({
        where: {
          userId_teamId: {
            userId: user.id,
            teamId: mappedTeamId,
          },
        },
        update: {},
        create: {
          userId: user.id,
          teamId: mappedTeamId,
          role: 'MEMBER',
        },
      });
    }

    reply.setCookie(getApiKeyCookieName(), apiKey, getApiKeyCookieOptions());
    samlAudit('SAML_ACS_ACCEPTED', {
      assertionId,
      userId: user.id,
      jitProvisioned: !existingUser,
      mappedTeamId,
      relayStateSigned: relayStateResolution.signed,
    });

    return v2Success(reply, {
      accepted: true,
      assertionId,
      issueInstant: issueInstant.toISOString(),
      jitProvisioned: !existingUser,
      session: {
        apiKey,
        user,
      },
      teamMapping: mappedTeamId ? {
        teamId: mappedTeamId,
        teamAttribute: teamAttributeUsed ?? teamConfig?.teamAttribute ?? null,
        matched: true,
      } : {
        teamId: null,
        teamAttribute: teamAttributeUsed ?? teamConfig?.teamAttribute ?? null,
        matched: false,
      },
    }, 200);
  });

  fastify.get('/teams/:teamId/enforcement', {
    preHandler: [authenticateV2ApiKey, requireV2Scopes(['security:read'])],
  }, async (request, reply) => {
    const parsed = teamEnforcementParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return v2Error(request, reply, 400, {
        code: V2_ERROR_CODES.VALIDATION_ERROR,
        message: 'Invalid team id',
        details: parsed.error.flatten(),
      });
    }

    const teamId = parsed.data.teamId;
    const userId = (request as any).user?.id as string | undefined;
    if (!userId) {
      return v2Error(request, reply, 401, {
        code: V2_ERROR_CODES.AUTHENTICATION_REQUIRED,
        message: 'Authenticated user context required',
      });
    }

    const allowed = await ensureTeamAdminOrOwner(teamId, userId);
    if (!allowed) {
      return v2Error(request, reply, 403, {
        code: V2_ERROR_CODES.FORBIDDEN,
        message: 'Only team owners/admins can read SSO enforcement',
      });
    }

    const enforced = await getTeamSsoEnforced(teamId);
    return v2Success(reply, { teamId, enforced });
  });

  fastify.put('/teams/:teamId/enforcement', {
    preHandler: [authenticateV2ApiKey, requireV2Scopes(['security:write'])],
  }, async (request, reply) => {
    const parsedParams = teamEnforcementParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return v2Error(request, reply, 400, {
        code: V2_ERROR_CODES.VALIDATION_ERROR,
        message: 'Invalid team id',
        details: parsedParams.error.flatten(),
      });
    }

    const parsedBody = teamEnforcementBodySchema.safeParse(request.body);
    if (!parsedBody.success) {
      return v2Error(request, reply, 400, {
        code: V2_ERROR_CODES.VALIDATION_ERROR,
        message: 'Invalid enforcement payload',
        details: parsedBody.error.flatten(),
      });
    }

    const teamId = parsedParams.data.teamId;
    const userId = (request as any).user?.id as string | undefined;
    if (!userId) {
      return v2Error(request, reply, 401, {
        code: V2_ERROR_CODES.AUTHENTICATION_REQUIRED,
        message: 'Authenticated user context required',
      });
    }

    const allowed = await ensureTeamAdminOrOwner(teamId, userId);
    if (!allowed) {
      await emitSecurityAuditEvent(securityAuditContextFromRequest(request, {
        action: 'SAML_ENFORCEMENT_UPDATED',
        targetType: 'Team',
        targetId: teamId,
        result: 'DENIED',
        reason: 'forbidden_not_admin_owner',
      }));
      return v2Error(request, reply, 403, {
        code: V2_ERROR_CODES.FORBIDDEN,
        message: 'Only team owners/admins can change SSO enforcement',
      });
    }

    await setTeamSsoEnforced(teamId, parsedBody.data.enforced);
    await emitSecurityAuditEvent(securityAuditContextFromRequest(request, {
      action: 'SAML_ENFORCEMENT_UPDATED',
      targetType: 'Team',
      targetId: teamId,
      teamId,
      result: 'SUCCESS',
      diff: { enforced: parsedBody.data.enforced },
    }));
    return v2Success(reply, {
      teamId,
      enforced: parsedBody.data.enforced,
      updatedAt: new Date().toISOString(),
    });
  });

  fastify.get('/teams/:teamId/config', {
    preHandler: [authenticateV2ApiKey, requireV2Scopes(['security:read'])],
  }, async (request, reply) => {
    const parsed = teamEnforcementParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return v2Error(request, reply, 400, {
        code: V2_ERROR_CODES.VALIDATION_ERROR,
        message: 'Invalid team id',
        details: parsed.error.flatten(),
      });
    }

    const teamId = parsed.data.teamId;
    const userId = (request as any).user?.id as string | undefined;
    if (!userId) {
      return v2Error(request, reply, 401, {
        code: V2_ERROR_CODES.AUTHENTICATION_REQUIRED,
        message: 'Authenticated user context required',
      });
    }

    const allowed = await ensureTeamAdminOrOwner(teamId, userId);
    if (!allowed) {
      return v2Error(request, reply, 403, {
        code: V2_ERROR_CODES.FORBIDDEN,
        message: 'Only team owners/admins can read SSO config',
      });
    }

    const config = await getTeamSsoConfig(teamId);
    return v2Success(reply, {
      teamId,
      config: config ?? {
        idpEntityId: null,
        emailAttribute: 'NameID',
        teamAttribute: null,
        updatedAt: null,
      },
    });
  });

  fastify.put('/teams/:teamId/config', {
    preHandler: [authenticateV2ApiKey, requireV2Scopes(['security:write'])],
  }, async (request, reply) => {
    const parsedParams = teamEnforcementParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return v2Error(request, reply, 400, {
        code: V2_ERROR_CODES.VALIDATION_ERROR,
        message: 'Invalid team id',
        details: parsedParams.error.flatten(),
      });
    }

    const parsedBody = teamSsoConfigBodySchema.safeParse(request.body);
    if (!parsedBody.success) {
      return v2Error(request, reply, 400, {
        code: V2_ERROR_CODES.VALIDATION_ERROR,
        message: 'Invalid SSO config payload',
        details: parsedBody.error.flatten(),
      });
    }

    const teamId = parsedParams.data.teamId;
    const userId = (request as any).user?.id as string | undefined;
    if (!userId) {
      return v2Error(request, reply, 401, {
        code: V2_ERROR_CODES.AUTHENTICATION_REQUIRED,
        message: 'Authenticated user context required',
      });
    }

    const allowed = await ensureTeamAdminOrOwner(teamId, userId);
    if (!allowed) {
      await emitSecurityAuditEvent(securityAuditContextFromRequest(request, {
        action: 'SAML_CONFIG_UPDATED',
        targetType: 'Team',
        targetId: teamId,
        result: 'DENIED',
        reason: 'forbidden_not_admin_owner',
      }));
      return v2Error(request, reply, 403, {
        code: V2_ERROR_CODES.FORBIDDEN,
        message: 'Only team owners/admins can update SSO config',
      });
    }

    const config = {
      ...parsedBody.data,
      updatedAt: new Date().toISOString(),
    };
    await setTeamSsoConfig(teamId, config);
    await emitSecurityAuditEvent(securityAuditContextFromRequest(request, {
      action: 'SAML_CONFIG_UPDATED',
      targetType: 'Team',
      targetId: teamId,
      teamId,
      result: 'SUCCESS',
      diff: config,
    }));

    return v2Success(reply, {
      teamId,
      config,
    });
  });
};
