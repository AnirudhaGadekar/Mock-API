import { lookup } from 'node:dns/promises';
import net from 'node:net';

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  if (a === 0) return true;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 192 && b === 0) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === '::' || normalized === '::1') return true;
  if (normalized.startsWith('fe80:')) return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (normalized.startsWith('::ffff:')) {
    const v4 = normalized.slice('::ffff:'.length);
    return isPrivateIPv4(v4);
  }
  return false;
}

function isDisallowedHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === 'localhost') return true;
  if (h.endsWith('.localhost')) return true;
  if (h.endsWith('.local')) return true;
  if (h === 'metadata.google.internal') return true;
  if (h === '169.254.169.254') return true;
  return false;
}

function parseAllowedWebhookHosts(): string[] {
  const raw = process.env.WEBHOOK_ALLOWED_HOSTS;
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function hostMatchesAllowlist(hostname: string, allow: string[]): boolean {
  if (allow.length === 0) return true;
  const h = hostname.toLowerCase();
  return allow.some((entry) => {
    if (entry.startsWith('*.')) {
      const suffix = entry.slice(1);
      return h.endsWith(suffix);
    }
    return h === entry;
  });
}

export async function assertSafeWebhookUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('Invalid webhook URL');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Webhook URL must be http(s)');
  }

  if (url.username || url.password) {
    throw new Error('Webhook URL must not contain credentials');
  }

  const hostname = url.hostname;
  if (!hostname) {
    throw new Error('Webhook URL missing hostname');
  }

  if (isDisallowedHostname(hostname)) {
    throw new Error('Webhook hostname is not allowed');
  }

  const allow = parseAllowedWebhookHosts();
  if (!hostMatchesAllowlist(hostname, allow)) {
    throw new Error('Webhook hostname is not in allowlist');
  }

  if (net.isIP(hostname)) {
    const family = net.isIP(hostname);
    if (family === 4 && isPrivateIPv4(hostname)) throw new Error('Webhook target IP is not allowed');
    if (family === 6 && isPrivateIPv6(hostname)) throw new Error('Webhook target IP is not allowed');
    return url;
  }

  const addrs = await lookup(hostname, { all: true, verbatim: true });
  if (!addrs || addrs.length === 0) {
    throw new Error('Webhook hostname did not resolve');
  }

  for (const addr of addrs) {
    if (addr.family === 4 && isPrivateIPv4(addr.address)) {
      throw new Error('Webhook resolved to a private IP');
    }
    if (addr.family === 6 && isPrivateIPv6(addr.address)) {
      throw new Error('Webhook resolved to a private IP');
    }
  }

  return url;
}
