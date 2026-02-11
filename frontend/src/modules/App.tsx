import React, { useEffect, useMemo, useState } from 'react';
import { Toaster, toast } from 'react-hot-toast';
import { Activity, Network, Server, Trash2, Link2, RefreshCw } from 'lucide-react';
import axios from 'axios';
import clsx from 'clsx';

import '../style.css';

type EndpointSummary = {
  id: string;
  name: string;
  subdomain: string;
  url: string;
  dashboardUrl: string;
  reqCount: number;
  createdAt: string;
};

type HistoryItem = {
  id: string;
  timestamp: string;
  method: string;
  path: string;
  status?: number;
  latencyMs?: number;
  ip?: string;
};

type AdminOverview = {
  endpoints: number;
  users: number;
  requestsToday: number;
  errorRate: number;
  errorRateAbove5: boolean;
};

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

const api = axios.create({
  baseURL: API_BASE,
});

function useApiKey() {
  const [value, setValue] = useState<string>(() => localStorage.getItem('mockurl_api_key') ?? '');

  useEffect(() => {
    if (value) {
      localStorage.setItem('mockurl_api_key', value);
    }
  }, [value]);

  useEffect(() => {
    api.interceptors.request.use((config) => {
      if (value) {
        config.headers = config.headers ?? {};
        (config.headers as any)['x-api-key'] = value;
      }
      return config;
    });
  }, [value]);

  return { apiKey: value, setApiKey: setValue };
}

const pattern = /^[a-z0-9-]{5,40}$/;

