import { prisma } from './db.js';
import { redis } from './redis.js';

function isEnabled(raw: string | undefined): boolean {
  const v = raw?.trim().toLowerCase();
  if (!v) return false;
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

export function isSamlFeatureEnabled(): boolean {
  return isEnabled(process.env.FEATURE_SAML_SSO);
}

export function isSamlAuthEnforcementEnabled(): boolean {
  return isEnabled(process.env.FEATURE_SAML_ENFORCE_AUTH);
}

export function getTeamSsoEnforcementKey(teamId: string): string {
  return `saml:sso:enforced:${teamId}`;
}

export function getTeamSsoConfigKey(teamId: string): string {
  return `saml:sso:config:${teamId}`;
}

export async function getTeamSsoEnforced(teamId: string): Promise<boolean> {
  const val = await redis.get(getTeamSsoEnforcementKey(teamId));
  return val === '1';
}

export async function setTeamSsoEnforced(teamId: string, enforced: boolean): Promise<void> {
  await redis.set(getTeamSsoEnforcementKey(teamId), enforced ? '1' : '0');
}

export interface TeamSsoConfig {
  idpEntityId?: string;
  idpCertificates?: string[];
  emailAttribute?: string;
  teamAttribute?: string;
  updatedAt: string;
}

export async function getTeamSsoConfig(teamId: string): Promise<TeamSsoConfig | null> {
  const raw = await redis.get(getTeamSsoConfigKey(teamId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TeamSsoConfig;
  } catch {
    return null;
  }
}

export async function setTeamSsoConfig(teamId: string, config: TeamSsoConfig): Promise<void> {
  await redis.set(getTeamSsoConfigKey(teamId), JSON.stringify(config));
}

export async function getFirstEnforcedTeamForEmail(email: string): Promise<string | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;

  const user = await prisma.user.findUnique({
    where: { email: normalized },
    include: { teamMemberships: { select: { teamId: true } } },
  });
  if (!user || user.teamMemberships.length === 0) return null;

  for (const membership of user.teamMemberships) {
    const enforced = await getTeamSsoEnforced(membership.teamId);
    if (enforced) return membership.teamId;
  }

  return null;
}
