const API_KEY_COOKIE_NAME = 'mockurl_api_key';
const DEFAULT_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

function parseDurationToSeconds(raw: string): number | null {
  const trimmed = raw.trim();

  if (/^\d+$/.test(trimmed)) {
    const seconds = Number.parseInt(trimmed, 10);
    return seconds > 0 ? seconds : null;
  }

  const match = trimmed.match(/^(\d+)\s*([smhd])$/i);
  if (!match) {
    return null;
  }

  const value = Number.parseInt(match[1], 10);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }

  const unit = match[2].toLowerCase();
  if (unit === 's') return value;
  if (unit === 'm') return value * 60;
  if (unit === 'h') return value * 60 * 60;
  if (unit === 'd') return value * 60 * 60 * 24;

  return null;
}

function resolveCookieMaxAgeSeconds(): number {
  const rawMaxAge =
    process.env.API_KEY_COOKIE_MAX_AGE_SECONDS ??
    process.env.JWT_EXPIRY ??
    process.env.JWT_EXPIRES_IN;

  if (!rawMaxAge) {
    return DEFAULT_COOKIE_MAX_AGE_SECONDS;
  }

  const parsed = parseDurationToSeconds(rawMaxAge);
  if (parsed !== null) {
    return parsed;
  }

  return DEFAULT_COOKIE_MAX_AGE_SECONDS;
}

export function getApiKeyCookieName(): string {
  return API_KEY_COOKIE_NAME;
}

export function getApiKeyCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'none' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: resolveCookieMaxAgeSeconds(),
  };
}
