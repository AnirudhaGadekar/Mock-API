const RESERVED_MOCK_SUBDOMAINS = [
  'api',
  'app',
  'auth',
  'console',
  'docs',
  'documentation',
  'health',
  'healthz',
  'invite',
  'metrics',
  'www',
] as const;

export function getReservedMockSubdomains(): string[] {
  return [...RESERVED_MOCK_SUBDOMAINS];
}

export function isReservedMockSubdomain(value: string | null | undefined): boolean {
  if (!value) return false;
  return RESERVED_MOCK_SUBDOMAINS.includes(value.trim().toLowerCase() as typeof RESERVED_MOCK_SUBDOMAINS[number]);
}
