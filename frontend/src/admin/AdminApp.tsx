/**
 * AdminApp.tsx — MockUrl Admin Dashboard
 *
 * Full monitoring panel: overview stats, users, endpoints, request logs.
 * Click any log row to see full request + response details.
 * Auth: X-Admin-Secret (from .env ADMIN_SECRET).
 */
import axios from 'axios';
import {
    Activity,
    AlertTriangle,
    ArrowLeft,
    ArrowRight,
    Clock,
    Database,
    Globe,
    Layers,
    RefreshCw,
    Search,
    Shield,
    Users,
    X,
    Zap,
} from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000';

// ─── Types ──────────────────────────────────────────────────────────────────
interface Overview {
    endpoints: number;
    users: number;
    requestsToday: number;
    totalRequests: number;
    errorCount: number;
    errorRate: number;
    errorRateAbove5: boolean;
}

interface AdminUser {
    id: string;
    email: string;
    apiKey: string;
    endpointCount: number;
}

interface AdminEndpoint {
    id: string;
    name: string;
    userId: string;
    userEmail: string;
    requestCount: number;
    createdAt: string;
}

interface AdminLog {
    id: string;
    endpointId: string;
    endpointName: string;
    userEmail: string;
    timestamp: string;
    method: string;
    path: string;
    query?: Record<string, unknown> | null;
    headers?: Record<string, string> | null;
    body?: string | null;
    ip?: string | null;
    userAgent?: string | null;
    responseStatus?: number | null;
    responseHeaders?: Record<string, string> | null;
    responseBody?: string | null;
    latencyMs?: number | null;
}

type Tab = 'logs' | 'users' | 'endpoints' | 'errors';

// ─── Helpers ────────────────────────────────────────────────────────────────
function getMethodClass(m: string) {
    const ml = m.toUpperCase();
    if (['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(ml)) return `method-${ml}`;
    return 'method-other';
}

function getStatusClass(s: number | null | undefined) {
    if (!s) return '';
    if (s < 300) return 'status-2xx';
    if (s < 400) return 'status-3xx';
    if (s < 500) return 'status-4xx';
    return 'status-5xx';
}

function fmtTime(iso: string) {
    const d = new Date(iso);
    return d.toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    });
}

function fmtJson(val: unknown): string {
    if (val == null) return '—';
    if (typeof val === 'string') {
        try {
            return JSON.stringify(JSON.parse(val), null, 2);
        } catch {
            return val;
        }
    }
    return JSON.stringify(val, null, 2);
}

