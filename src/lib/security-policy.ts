import crypto from 'crypto';
import type { EndpointSettings } from '../types/mock.types.js';

export type HeaderMaskingStrategy = 'full' | 'partial' | 'hash';

export interface EndpointSecurityPolicy {
  ipAllowlist: string[];
  maskedHeaders: string[];
  maskingStrategy: HeaderMaskingStrategy;
  mtlsMode: 'off' | 'optional' | 'required';
}

interface PartialSecurityPolicy {
  ipAllowlist?: string[];
  maskedHeaders?: string[];
  maskingStrategy?: HeaderMaskingStrategy;
  mtlsMode?: 'off' | 'optional' | 'required';
}

const DEFAULT_MASKED_HEADERS = ['authorization', 'cookie', 'set-cookie', 'x-api-key'];

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toNormalizedHeaderSet(values: string[]): string[] {
  const normalized = values
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set(normalized));
}

function normalizeIpv4(input: string): number[] | null {
  const parts = input.split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map((part) => Number(part));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return nums;
}

function normalizeIp(input: string): string {
  return input.trim().toLowerCase().replace(/^\[|\]$/g, '');
}

function parseIPv4Int(input: string): bigint | null {
  const parts = normalizeIpv4(input);
  if (!parts) return null;
  return (
    (BigInt(parts[0]) << 24n) |
    (BigInt(parts[1]) << 16n) |
    (BigInt(parts[2]) << 8n) |
    BigInt(parts[3])
  );
}

function parseIPv6BigInt(input: string): bigint | null {
  const lower = normalizeIp(input);
  if (!lower) return null;

  if (lower.includes('.')) {
    const lastColon = lower.lastIndexOf(':');
    if (lastColon <= 0) return null;
    const ipv4Part = lower.slice(lastColon + 1);
    const ipv4Int = parseIPv4Int(ipv4Part);
    if (ipv4Int === null) return null;
    const left = lower.slice(0, lastColon);
    const high = Number((ipv4Int >> 16n) & 0xffffn).toString(16);
    const low = Number(ipv4Int & 0xffffn).toString(16);
    return parseIPv6BigInt(`${left}:${high}:${low}`);
  }

  const pieces = lower.split('::');
  if (pieces.length > 2) return null;

  const left = (pieces[0] || '').split(':').filter(Boolean);
  const right = (pieces[1] || '').split(':').filter(Boolean);
  if (left.some((p) => p.length > 4) || right.some((p) => p.length > 4)) return null;

  const missing = 8 - (left.length + right.length);
  if ((pieces.length === 1 && missing !== 0) || missing < 0) return null;

  const full = [...left, ...Array(missing).fill('0'), ...right];
  if (full.length !== 8) return null;

  let acc = 0n;
  for (const part of full) {
    const val = Number.parseInt(part, 16);
    if (!Number.isFinite(val) || val < 0 || val > 0xffff) return null;
    acc = (acc << 16n) | BigInt(val);
  }
  return acc;
}

function ipVersion(ip: string): 4 | 6 | 0 {
  if (parseIPv4Int(ip) !== null) return 4;
  if (parseIPv6BigInt(ip) !== null) return 6;
  return 0;
}

function parseCidr(cidr: string): { version: 4 | 6; network: bigint; prefix: number } | null {
  const trimmed = cidr.trim();
  if (!trimmed) return null;

  const [ipRaw, prefixRaw] = trimmed.split('/');
  if (!ipRaw || prefixRaw === undefined) return null;
  const version = ipVersion(ipRaw);
  if (version === 0) return null;

  const bits = version === 4 ? 32 : 128;
  const prefix = Number(prefixRaw);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > bits) return null;

  const ipValue = version === 4 ? parseIPv4Int(ipRaw)! : parseIPv6BigInt(ipRaw)!;
  const shift = BigInt(bits - prefix);
  const network = shift === 0n ? ipValue : (ipValue >> shift) << shift;
  return { version, network, prefix };
}

function cidrContainsIp(cidr: string, ipRaw: string): boolean {
  const parsed = parseCidr(cidr);
  if (!parsed) return false;

  const ip = normalizeIp(ipRaw);
  const ipV = ipVersion(ip);
  if (ipV !== parsed.version) return false;

  const bits = parsed.version === 4 ? 32 : 128;
  const ipValue = parsed.version === 4 ? parseIPv4Int(ip)! : parseIPv6BigInt(ip)!;
  const shift = BigInt(bits - parsed.prefix);
  const masked = shift === 0n ? ipValue : (ipValue >> shift) << shift;
  return masked === parsed.network;
}

function maskValue(value: string, strategy: HeaderMaskingStrategy): string {
  if (!value) return '[MASKED]';
  if (strategy === 'hash') {
    const digest = crypto.createHash('sha256').update(value).digest('hex').slice(0, 12);
    return `[HASH:${digest}]`;
  }
  if (strategy === 'partial') {
    if (value.length <= 6) return '[PARTIAL]';
    return `${value.slice(0, 4)}...${value.slice(-2)}`;
  }
  return '[REDACTED]';
}