export const App: React.FC = () => {
  const { apiKey, setApiKey } = useApiKey();

  const [endpoints, setEndpoints] = useState<EndpointSummary[]>([]);
  const [loadingEndpoints, setLoadingEndpoints] = useState(false);
  const [selectedEndpointId, setSelectedEndpointId] = useState<string | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [adminOverview, setAdminOverview] = useState<AdminOverview | null>(null);
  const [loadingAdmin, setLoadingAdmin] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  const selectedEndpoint = useMemo(
    () => endpoints.find((e) => e.id === selectedEndpointId) ?? null,
    [endpoints, selectedEndpointId],
  );

  async function loadEndpoints() {
    if (!apiKey) return;
    setLoadingEndpoints(true);
    try {
      const res = await api.get('/api/v1/endpoints?limit=50&sort=createdAt:desc');
      setEndpoints(res.data.endpoints ?? res.data.data?.endpoints ?? []);
    } catch (err: any) {
      console.error(err);
      toast.error('Failed to load endpoints');
    } finally {
      setLoadingEndpoints(false);
    }
  }

  async function loadHistory(endpointId: string) {
    setLoadingHistory(true);
    try {
      const res = await api.get(`/api/v1/history/${endpointId}?limit=50`);
      const logs = res.data.history ?? [];
      setHistory(
        logs.map((l: any) => ({
          id: l.id,
          timestamp: l.timestamp,
          method: l.method,
          path: l.path,
          status: l.responseStatus ?? undefined,
          latencyMs: l.latencyMs ?? undefined,
          ip: l.ip ?? undefined,
        })),
      );
    } catch (err: any) {
      console.error(err);
      toast.error('Failed to load history');
    } finally {
      setLoadingHistory(false);
    }
  }

  async function loadAdminOverview() {
    if (!apiKey) return;
    setLoadingAdmin(true);
    try {
      const res = await api.get('/api/v1/admin/overview');
      setAdminOverview(res.data.overview);
    } catch {
      // silently ignore – non-admin users will get 403
      setAdminOverview(null);
    } finally {
      setLoadingAdmin(false);
    }
  }

  useEffect(() => {
    if (!apiKey) return;
    void loadEndpoints();
    void loadAdminOverview();
  }, [apiKey]);

  async function handleCreateEndpoint(e: React.FormEvent) {
    e.preventDefault();
    if (!apiKey) {
      toast.error('Set API key first');
      return;
    }
    if (!pattern.test(newName)) {
      toast.error('Name must be 5–40 chars, lowercase, digits and hyphens only');
      return;
    }
    setCreating(true);
    try {
      const res = await api.post('/api/v1/endpoints/create', { name: newName });
      const ep = res.data.endpoint ?? res.data.data;
      setEndpoints((prev) => [ep, ...prev]);
      setNewName('');
      toast.success('Endpoint created');
    } catch (err: any) {
      console.error(err);
      const msg = err?.response?.data?.error?.message ?? 'Failed to create endpoint';
      toast.error(msg);
    } finally {
      setCreating(false);
    }
  }

  async function handleDeleteEndpoint(id: string) {
    if (!confirm('Delete this endpoint? This is a soft delete and can break mock clients.')) return;
    try {
      await api.delete(`/api/v1/endpoints/${id}`);
      setEndpoints((prev) => prev.filter((e) => e.id !== id));
      if (selectedEndpointId === id) {
        setSelectedEndpointId(null);
        setHistory([]);
      }
      toast.success('Endpoint deleted');
    } catch (err: any) {
      console.error(err);
      toast.error('Failed to delete endpoint');
    }
  }

  function copy(text: string, label: string) {
    navigator.clipboard
      .writeText(text)
      .then(() => toast.success(`${label} copied`))
      .catch(() => toast.error('Failed to copy'));
  }

  return (
    <>
      <Toaster position="top-right" />
      <div
        className="min-h-screen text-slate-100"
        style={{
          background:
            'radial-gradient(circle at top left, #0f172a, #020617 45%, #000 100%)',
        }}
      >
        <header className="border-b border-slate-800 bg-black/30 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-400">
                <Network className="h-5 w-5" />
              </div>
              <div>
                <div className="text-sm font-semibold tracking-wide text-slate-100">
                  MockUrl Console
                </div>
                <div className="text-xs text-slate-400">
                  Beeceptor-style mock endpoint explorer
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <input
                className="w-56 rounded-md border border-slate-700 bg-slate-900/70 px-3 py-1.5 text-xs text-slate-100 outline-none ring-emerald-500/30 placeholder:text-slate-500 focus:border-emerald-500 focus:ring-2"
                placeholder="Paste X-API-Key to connect…"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value.trim())}
              />
              <button
                type="button"
                onClick={() => {
                  void loadEndpoints();
                  void loadAdminOverview();
                }}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-900/70 px-3 py-1.5 text-xs font-medium text-slate-100 hover:border-emerald-500 hover:text-emerald-300"
              >
                <RefreshCw className="h-3 w-3" />
                Refresh
              </button>
            </div>
          </div>
        </header>

        <main className="mx-auto flex max-w-6xl gap-4 px-4 py-4">
          <section className="w-72 shrink-0 space-y-4 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
                <Activity className="h-4 w-4 text-emerald-400" />
                Your endpoints
              </div>
              {loadingEndpoints && (
                <span className="text-[10px] text-slate-500">Loading…</span>
              )}
            </div>

            <form onSubmit={handleCreateEndpoint} className="space-y-2 rounded-md bg-slate-900/60 p-2">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-slate-300">
                  Create endpoint
                </span>
                <input
                  className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 outline-none ring-emerald-500/30 placeholder:text-slate-500 focus:border-emerald-500 focus:ring-2"
                  placeholder="e.g. my-mock-api"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
              </label>
              <p className="text-[10px] text-slate-500">
                5–40 chars, lowercase letters, numbers and dashes.
              </p>
              <button
                type="submit"
                disabled={creating}
                className={clsx(
                  'flex w-full items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-semibold transition',
                  creating
                    ? 'cursor-wait bg-emerald-900/60 text-emerald-300'
                    : 'bg-emerald-600 text-emerald-50 hover:bg-emerald-500',
                )}
              >
                {creating ? 'Creating…' : 'Create endpoint'}
              </button>
            </form>

            <div className="h-[360px] space-y-1 overflow-y-auto pr-1 text-xs">
              {endpoints.length === 0 && !loadingEndpoints && (
                <div className="rounded-md border border-dashed border-slate-700 bg-slate-900/60 p-3 text-[11px] text-slate-400">
                  No endpoints yet. Create one above to get a live mock URL.
                </div>
              )}

              {endpoints.map((ep) => (
                <button
                  key={ep.id}
                  type="button"
                  onClick={() => {
                    setSelectedEndpointId(ep.id);
                    void loadHistory(ep.id);
                  }}
                  className={clsx(
                    'group flex w-full items-center justify-between rounded-md border px-2 py-1.5 text-left text-[11px]',
                    selectedEndpointId === ep.id
                      ? 'border-emerald-500/80 bg-slate-900/80'
                      : 'border-slate-800 bg-slate-900/40 hover:border-slate-600',
                  )}
                >
                  <div className="min-w-0">
                    <div className="truncate text-slate-100">{ep.name}</div>
                    <div className="truncate text-[10px] text-slate-500">
                      {ep.reqCount} requests
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleDeleteEndpoint(ep.id);
                    }}
                    className="ml-2 inline-flex h-5 w-5 items-center justify-center rounded-full text-slate-500 opacity-0 ring-emerald-500/40 hover:bg-red-900/40 hover:text-red-300 group-hover:opacity-100 focus-visible:ring-2"
                    aria-label="Delete endpoint"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </button>
              ))}
            </div>
          </section>

          <section className="flex-1 space-y-4">
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
              {selectedEndpoint ? (
                <>
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-emerald-400">
                        Endpoint
                      </div>
                      <div className="text-lg font-semibold text-slate-50">
                        {selectedEndpoint.name}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-900/80 px-2 py-0.5">
                          <Server className="h-3 w-3 text-emerald-400" />
                          {selectedEndpoint.reqCount} requests
                        </span>
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-900/80 px-2 py-0.5">
                          Created{' '}
                          {new Date(selectedEndpoint.createdAt).toLocaleString()}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2 text-right text-[11px]">
                      <div className="font-mono text-xs text-emerald-300">
                        {selectedEndpoint.url}
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => copy(selectedEndpoint.url, 'Mock URL')}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-[11px] text-slate-100 hover:border-emerald-500 hover:text-emerald-300"
                        >
                          <Link2 className="h-3 w-3" />
                          Copy URL
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            window.open(selectedEndpoint.url, '_blank', 'noreferrer')
                          }
                          className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-[11px] text-slate-100 hover:border-emerald-500 hover:text-emerald-300"
                        >
                          Open
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 rounded-md border border-slate-800 bg-slate-950/80 p-3">
                    <div className="text-[11px] font-medium text-slate-300">
                      Quick test (curl)
                    </div>
                    <pre className="mt-1 overflow-x-auto rounded-md bg-black/60 p-2 text-[11px] text-emerald-200">
{`curl -X GET \\
  '${selectedEndpoint.url}/todo' \\
  -H 'X-Request-ID: demo-1'`}
                    </pre>
                  </div>
                </>
              ) : (
                <div className="flex h-40 flex-col items-center justify-center gap-2 text-sm text-slate-400">
                  <p>Select an endpoint on the left to see its mock URL and request history.</p>
                  <p className="text-[11px] text-slate-500">
                    Start by creating an endpoint and hitting it from Postman or curl.
                  </p>
                </div>
              )}
            </div>

            <div className="flex gap-4">
              <div className="flex-1 rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
                    <Activity className="h-4 w-4 text-emerald-400" />
                    Request history (latest 50)
                  </div>
                  {loadingHistory && (
                    <span className="text-[10px] text-slate-500">Loading…</span>
                  )}
                </div>
                <div className="h-64 overflow-x-auto">
                  <table className="min-w-full border-separate border-spacing-y-1 text-[11px]">
                    <thead className="text-[10px] uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-2 py-1 text-left">Time</th>
                        <th className="px-2 py-1 text-left">Method</th>
                        <th className="px-2 py-1 text-left">Path</th>
                        <th className="px-2 py-1 text-left">Status</th>
                        <th className="px-2 py-1 text-left">Latency</th>
                        <th className="px-2 py-1 text-left">IP</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.length === 0 && (
                        <tr>
                          <td
                            colSpan={6}
                            className="px-2 py-6 text-center text-[11px] text-slate-500"
                          >
                            No requests logged yet. Hit your mock URL and refresh.
                          </td>
                        </tr>
                      )}
                      {history.map((h) => (
                        <tr
                          key={h.id}
                          className="rounded-md bg-slate-900/60 text-slate-100 hover:bg-slate-800/80"
                        >
                          <td className="px-2 py-1">
                            {new Date(h.timestamp).toLocaleTimeString()}
                          </td>
                          <td className="px-2 py-1">
                            <span
                              className={clsx(
                                'inline-flex rounded-sm px-1.5 py-0.5 text-[10px] font-semibold',
                                h.method === 'GET'
                                  ? 'bg-emerald-900/40 text-emerald-300'
                                  : 'bg-sky-900/40 text-sky-300',
                              )}
                            >
                              {h.method}
                            </span>
                          </td>
                          <td className="max-w-[180px] px-2 py-1">
                            <span className="block truncate text-[11px] text-slate-200">
                              {h.path}
                            </span>
                          </td>
                          <td className="px-2 py-1">
                            {h.status ? (
                              <span
                                className={clsx(
                                  'inline-flex rounded-sm px-1.5 py-0.5 text-[10px]',
                                  h.status >= 500
                                    ? 'bg-red-900/40 text-red-300'
                                    : h.status >= 400
                                    ? 'bg-amber-900/40 text-amber-300'
                                    : 'bg-emerald-900/40 text-emerald-300',
                                )}
                              >
                                {h.status}
                              </span>
                            ) : (
                              <span className="text-slate-500">-</span>
                            )}
                          </td>
                          <td className="px-2 py-1">
                            {typeof h.latencyMs === 'number'
                              ? `${h.latencyMs} ms`
                              : '–'}
                          </td>
                          <td className="px-2 py-1 text-slate-400">
                            {h.ip ?? '–'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-[10px] text-slate-500">
                  Logs are retained for 10 days. This view shows the freshest slice so
                  you can quickly confirm your mock behavior.
                </p>
              </div>

              <div className="w-64 shrink-0 rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-200">
                  <Server className="h-4 w-4 text-emerald-400" />
                  Cluster health
                </div>
                {loadingAdmin && (
                  <p className="text-[11px] text-slate-500">Loading admin overview…</p>
                )}
                {adminOverview ? (
                  <div className="space-y-2 text-[11px]">
                    <div className="flex items-center justify-between rounded-md bg-slate-900/70 px-2 py-1.5">
                      <span className="text-slate-400">Users</span>
                      <span className="font-semibold text-slate-100">
                        {adminOverview.users}
                      </span>
                    </div>
                    <div className="flex items-center justify-between rounded-md bg-slate-900/70 px-2 py-1.5">
                      <span className="text-slate-400">Endpoints</span>
                      <span className="font-semibold text-slate-100">
                        {adminOverview.endpoints}
                      </span>
                    </div>
                    <div className="flex items-center justify-between rounded-md bg-slate-900/70 px-2 py-1.5">
                      <span className="text-slate-400">Requests today</span>
                      <span className="font-semibold text-slate-100">
                        {adminOverview.requestsToday}
                      </span>
                    </div>
                    <div className="flex items-center justify-between rounded-md bg-slate-900/70 px-2 py-1.5">
                      <span className="text-slate-400">Error rate</span>
                      <span
                        className={clsx(
                          'font-semibold',
                          adminOverview.errorRateAbove5
                            ? 'text-red-300'
                            : 'text-emerald-300',
                        )}
                      >
                        {adminOverview.errorRate.toFixed(2)}%
                      </span>
                    </div>
                    {adminOverview.errorRateAbove5 && (
                      <p className="mt-1 text-[10px] text-red-300">
                        Error rate is elevated. Check admin issues API for details.
                      </p>
                    )}
                  </div>
                ) : (
                  !loadingAdmin && (
                    <p className="text-[11px] text-slate-500">
                      Admin overview unavailable for this user. That’s expected if your
                      API key is not an admin.
                    </p>
                  )
                )}
              </div>
            </div>
          </section>
        </main>
      </div>
    </>
  );
};

