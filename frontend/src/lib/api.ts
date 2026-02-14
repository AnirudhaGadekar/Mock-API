/**
 * api.ts – MockUrl Console API client.
 *
 * Beeceptor-style: auto-creates an anonymous session on first visit.
 * The API key is stored in localStorage and injected automatically.
 */
import axios from 'axios';

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000';
const LS_KEY = 'mockurl_api_key';

export const api = axios.create({ baseURL: API_BASE });

// Module-level ref so the interceptor always sees the latest key without re-registering.
let _apiKey = localStorage.getItem(LS_KEY) ?? '';

export function getApiKey(): string {
  return _apiKey;
}

export function setApiKeyRef(key: string) {
  _apiKey = key;
  if (key) {
    localStorage.setItem(LS_KEY, key);
  } else {
    localStorage.removeItem(LS_KEY);
  }
}

// Attach the X-API-Key header on every outgoing request.
api.interceptors.request.use((config) => {
  if (_apiKey) {
    config.headers = config.headers ?? {};
    (config.headers as Record<string, string>)['X-API-Key'] = _apiKey;
  }
  return config;
});

// ─── Session Management ──────────────────────────────────────────────────────

/**
 * Initialize session — auto-creates anonymous user if needed.
 * Returns the API key (existing or newly created).
 */
export async function initSession(): Promise<string> {
  // 1. Check if we already have a stored key
  const existingKey = localStorage.getItem(LS_KEY);

  if (existingKey) {
    // Validate it
    try {
      const res = await axios.get(`${API_BASE}/api/v1/session/me`, {
        headers: { 'X-API-Key': existingKey },
      });
      if (res.data.success) {
        setApiKeyRef(existingKey);
        return existingKey;
      }
    } catch {
      // Key is invalid — clear it and create a new session
      localStorage.removeItem(LS_KEY);
    }
  }

  // 2. No valid key — create a new anonymous session
  const res = await axios.post(`${API_BASE}/api/v1/session`);

  if (res.data.success && res.data.session?.apiKey) {
    const newKey = res.data.session.apiKey as string;
    setApiKeyRef(newKey);
    return newKey;
  }

  throw new Error('Failed to create session');
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Endpoint {
  id: string;
  name: string;
  subdomain: string;
  url: string;
  dashboardUrl: string;
  rules: unknown[];
  reqCount: number;
  createdAt: string;
}

export interface EndpointDetail extends Endpoint {
  stats: { req24h: number; total: number };
}

export interface HistoryItem {
  id: string;
  endpointId: string;
  timestamp: string;
  method: string;
  path: string;
  query?: Record<string, unknown>;
  headers?: Record<string, string>;
  body?: string;
  ip?: string;
  userAgent?: string;
  responseStatus?: number;
  responseHeaders?: Record<string, string>;
  responseBody?: string;
  latencyMs?: number;
}

export interface HistoryFacets {
  topPaths: { path: string; count: number }[];
  topMethods: { method: string; count: number }[];
  statusCounts: Record<string, number>;
}

export interface HistoryResponse {
  success: boolean;
  history: HistoryItem[];
  facets: HistoryFacets;
  retentionDays: number;
  totalCount: number;
  timestamp: string;
}

export interface ChaosConfig {
  enabled: boolean;
  delay?: { min: number; max: number };
  timeout?: { probability: number; durationMs?: number };
  errorInject?: { probability: number; status: number; body?: string };
  jitter?: { ms: number };
  rateLimit?: { rpm: number; perIp: boolean };
}

// ─── API helpers ───────────────────────────────────────────────────────────────

export async function fetchEndpoints(): Promise<Endpoint[]> {
  const res = await api.get<{ success: boolean; endpoints: Endpoint[] }>(
    '/api/v1/endpoints?limit=50&sort=createdAt%3Adesc',
  );
  return res.data.endpoints ?? [];
}

export async function createEndpoint(name: string): Promise<Endpoint> {
  const res = await api.post<{ success: boolean; endpoint: Endpoint }>(
    '/api/v1/endpoints/create',
    { name },
  );
  return res.data.endpoint;
}

export async function deleteEndpoint(id: string): Promise<void> {
  await api.delete(`/api/v1/endpoints/${id}`);
}

export async function fetchEndpoint(id: string): Promise<EndpointDetail> {
  const res = await api.get<{ success: boolean } & EndpointDetail>(`/api/v1/endpoints/${id}`);
  return res.data;
}

export async function updateEndpoint(id: string, patch: { name?: string; rules?: any[]; settings?: any }): Promise<Endpoint> {
  const res = await api.patch<{ success: boolean; endpoint: Endpoint }>(`/api/v1/endpoints/${id}`, patch);
  return res.data.endpoint;
}

export async function fetchHistory(
  endpointId: string,
  params?: { search?: string; method?: string; status?: string; limit?: number },
): Promise<HistoryResponse> {
  const res = await api.get<HistoryResponse>(`/api/v1/history/${endpointId}`, {
    params: { limit: 50, ...params },
  });
  return res.data;
}


// Chaos config helpers
export async function fetchChaosConfig(endpointId: string): Promise<ChaosConfig> {
  const res = await api.get<{ success: boolean; config: ChaosConfig }>(
    `/api/v1/chaos/${endpointId}`,
  );
  return res.data.config;
}

export async function updateChaosConfig(
  endpointId: string,
  patch: Partial<ChaosConfig>,
): Promise<ChaosConfig> {
  const res = await api.put<{ success: boolean; config: ChaosConfig }>(
    `/api/v1/chaos/${endpointId}`,
    patch,
  );
  return res.data.config;
}

// State store helpers
export async function fetchStateKeys(endpointId: string): Promise<string[]> {
  const res = await api.get<{ success: boolean; keys: string[] }>(
    `/api/v1/state/${endpointId}`,
  );
  return res.data.keys;
}

export async function fetchStateValue(endpointId: string, key: string): Promise<any> {
  const res = await api.get<{ success: boolean; value: any }>(
    `/api/v1/state/${endpointId}/${key}`,
  );
  return res.data.value;
}

export async function setStateValue(endpointId: string, key: string, value: any): Promise<void> {
  await api.post(`/api/v1/state/${endpointId}/${key}`, { value });
}

export async function deleteStateValue(endpointId: string, key: string): Promise<void> {
  await api.delete(`/api/v1/state/${endpointId}/${key}`);
}

export async function importOpenApi(spec: string): Promise<{ success: boolean; message: string; endpoints: any[] }> {
  const res = await api.post<{ success: boolean; message: string; endpoints: any[] }>(
    '/api/v1/oas-import',
    { spec }
  );
  return res.data;
}