export function getSecurityFeatureFlag(name: 'ip_allowlist' | 'header_masking'): boolean {
  const envName = name === 'ip_allowlist' ? 'FEATURE_IP_ALLOWLIST' : 'FEATURE_HEADER_MASKING';
  const raw = process.env[envName]?.trim().toLowerCase();
  if (!raw) return false;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function parsePartialPolicy(raw: unknown): PartialSecurityPolicy {
  if (!isObject(raw)) return {};

  const ipAllowlist = Array.isArray(raw.ipAllowlist)
    ? raw.ipAllowlist.filter((v): v is string => typeof v === 'string')
    : undefined;
  const maskedHeaders = Array.isArray(raw.maskedHeaders)
    ? raw.maskedHeaders.filter((v): v is string => typeof v === 'string')
    : undefined;

  const strategy = raw.maskingStrategy;
  const maskingStrategy: HeaderMaskingStrategy | undefined =
    strategy === 'partial' || strategy === 'hash' || strategy === 'full' ? strategy : undefined;

  const mtls = raw.mtlsMode;
  const mtlsMode: 'off' | 'optional' | 'required' | undefined =
    mtls === 'off' || mtls === 'optional' || mtls === 'required' ? mtls : undefined;

  return {
    ipAllowlist,
    maskedHeaders,
    maskingStrategy,
    mtlsMode,
  };
}

function getGlobalPolicyFromEnv(): PartialSecurityPolicy {
  const raw = process.env.SECURITY_POLICY_GLOBAL_JSON?.trim();
  if (!raw) return {};
  try {
    return parsePartialPolicy(JSON.parse(raw));
  } catch {
    return {};
  }
}

function getTeamPolicyMapFromEnv(): Record<string, PartialSecurityPolicy> {
  const raw = process.env.SECURITY_POLICY_TEAM_JSON?.trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isObject(parsed)) return {};
    const out: Record<string, PartialSecurityPolicy> = {};
    for (const [key, value] of Object.entries(parsed)) {
      out[key] = parsePartialPolicy(value);
    }
    return out;
  } catch {
    return {};
  }
}

function resolveInheritedIpAllowlist(
  endpoint: PartialSecurityPolicy,
  team: PartialSecurityPolicy,
  global: PartialSecurityPolicy,
): string[] {
  if (endpoint.ipAllowlist && endpoint.ipAllowlist.length > 0) return endpoint.ipAllowlist;
  if (team.ipAllowlist && team.ipAllowlist.length > 0) return team.ipAllowlist;
  if (global.ipAllowlist && global.ipAllowlist.length > 0) return global.ipAllowlist;
  return [];
}

export function resolveEffectiveSecurityPolicy(
  settings: EndpointSettings | unknown,
  teamId?: string | null,
): EndpointSecurityPolicy {
  const endpointPolicy = isObject(settings) ? parsePartialPolicy(settings.securityPolicy) : {};
  const globalPolicy = getGlobalPolicyFromEnv();
  const teamPolicyMap = getTeamPolicyMapFromEnv();
  const teamPolicy = teamId ? (teamPolicyMap[teamId] ?? {}) : {};

  return {
    ipAllowlist: resolveInheritedIpAllowlist(endpointPolicy, teamPolicy, globalPolicy),
    maskedHeaders: toNormalizedHeaderSet([
      ...DEFAULT_MASKED_HEADERS,
      ...(globalPolicy.maskedHeaders ?? []),
      ...(teamPolicy.maskedHeaders ?? []),
      ...(endpointPolicy.maskedHeaders ?? []),
    ]),
    maskingStrategy:
      endpointPolicy.maskingStrategy
      ?? teamPolicy.maskingStrategy
      ?? globalPolicy.maskingStrategy
      ?? 'full',
    mtlsMode:
      endpointPolicy.mtlsMode
      ?? teamPolicy.mtlsMode
      ?? globalPolicy.mtlsMode
      ?? 'off',
  };
}

export function getEndpointSecurityPolicy(settings: EndpointSettings | unknown): EndpointSecurityPolicy {
  return resolveEffectiveSecurityPolicy(settings, null);
}

export function isIpAllowedByPolicy(ip: string | undefined, policy: EndpointSecurityPolicy): boolean {
  if (!policy.ipAllowlist.length) return true;
  if (!ip) return false;

  const normalized = normalizeIp(ip);
  if (normalized === '127.0.0.1' || normalized === '::1') return true;
  return policy.ipAllowlist.some((cidr) => cidrContainsIp(cidr, normalized));
}

export function maskHeadersByPolicy(
  headers: Record<string, string | string[] | undefined>,
  policy: EndpointSecurityPolicy,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const set = new Set(policy.maskedHeaders);

  for (const [key, val] of Object.entries(headers)) {
    if (val === undefined) continue;
    const lower = key.toLowerCase();
    if (!set.has(lower)) {
      out[key] = val;
      continue;
    }

    if (Array.isArray(val)) {
      out[key] = val.map((v) => maskValue(String(v), policy.maskingStrategy));
    } else {
      out[key] = maskValue(String(val), policy.maskingStrategy);
    }
  }

  return out;
}

export function isValidCidr(cidr: string): boolean {
  return parseCidr(cidr) !== null;
}
