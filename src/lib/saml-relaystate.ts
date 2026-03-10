import crypto from 'crypto';

type RelayStatePayload = {
  teamId: string;
  exp: number;
  nonce: string;
};

function getSecret(): string | null {
  const fromEnv = process.env.SAML_RELAYSTATE_SECRET?.trim();
  if (fromEnv) return fromEnv;
  const fallback = process.env.JWT_SECRET?.trim();
  if (fallback) return fallback;
  return null;
}

function base64url(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

function parseBase64url(input: string): string | null {
  try {
    return Buffer.from(input, 'base64url').toString('utf8');
  } catch {
    return null;
  }
}

function sign(body: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('base64url');
}

function timingSafeEqualString(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function createSignedRelayState(teamId: string, ttlSec = 300): string {
  const secret = getSecret();
  if (!secret) {
    throw new Error('SAML relay state secret is not configured');
  }
  const now = Math.floor(Date.now() / 1000);
  const payload: RelayStatePayload = {
    teamId,
    exp: now + Math.max(30, ttlSec),
    nonce: crypto.randomBytes(8).toString('hex'),
  };
  const body = base64url(JSON.stringify(payload));
  const signature = sign(body, secret);
  return `v1.${body}.${signature}`;
}

export function resolveRelayStateTeamId(rawRelayState: string | null | undefined): {
  teamId: string | null;
  signed: boolean;
  valid: boolean;
  reason?: string;
} {
  const relay = rawRelayState?.trim();
  if (!relay) return { teamId: null, signed: false, valid: true };

  if (!relay.startsWith('v1.')) {
    return { teamId: relay, signed: false, valid: true };
  }

  const secret = getSecret();
  if (!secret) {
    return { teamId: null, signed: true, valid: false, reason: 'RelayState signing secret is not configured' };
  }

  const parts = relay.split('.');
  if (parts.length !== 3) {
    return { teamId: null, signed: true, valid: false, reason: 'RelayState format is invalid' };
  }

  const body = parts[1];
  const sig = parts[2];
  const expected = sign(body, secret);
  if (!timingSafeEqualString(sig, expected)) {
    return { teamId: null, signed: true, valid: false, reason: 'RelayState signature is invalid' };
  }

  const decoded = parseBase64url(body);
  if (!decoded) {
    return { teamId: null, signed: true, valid: false, reason: 'RelayState payload is invalid base64' };
  }

  let payload: RelayStatePayload;
  try {
    payload = JSON.parse(decoded) as RelayStatePayload;
  } catch {
    return { teamId: null, signed: true, valid: false, reason: 'RelayState payload is invalid JSON' };
  }

  if (!payload.teamId || typeof payload.teamId !== 'string') {
    return { teamId: null, signed: true, valid: false, reason: 'RelayState missing teamId' };
  }
  if (!payload.exp || !Number.isFinite(payload.exp)) {
    return { teamId: null, signed: true, valid: false, reason: 'RelayState missing exp' };
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) {
    return { teamId: null, signed: true, valid: false, reason: 'RelayState has expired' };
  }

  return { teamId: payload.teamId, signed: true, valid: true };
}
