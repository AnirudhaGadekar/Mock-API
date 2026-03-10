import crypto from 'crypto';

export type RecorderClusterKey = {
  method: string;
  pathTemplate: string;
  status: number;
  contentType?: string;
  hasAuth?: boolean;
};

export type RecorderProposal = {
  id: string;
  method: string;
  pathTemplate: string;
  status: number;
  count: number;
  confidence: number;
  metadata: {
    contentType?: string;
    hasAuth?: boolean;
  };
  sample: {
    path: string;
    queryParams?: unknown;
    headers?: unknown;
    body?: unknown;
  };
  proposedRule: {
    path: string;
    method: string;
    response: {
      status: number;
      body: unknown;
      headers: Record<string, string>;
    };
  };
};

function stableId(input: unknown): string {
  const str = typeof input === 'string' ? input : JSON.stringify(input);
  return crypto.createHash('sha1').update(str).digest('hex').slice(0, 16);
}

function looksLikeUuid(segment: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(segment);
}

function looksLikeHex(segment: string): boolean {
  return /^[0-9a-f]{16,}$/i.test(segment);
}

function looksLikeNumber(segment: string): boolean {
  return /^\d{2,}$/.test(segment);
}

function looksLikeBase64url(segment: string): boolean {
  return /^[A-Za-z0-9_-]{16,}$/.test(segment);
}

export function normalizePathTemplate(pathname: string): string {
  const path = (pathname || '').split('?')[0] || '/';
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 0) return '/';

  let idCounter = 0;
  const normalized = parts.map((seg) => {
    const s = seg.trim();
    if (!s) return s;
    if (looksLikeUuid(s) || looksLikeHex(s) || looksLikeNumber(s) || looksLikeBase64url(s)) {
      idCounter += 1;
      return `{id${idCounter}}`;
    }
    return s;
  });

  return '/' + normalized.join('/');
}

function confidenceFromCount(count: number): number {
  if (count <= 1) return 0.35;
  if (count <= 3) return 0.6;
  if (count <= 10) return 0.8;
  return 0.9;
}

export function clusterRequestLogs(logs: Array<{
  method: string;
  path: string;
  responseStatus: number;
  headers?: Record<string, unknown>;
  queryParams?: unknown;
  body?: unknown;
}>): RecorderProposal[] {
  const map = new Map<string, {
    key: RecorderClusterKey;
    count: number;
    sample: { path: string; queryParams?: unknown; headers?: unknown; body?: unknown };
  }>();

  for (const log of logs) {
    const method = String(log.method || '').toUpperCase();
    const status = Number(log.responseStatus || 0);
    const pathTemplate = normalizePathTemplate(String(log.path || '/'));
    if (!method || !pathTemplate || !Number.isFinite(status) || status <= 0) continue;

    const rawHeaders = log.headers ?? {};
    const headers = typeof rawHeaders === 'object' && rawHeaders !== null ? rawHeaders : {};
    const headerKeys = Object.keys(headers).map((h) => h.toLowerCase());
    const contentType = headerKeys.find((h) => h === 'content-type') ? String((headers as any)['content-type']) : undefined;
    const hasAuth = headerKeys.some((h) => h === 'authorization' || h === 'x-api-key');

    const k: RecorderClusterKey = { method, pathTemplate, status, contentType, hasAuth };
    const mapKey = `${method}:${status}:${pathTemplate}:${contentType ?? 'none'}:${hasAuth ? 'auth' : 'anon'}`;
    const existing = map.get(mapKey);
    if (!existing) {
      map.set(mapKey, {
        key: k,
        count: 1,
        sample: {
          path: String(log.path || '/'),
          queryParams: log.queryParams,
          headers: log.headers,
          body: log.body,
        },
      });
    } else {
      existing.count += 1;
    }
  }

  const proposals: RecorderProposal[] = [];
  for (const entry of map.values()) {
      const { method, pathTemplate, status, contentType, hasAuth } = entry.key;
    const proposalId = stableId(entry.key);

    proposals.push({
      id: proposalId,
      method,
      pathTemplate,
      status,
      count: entry.count,
      confidence: confidenceFromCount(entry.count),
        metadata: {
          contentType,
          hasAuth,
        },
      sample: entry.sample,
      proposedRule: {
        path: pathTemplate,
        method,
        response: {
          status,
          body: {
            mocked: true,
            recorder: 'proposal',
            method,
            path: pathTemplate,
            status,
          },
          headers: { 'content-type': 'application/json' },
        },
      },
    });
  }

  proposals.sort((a, b) => b.confidence - a.confidence || b.count - a.count);
  return proposals;
}