// ─── Component ──────────────────────────────────────────────────────────────
export const AdminApp: React.FC = () => {
    // Auth state
    const [adminSecret, setAdminSecret] = useState<string>('');
    const [authenticated, setAuthenticated] = useState(false);
    const [loginInput, setLoginInput] = useState('');
    const [loginError, setLoginError] = useState('');
    const [loginLoading, setLoginLoading] = useState(false);

    // Data state
    const [overview, setOverview] = useState<Overview | null>(null);
    const [users, setUsers] = useState<AdminUser[]>([]);
    const [usersTotal, setUsersTotal] = useState(0);
    const [endpoints, setEndpoints] = useState<AdminEndpoint[]>([]);
    const [endpointsTotal, setEndpointsTotal] = useState(0);
    const [logs, setLogs] = useState<AdminLog[]>([]);
    const [logsTotal, setLogsTotal] = useState(0);
    const [errors, setErrors] = useState<AdminLog[]>([]);
    const [errorsTotal, setErrorsTotal] = useState(0);

    // UI state
    const [tab, setTab] = useState<Tab>('logs');
    const [loading, setLoading] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [selectedLog, setSelectedLog] = useState<AdminLog | null>(null);

    // Pagination
    const [logsPage, setLogsPage] = useState(0);
    const [usersPage, setUsersPage] = useState(0);
    const [endpointsPage, setEndpointsPage] = useState(0);
    const [errorsPage, setErrorsPage] = useState(0);
    const PAGE_SIZE = 50;

    // Filters
    const [searchQuery, setSearchQuery] = useState('');
    const [methodFilter, setMethodFilter] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

    // ─── API helper ───────────────────────────────────────────────────────────
    const api = useCallback(
        (path: string, params?: Record<string, string | number>) =>
            axios.get(`${API_BASE}/api/v1/admin${path}`, {
                headers: { 'X-Admin-Secret': adminSecret },
                params,
            }),
        [adminSecret],
    );

    // ─── Auth ─────────────────────────────────────────────────────────────────
    const tryLogin = useCallback(
        async (secret: string) => {
            try {
                const resp = await axios.get(`${API_BASE}/api/v1/admin/overview`, {
                    headers: { 'X-Admin-Secret': secret },
                });
                if (resp.data.success) {
                    setAdminSecret(secret);
                    setAuthenticated(true);
                    setOverview(resp.data.overview);
                    return true;
                }
            } catch {
                // login failed
            }
            return false;
        },
        [],
    );

    async function handleLogin(e: React.FormEvent) {
        e.preventDefault();
        if (!loginInput.trim()) return;
        setLoginLoading(true);
        setLoginError('');
        const ok = await tryLogin(loginInput.trim());
        if (!ok) setLoginError('Invalid admin secret');
        setLoginLoading(false);
    }

    function handleLogout() {
        setAdminSecret('');
        setAuthenticated(false);
        setOverview(null);
    }

    // ─── Data loading ─────────────────────────────────────────────────────────
    const loadOverview = useCallback(async () => {
        try {
            const resp = await api('/overview');
            setOverview(resp.data.overview);
        } catch { /* */ }
    }, [api]);

    const loadUsers = useCallback(async (page = 0) => {
        try {
            const resp = await api('/users', { limit: PAGE_SIZE, offset: page * PAGE_SIZE });
            setUsers(resp.data.users);
            setUsersTotal(resp.data.total);
        } catch { /* */ }
    }, [api]);

    const loadEndpoints = useCallback(async (page = 0) => {
        try {
            const resp = await api('/endpoints', { limit: PAGE_SIZE, offset: page * PAGE_SIZE });
            setEndpoints(resp.data.endpoints);
            setEndpointsTotal(resp.data.total);
        } catch { /* */ }
    }, [api]);

    const loadLogs = useCallback(async (page = 0, search = '', method = '', status = '') => {
        try {
            const params: Record<string, string | number> = { limit: PAGE_SIZE, offset: page * PAGE_SIZE };
            if (search) params.search = search;
            if (method) params.method = method;
            if (status) params.status = status;
            const resp = await api('/logs', params);
            setLogs(resp.data.logs);
            setLogsTotal(resp.data.total);
        } catch { /* */ }
    }, [api]);

    const loadErrors = useCallback(async (page = 0) => {
        try {
            const resp = await api('/errors', { limit: PAGE_SIZE, offset: page * PAGE_SIZE });
            setErrors(resp.data.errors);
            setErrorsTotal(resp.data.total);
        } catch { /* */ }
    }, [api]);

    // Initial data load
    useEffect(() => {
        if (!authenticated) return;
        setLoading(true);
        Promise.all([loadOverview(), loadLogs(0), loadUsers(0), loadEndpoints(0), loadErrors(0)])
            .finally(() => setLoading(false));
    }, [authenticated, loadOverview, loadLogs, loadUsers, loadEndpoints, loadErrors]);

    // Auto-refresh every 10s
    useEffect(() => {
        if (!authenticated) return;
        const interval = setInterval(() => {
            void loadOverview();
            if (tab === 'logs') void loadLogs(logsPage, searchQuery, methodFilter, statusFilter);
            else if (tab === 'errors') void loadErrors(errorsPage);
        }, 10_000);
        return () => clearInterval(interval);
    }, [authenticated, tab, logsPage, errorsPage, searchQuery, methodFilter, statusFilter, loadOverview, loadLogs, loadErrors]);

    // Refresh button
    async function handleRefresh() {
        setRefreshing(true);
        await Promise.all([loadOverview(), loadLogs(logsPage, searchQuery, methodFilter, statusFilter), loadUsers(usersPage), loadEndpoints(endpointsPage), loadErrors(errorsPage)]);
        setRefreshing(false);
    }

    // Search debounce
    function handleSearchChange(val: string) {
        setSearchQuery(val);
        if (searchTimeout.current) clearTimeout(searchTimeout.current);
        searchTimeout.current = setTimeout(() => {
            setLogsPage(0);
            void loadLogs(0, val, methodFilter, statusFilter);
        }, 400);
    }

    function handleMethodChange(val: string) {
        setMethodFilter(val);
        setLogsPage(0);
        void loadLogs(0, searchQuery, val, statusFilter);
    }

    function handleStatusChange(val: string) {
        setStatusFilter(val);
        setLogsPage(0);
        void loadLogs(0, searchQuery, methodFilter, val);
    }

    // ─── Render: Login ────────────────────────────────────────────────────────
    if (!authenticated) {
        return (
            <div className="admin-layout">
                <div className="login-card">
                    <Shield size={32} style={{ color: 'var(--accent)', marginBottom: 12 }} />
                    <h2>Admin Dashboard</h2>
                    <p>Enter your admin secret to access the monitoring panel</p>
                    <form onSubmit={handleLogin}>
                        <input
                            className="login-input"
                            type="password"
                            placeholder="Admin Secret…"
                            value={loginInput}
                            onChange={(e) => setLoginInput(e.target.value)}
                            autoFocus
                        />
                        {loginError && <div className="login-error">{loginError}</div>}
                        <button type="submit" className="btn btn-primary" disabled={loginLoading}>
                            {loginLoading ? <RefreshCw size={14} className="btn-spinning" /> : <Shield size={14} />}
                            {loginLoading ? 'Verifying…' : 'Access Dashboard'}
                        </button>
                    </form>
                </div>
            </div>
        );
    }

    // ─── Render: Dashboard ────────────────────────────────────────────────────
    const totalPages = (total: number) => Math.max(1, Math.ceil(total / PAGE_SIZE));

    return (
        <div className="admin-layout">
            {/* Header */}
            <header className="admin-header">
                <div className="admin-brand">
                    <div className="admin-logo">
                        <Shield size={20} />
                    </div>
                    <div>
                        <h1>MockUrl Admin</h1>
                        <p>System monitoring &amp; request inspection</p>
                    </div>
                </div>
                <div className="admin-actions">
                    <button className="btn btn-ghost" onClick={handleRefresh}>
                        <RefreshCw size={13} className={refreshing ? 'btn-spinning' : ''} />
                        Refresh
                    </button>
                    <button className="btn btn-danger" onClick={handleLogout}>
                        Logout
                    </button>
                </div>
            </header>

            {/* Stats */}
            {overview && (
                <div className="stats-grid">
                    <div className="stat-card">
                        <div className="stat-card-label"><Users size={13} /> Total Users</div>
                        <div className="stat-card-value">{overview.users}</div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-card-label"><Layers size={13} /> Endpoints</div>
                        <div className="stat-card-value">{overview.endpoints}</div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-card-label"><Zap size={13} /> Requests Today</div>
                        <div className="stat-card-value">{overview.requestsToday}</div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-card-label"><Database size={13} /> Total Requests</div>
                        <div className="stat-card-value">{overview.totalRequests}</div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-card-label"><AlertTriangle size={13} /> Errors</div>
                        <div className={`stat-card-value ${overview.errorCount > 0 ? 'red' : 'green'}`}>{overview.errorCount}</div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-card-label"><Activity size={13} /> Error Rate</div>
                        <div className={`stat-card-value ${overview.errorRateAbove5 ? 'red' : overview.errorRate > 0 ? 'amber' : 'green'}`}>
                            {overview.errorRate}%
                        </div>
                    </div>
                </div>
            )}

            {/* Tabs */}
            <div className="tabs">
                <button className={`tab ${tab === 'logs' ? 'active' : ''}`} onClick={() => setTab('logs')}>
                    <Globe size={13} /> Request Logs <span className="tab-badge">{logsTotal}</span>
                </button>
                <button className={`tab ${tab === 'errors' ? 'active' : ''}`} onClick={() => setTab('errors')}>
                    <AlertTriangle size={13} /> Errors <span className="tab-badge">{errorsTotal}</span>
                </button>
                <button className={`tab ${tab === 'users' ? 'active' : ''}`} onClick={() => setTab('users')}>
                    <Users size={13} /> Users <span className="tab-badge">{usersTotal}</span>
                </button>
                <button className={`tab ${tab === 'endpoints' ? 'active' : ''}`} onClick={() => setTab('endpoints')}>
                    <Layers size={13} /> Endpoints <span className="tab-badge">{endpointsTotal}</span>
                </button>
            </div>

            {/* Loading spinner */}
            {loading && (
                <div className="loading-spinner">
                    <RefreshCw size={16} className="btn-spinning" /> Loading data…
                </div>
            )}

            {/* ─── Logs Tab ──────────────────────────────────────────────────────── */}
            {!loading && tab === 'logs' && (
                <div className="table-card">
                    <div className="table-toolbar">
                        <div className="table-toolbar-left">
                            <input
                                className="filter-input"
                                placeholder="Search by path…"
                                value={searchQuery}
                                onChange={(e) => handleSearchChange(e.target.value)}
                            />
                            <select className="filter-select" value={methodFilter} onChange={(e) => handleMethodChange(e.target.value)}>
                                <option value="">All Methods</option>
                                <option value="GET">GET</option>
                                <option value="POST">POST</option>
                                <option value="PUT">PUT</option>
                                <option value="PATCH">PATCH</option>
                                <option value="DELETE">DELETE</option>
                            </select>
                            <select className="filter-select" value={statusFilter} onChange={(e) => handleStatusChange(e.target.value)}>
                                <option value="">All Status</option>
                                <option value="200">2xx</option>
                                <option value="300">3xx</option>
                                <option value="400">4xx</option>
                                <option value="500">5xx</option>
                            </select>
                        </div>
                    </div>
                    <div className="table-scroll">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Time</th>
                                    <th>Method</th>
                                    <th>Path</th>
                                    <th>Status</th>
                                    <th>Endpoint</th>
                                    <th>User</th>
                                    <th>IP</th>
                                    <th>Latency</th>
                                </tr>
                            </thead>
                            <tbody>
                                {logs.length === 0 ? (
                                    <tr><td colSpan={8}><div className="empty-state"><Search size={24} /><p>No logs found</p></div></td></tr>
                                ) : logs.map((log) => (
                                    <tr key={log.id} onClick={() => setSelectedLog(log)}>
                                        <td className="dim mono">{fmtTime(log.timestamp)}</td>
                                        <td><span className={`method-pill ${getMethodClass(log.method)}`}>{log.method}</span></td>
                                        <td className="mono ellipsis" title={log.path}>{log.path}</td>
                                        <td><span className={`status-pill ${getStatusClass(log.responseStatus)}`}>{log.responseStatus ?? '—'}</span></td>
                                        <td className="ellipsis">{log.endpointName}</td>
                                        <td className="dim ellipsis">{log.userEmail}</td>
                                        <td className="mono dim">{log.ip ?? '—'}</td>
                                        <td className="mono dim">{log.latencyMs != null ? `${log.latencyMs}ms` : '—'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <div className="table-footer">
                        <span>Showing {logs.length} of {logsTotal} logs</span>
                        <div className="pagination">
                            <button className="btn btn-ghost" disabled={logsPage === 0} onClick={() => { setLogsPage(logsPage - 1); void loadLogs(logsPage - 1, searchQuery, methodFilter, statusFilter); }}>
                                <ArrowLeft size={12} /> Prev
                            </button>
                            <span style={{ padding: '6px 10px', fontSize: 12, color: 'var(--text-muted)' }}>
                                Page {logsPage + 1} / {totalPages(logsTotal)}
                            </span>
                            <button className="btn btn-ghost" disabled={logsPage >= totalPages(logsTotal) - 1} onClick={() => { setLogsPage(logsPage + 1); void loadLogs(logsPage + 1, searchQuery, methodFilter, statusFilter); }}>
                                Next <ArrowRight size={12} />
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ─── Errors Tab ────────────────────────────────────────────────────── */}
            {!loading && tab === 'errors' && (
                <div className="table-card">
                    <div className="table-scroll">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Time</th>
                                    <th>Method</th>
                                    <th>Path</th>
                                    <th>Status</th>
                                    <th>Endpoint</th>
                                    <th>User</th>
                                    <th>Response Body</th>
                                </tr>
                            </thead>
                            <tbody>
                                {errors.length === 0 ? (
                                    <tr><td colSpan={7}><div className="empty-state"><AlertTriangle size={24} /><p>No errors — everything looks good!</p></div></td></tr>
                                ) : errors.map((log) => (
                                    <tr key={log.id} onClick={() => setSelectedLog(log)}>
                                        <td className="dim mono">{fmtTime(log.timestamp)}</td>
                                        <td><span className={`method-pill ${getMethodClass(log.method)}`}>{log.method}</span></td>
                                        <td className="mono ellipsis" title={log.path}>{log.path}</td>
                                        <td><span className={`status-pill ${getStatusClass(log.responseStatus)}`}>{log.responseStatus ?? '—'}</span></td>
                                        <td className="ellipsis">{log.endpointName}</td>
                                        <td className="dim ellipsis">{log.userEmail}</td>
                                        <td className="mono ellipsis dim" title={log.responseBody ?? ''}>{log.responseBody?.slice(0, 60) ?? '—'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <div className="table-footer">
                        <span>{errorsTotal} error{errorsTotal !== 1 ? 's' : ''} total</span>
                        <div className="pagination">
                            <button className="btn btn-ghost" disabled={errorsPage === 0} onClick={() => { setErrorsPage(errorsPage - 1); void loadErrors(errorsPage - 1); }}>
                                <ArrowLeft size={12} /> Prev
                            </button>
                            <span style={{ padding: '6px 10px', fontSize: 12, color: 'var(--text-muted)' }}>
                                Page {errorsPage + 1} / {totalPages(errorsTotal)}
                            </span>
                            <button className="btn btn-ghost" disabled={errorsPage >= totalPages(errorsTotal) - 1} onClick={() => { setErrorsPage(errorsPage + 1); void loadErrors(errorsPage + 1); }}>
                                Next <ArrowRight size={12} />
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ─── Users Tab ─────────────────────────────────────────────────────── */}
            {!loading && tab === 'users' && (
                <div className="table-card">
                    <div className="table-scroll">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Email / Session</th>
                                    <th>API Key (masked)</th>
                                    <th>Endpoints</th>
                                    <th>User ID</th>
                                </tr>
                            </thead>
                            <tbody>
                                {users.length === 0 ? (
                                    <tr><td colSpan={4}><div className="empty-state"><Users size={24} /><p>No users yet</p></div></td></tr>
                                ) : users.map((u) => (
                                    <tr key={u.id}>
                                        <td>{u.email}</td>
                                        <td className="mono dim">{u.apiKey}</td>
                                        <td className="mono">{u.endpointCount}</td>
                                        <td className="mono dim ellipsis" title={u.id}>{u.id}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <div className="table-footer">
                        <span>{usersTotal} user{usersTotal !== 1 ? 's' : ''} total</span>
                        <div className="pagination">
                            <button className="btn btn-ghost" disabled={usersPage === 0} onClick={() => { setUsersPage(usersPage - 1); void loadUsers(usersPage - 1); }}>
                                <ArrowLeft size={12} /> Prev
                            </button>
                            <span style={{ padding: '6px 10px', fontSize: 12, color: 'var(--text-muted)' }}>
                                Page {usersPage + 1} / {totalPages(usersTotal)}
                            </span>
                            <button className="btn btn-ghost" disabled={usersPage >= totalPages(usersTotal) - 1} onClick={() => { setUsersPage(usersPage + 1); void loadUsers(usersPage + 1); }}>
                                Next <ArrowRight size={12} />
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ─── Endpoints Tab ─────────────────────────────────────────────────── */}
            {!loading && tab === 'endpoints' && (
                <div className="table-card">
                    <div className="table-scroll">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Name</th>
                                    <th>Owner</th>
                                    <th>Requests</th>
                                    <th>Created</th>
                                    <th>ID</th>
                                </tr>
                            </thead>
                            <tbody>
                                {endpoints.length === 0 ? (
                                    <tr><td colSpan={5}><div className="empty-state"><Layers size={24} /><p>No endpoints created yet</p></div></td></tr>
                                ) : endpoints.map((ep) => (
                                    <tr key={ep.id}>
                                        <td style={{ fontWeight: 600, color: 'var(--accent)' }}>{ep.name}</td>
                                        <td className="dim">{ep.userEmail}</td>
                                        <td className="mono">{ep.requestCount}</td>
                                        <td className="dim mono">{fmtTime(ep.createdAt)}</td>
                                        <td className="mono dim ellipsis" title={ep.id}>{ep.id}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <div className="table-footer">
                        <span>{endpointsTotal} endpoint{endpointsTotal !== 1 ? 's' : ''} total</span>
                        <div className="pagination">
                            <button className="btn btn-ghost" disabled={endpointsPage === 0} onClick={() => { setEndpointsPage(endpointsPage - 1); void loadEndpoints(endpointsPage - 1); }}>
                                <ArrowLeft size={12} /> Prev
                            </button>
                            <span style={{ padding: '6px 10px', fontSize: 12, color: 'var(--text-muted)' }}>
                                Page {endpointsPage + 1} / {totalPages(endpointsTotal)}
                            </span>
                            <button className="btn btn-ghost" disabled={endpointsPage >= totalPages(endpointsTotal) - 1} onClick={() => { setEndpointsPage(endpointsPage + 1); void loadEndpoints(endpointsPage + 1); }}>
                                Next <ArrowRight size={12} />
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ─── Log Detail Modal ──────────────────────────────────────────────── */}
            {selectedLog && (
                <div className="modal-overlay" onClick={() => setSelectedLog(null)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>
                                <span className={`method-pill ${getMethodClass(selectedLog.method)}`}>{selectedLog.method}</span>
                                {' '}{selectedLog.path}
                            </h3>
                            <button className="modal-close" onClick={() => setSelectedLog(null)}>
                                <X size={16} />
                            </button>
                        </div>
                        <div className="modal-body">
                            {/* Meta */}
                            <div className="detail-section">
                                <div className="detail-section-title"><Clock size={12} /> Request Info</div>
                                <div className="detail-row"><span className="detail-label">Timestamp</span><span className="detail-value">{new Date(selectedLog.timestamp).toLocaleString()}</span></div>
                                <div className="detail-row"><span className="detail-label">Endpoint</span><span className="detail-value">{selectedLog.endpointName}</span></div>
                                <div className="detail-row"><span className="detail-label">User</span><span className="detail-value">{selectedLog.userEmail}</span></div>
                                <div className="detail-row"><span className="detail-label">IP</span><span className="detail-value mono">{selectedLog.ip ?? '—'}</span></div>
                                <div className="detail-row"><span className="detail-label">User Agent</span><span className="detail-value dim" style={{ fontSize: 11 }}>{selectedLog.userAgent ?? '—'}</span></div>
                                <div className="detail-row"><span className="detail-label">Latency</span><span className="detail-value mono">{selectedLog.latencyMs != null ? `${selectedLog.latencyMs}ms` : '—'}</span></div>
                            </div>

                            {/* Request Headers */}
                            {selectedLog.headers && (
                                <div className="detail-section">
                                    <div className="detail-section-title"><Globe size={12} /> Request Headers</div>
                                    <pre className="code-block request">{fmtJson(selectedLog.headers)}</pre>
                                </div>
                            )}

                            {/* Query Params */}
                            {selectedLog.query && Object.keys(selectedLog.query).length > 0 && (
                                <div className="detail-section">
                                    <div className="detail-section-title"><Search size={12} /> Query Params</div>
                                    <pre className="code-block request">{fmtJson(selectedLog.query)}</pre>
                                </div>
                            )}

                            {/* Request Body */}
                            {selectedLog.body && (
                                <div className="detail-section">
                                    <div className="detail-section-title"><Zap size={12} /> Request Body (Input)</div>
                                    <pre className="code-block request">{fmtJson(selectedLog.body)}</pre>
                                </div>
                            )}

                            {/* Response */}
                            <div className="detail-section">
                                <div className="detail-section-title"><Activity size={12} /> Response</div>
                                <div className="detail-row">
                                    <span className="detail-label">Status</span>
                                    <span className="detail-value">
                                        <span className={`status-pill ${getStatusClass(selectedLog.responseStatus)}`}>
                                            {selectedLog.responseStatus ?? '—'}
                                        </span>
                                    </span>
                                </div>
                            </div>

                            {/* Response Headers */}
                            {selectedLog.responseHeaders && (
                                <div className="detail-section">
                                    <div className="detail-section-title"><Globe size={12} /> Response Headers</div>
                                    <pre className="code-block">{fmtJson(selectedLog.responseHeaders)}</pre>
                                </div>
                            )}

                            {/* Response Body */}
                            {selectedLog.responseBody && (
                                <div className="detail-section">
                                    <div className="detail-section-title"><Database size={12} /> Response Body (Output)</div>
                                    <pre className={`code-block ${(selectedLog.responseStatus ?? 0) >= 400 ? 'error' : ''}`}>
                                        {fmtJson(selectedLog.responseBody)}
                                    </pre>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
