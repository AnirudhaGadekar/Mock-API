/**
 * api.ts – MockAPI Console API client.
 *
 * MockAPI-style: auto-creates an anonymous session on first visit.
 */
import axios from 'axios';

const KNOWN_API_ORIGINS: Record<string, string> = {
  'mockapi.online': 'https://api.mockapi.online',
  'www.mockapi.online': 'https://api.mockapi.online',
};

axios.defaults.withCredentials = true;

function resolveApiBaseUrl(): string {
  const configured = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
  if (configured) {
    return configured.replace(/\/+$/, '');
  }

  const knownApiOrigin = KNOWN_API_ORIGINS[window.location.hostname.toLowerCase()];
  if (knownApiOrigin) {
    return knownApiOrigin;
  }

  return window.location.origin;
}

export const API_BASE_URL = resolveApiBaseUrl();
export const api = axios.create({ baseURL: API_BASE_URL, withCredentials: true });

// Module-level ref so the interceptor always sees the latest key without re-registering.
let _apiKey = '';

export function getApiKey(): string {
  return _apiKey;
}

export function setApiKeyRef(key: string) {
  _apiKey = key;
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
  const res = await axios.post(`${API_BASE_URL}/api/v2/session`, undefined, { withCredentials: true });

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
  settings?: Record<string, any>;
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

export interface LiveSummaryResponse {
  success: boolean;
  summary: {
    isActive: boolean;
    requestCount1m: number;
    requestCount5m: number;
    errorCount5m: number;
    errorRate5m: number;
    lastSeenAt: string | null;
    websocketSubscribers: number;
  };
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
  const res = await api.get<{ success: boolean; data: { endpoints: Endpoint[] } }>(
    '/api/v2/endpoints?limit=50&sort=createdAt%3Adesc',
  );
  return res.data.data?.endpoints ?? [];
}

export async function createEndpoint(name: string): Promise<Endpoint> {
  const res = await api.post<{ success: boolean; data: Endpoint }>(
    '/api/v2/endpoints',
    { name },
  );
  return res.data.data;
}

export async function deleteEndpoint(id: string): Promise<void> {
  await api.delete(`/api/v2/endpoints/${id}`);
}

export async function fetchEndpoint(id: string): Promise<EndpointDetail> {
  const res = await api.get<{ success: boolean; data: EndpointDetail }>(`/api/v2/endpoints/${id}`);
  return res.data.data;
}

export async function updateEndpoint(id: string, patch: { name?: string; rules?: any[]; settings?: any }): Promise<Endpoint> {
  const res = await api.patch<{ success: boolean; data: Endpoint }>(`/api/v2/endpoints/${id}`, patch);
  return res.data.data;
}

export async function fetchHistory(
  endpointId: string,
  params?: { search?: string; method?: string; status?: string; limit?: number },
): Promise<HistoryResponse> {
  const res = await api.get<HistoryResponse>(`/api/v2/history/${endpointId}`, {
    params: { limit: 50, ...params },
  });
  return res.data;
}

export async function fetchLiveSummary(endpointId: string): Promise<LiveSummaryResponse['summary']> {
  const res = await api.get<LiveSummaryResponse>(`/api/v2/history/${endpointId}/live-summary`);
  return res.data.summary;
}


// Chaos config helpers
export async function fetchChaosConfig(endpointId: string): Promise<ChaosConfig> {
  const res = await api.get<{ success: boolean; config: ChaosConfig }>(
    `/api/v2/chaos/${endpointId}`,
  );
  return res.data.config;
}

export async function updateChaosConfig(
  endpointId: string,
  patch: Partial<ChaosConfig>,
): Promise<ChaosConfig> {
  const res = await api.put<{ success: boolean; config: ChaosConfig }>(
    `/api/v2/chaos/${endpointId}`,
    patch,
  );
  return res.data.config;
}

// State store helpers
export async function fetchStateKeys(endpointId: string): Promise<string[]> {
  const res = await api.get<{ success: boolean; keys: string[] }>(
    `/api/v2/state/${endpointId}`,
  );
  return res.data.keys;
}

export async function fetchStateValue(endpointId: string, key: string): Promise<any> {
  const res = await api.get<{ success: boolean; value: any }>(
    `/api/v2/state/${endpointId}/${key}`,
  );
  return res.data.value;
}

export async function setStateValue(endpointId: string, key: string, value: any): Promise<void> {
  await api.post(`/api/v2/state/${endpointId}/${key}`, { value });
}

export async function deleteStateValue(endpointId: string, key: string): Promise<void> {
  await api.delete(`/api/v2/state/${endpointId}/${key}`);
}

// ─── Recorder / Proposals ─────────────────────────────────────────────────────

export interface RecorderProposal {
  id: string;
  recorderSessionId: string;
  endpointId: string;
  method: string;
  normalizedPath: string;
  responseStatus: number;
  count: number;
  confidence: number;
  status: string;
  createdAt: string;
  decidedAt: string | null;
  metadata: {
    workspaceId: string;
  };
  proposedRule: unknown;
  sample?: unknown;
}

export interface RecorderProposalPage {
  proposals: RecorderProposal[];
  nextCursor: string | null;
  hasMore: boolean;
}

export async function fetchRecorderProposals(
  recorderSessionId: string,
  params?: { limit?: number; cursor?: string; status?: 'PENDING' | 'APPROVED' | 'REJECTED' },
): Promise<RecorderProposalPage> {
  const res = await api.get<{
    success: boolean;
    data: RecorderProposalPage;
  }>(`/api/v2/recorder-sessions/${recorderSessionId}/proposals`, { params });
  return res.data.data;
}

export async function approveRecorderProposal(
  recorderSessionId: string,
  proposalId: string,
  mode: 'append' | 'replace' = 'append',
): Promise<void> {
  await api.post(`/api/v2/recorder-sessions/${recorderSessionId}/proposals/${proposalId}/approve`, { mode });
}

export async function importOpenApi(spec: string): Promise<{ success: boolean; message: string; endpoints: any[] }> {
  const res = await api.post<{ success: boolean; message: string; endpoints: any[] }>(
    '/api/v2/oas-import',
    { spec }
  );
  return res.data;
}

// ─── Team API ──────────────────────────────────────────────────────────────────

export interface Team {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  role?: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';
  members?: TeamMember[];
}

export interface TeamMember {
  id: string;
  userId: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';
  user: {
    id: string;
    email: string;
  };
  joinedAt: string;
}

export async function fetchUserTeams(): Promise<Team[]> {
  const res = await api.get<Team[]>('/api/v2/teams');
  return res.data;
}

export async function createTeam(name: string, slug: string): Promise<Team> {
  const res = await api.post<Team>('/api/v2/teams', { name, slug });
  return res.data;
}

export async function fetchTeam(teamId: string): Promise<Team> {
  const res = await api.get<Team>(`/api/v2/teams/${teamId}`);
  return res.data;
}

export async function inviteMember(teamId: string, email: string, role: string): Promise<any> {
  const res = await api.post(`/api/v2/teams/${teamId}/invites`, { email, role });
  return res.data;
}

export async function updateMemberRole(teamId: string, userId: string, role: string): Promise<void> {
  await api.patch(`/api/v2/teams/${teamId}/members/${userId}`, { role });
}

export async function removeMember(teamId: string, userId: string): Promise<void> {
  await api.delete(`/api/v2/teams/${teamId}/members/${userId}`);
}

export async function shareEndpoint(endpointId: string, teamId: string): Promise<void> {
  // We need to update the endpoint with teamId
  // This might require a new endpoint or updating the existing updateEndpoint to support teamId
  await api.patch(`/api/v2/endpoints/${endpointId}`, { teamId, isShared: true });
}

export async function switchWorkspace(type: 'personal' | 'team', teamId?: string): Promise<void> {
  await api.post('/api/v2/workspace/switch', { type, teamId });
}

export async function fetchCurrentWorkspace(): Promise<{ type: 'personal' | 'team'; teamId: string | null }> {
  const res = await api.get<{ type: 'personal' | 'team'; teamId: string | null }>('/api/v2/workspace/current');
  return res.data;
}
