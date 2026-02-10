# MockUrl Frontend - Production Prompt

Build a production-grade React frontend (Vite + TypeScript + Tailwind/shadcn-ui) for MockUrl's FIRST TWO features: (1) Create/Manage Endpoints dashboard, (2) Inspect HTTP Requests history viewer. BEST-IN-CLASS quality – polished like MockUrl/Postman, NOT basic (smooth animations, responsive, accessible). Scalable for future rules/stateful/tunnel/team features.

**Context**: SaaS mock API dashboard at app.mockurl.com/console. Backend APIs ready (`/api/v1/endpoints`, `/api/v1/history`, `/api/v1/state`, `/api/v1/admin`). Users login → manage their endpoints → deep-dive request logs. Admin panel for monitoring ALL users (errors, silent fails).

**Tech Stack (fixed)**:
- **Vite** + **React 18** + **TypeScript** (strict mode)
- **shadcn/ui** + **Tailwind CSS** (dark mode by default, light mode toggle)
- **TanStack Query v5** (data fetching/caching/mutations with optimistic updates)
- **TanStack Table v8** (history table with virtualization)
- **Lucide React** (icons), **Framer Motion** (animations), **Zod** (validation)
- **React Hook Form** (form handling with Zod resolver)
- **Zustand** (global state: user, theme, preferences)
- **React Router v6** (routing with protected routes)
- **Axios** (HTTP client with interceptors for auth)
- **date-fns** (date formatting)
- **react-json-view** or **react-syntax-highlighter** (JSON viewer)
- **Recharts** (charts: status pie, req/sec line)
- **qrcode.react** (QR code generation)
- **react-hot-toast** (notifications)
- Auth: **JWT localStorage** + protected routes
- Real-time: **Polling** (5s interval) - WebSocket ready for future

**UI/UX Exact Match to MockUrl**:
- **Landing**: "Create Mock Endpoint" → form (name input with validation, create btn with loading state)
- **Dashboard**: Sidebar (Endpoints list, History, Settings, future Rules/Tunnel/State). Main: Endpoint cards grid (name, URL copy btn, req count badge, last seen, delete with confirm). Empty state illustration.
- **History Page** (per endpoint): Hero header (endpoint URL QR/copy/share buttons, curl example, Postman import link). TanStack table (columns: timestamp/method/path/status/latency/ip/body preview). Filters (search bar full-text, dropdowns method/status, date range picker). Facets sidebar (top paths/methods/status pie charts via Recharts). Row expand → full JSON req/res headers/body (syntax highlight). Export CSV/JSON. Retention warning (10 days).
- **State Page**: Key-value editor, get/set/delete state, use in templates
- **Admin Panel**: Overview dashboard (fleet stats, error rate, charts), Issues table (5xx/timeout detection), User management
- Responsive mobile-first; loading skeletons; empty states with illustrations; error boundaries

**Feature 1: Endpoints Dashboard** (`/console`):
- List user's endpoints (TanStack Query infinite scroll)
- Create modal: Validate name (5-40 chars, lowercase alphanumeric + hyphens) → POST `/api/v1/endpoints/create` → toast success + redirect to `/console/:endpointId/history`
- Card actions: Copy URL (`https://{name}.mockurl.com`), Open History, Delete (confirm dialog)
- URL preview with playground curl/Postman links
- Export/Import buttons (download/upload JSON config)
- DO: TanStack Query only (no local state), optimistic updates, error handling
- DON'T: Local state for lists, manual cache management

**Feature 2: Request History Viewer** (`/console/:endpointId/history`):
- Per-endpoint page: Real-time table (poll `/api/v1/history/:endpointId` every 5s)
- Advanced filters: Debounced search (path/body), multi-select method/status, date range
- Facets sidebar: Top paths (bar chart), top methods (pie), status counts (pie) from API response
- Expandable rows: Syntax-highlighted JSON (request headers/body, response headers/body), replay curl button
- Charts: Request/sec line chart (grouped by hour), status distribution pie
- Export: CSV/JSON download
- Retention warning: "Logs older than 10 days are automatically deleted"
- DO: Virtual scrolling (TanStack Table), infinite scroll, optimistic updates, error boundaries
- DON'T: Render >100 rows at once, block UI on load

**Feature 3: State Management** (`/console/:endpointId/state`):
- Key-value editor: List all keys, get/set/delete state
- Template preview: Show how `{{state.key}}` works
- State from requests: Show `_setState` usage example
- DO: Real-time updates, validation

**Admin Panel** (`/admin` – protected by `role==='admin'`):
- Global overview: All endpoints/users table (filter by user/email/error rate)
- Issue detection: Red flags for "correct req → server fail" (status 5xx/timeout), uptime alerts
- Logs viewer: Cross-user search, error forensics (diff expected vs actual response)
- DO: Role guard (check localStorage `role` or API `/api/v1/user/me`), charts for fleet health, pagination
- DON'T: Leak data, render all at once

**Scalability/Extensibility**:
- Component library: Reusable `EndpointCard`, `HistoryTable`, `RuleEditor` stub (empty for now), `StateEditor`
- Future hooks: `<RuleBuilder />` slot, state store viewer, tunnel toggle, webhook config
- Global state: Zustand store (user, endpoints cache, theme, preferences) with persistence
- PWA-ready: Service worker stub, offline history cache (IndexedDB)
- Error boundaries: Catch and display errors gracefully

**Backend API Integration**:
- Base URL: `VITE_API_URL` env var (default: `http://localhost:3000`)
- Auth: `X-API-Key` header (from localStorage after login)
- Endpoints:
  - `GET /api/v1/endpoints` - List (cursor pagination)
  - `POST /api/v1/endpoints/create` - Create
  - `GET /api/v1/endpoints/:id` - Get details + stats
  - `DELETE /api/v1/endpoints/:id` - Delete
  - `POST /api/v1/endpoints/:id/export` - Export config
  - `POST /api/v1/endpoints/:id/import` - Import config
  - `GET /api/v1/history/:endpointId` - History with facets
  - `GET /api/v1/history/export/:endpointId` - Export logs
  - `GET /api/v1/state/:endpointId` - List state keys
  - `GET /api/v1/state/:endpointId/:key` - Get state
  - `POST /api/v1/state/:endpointId/:key` - Set state
  - `DELETE /api/v1/state/:endpointId/:key` - Delete state
  - `GET /api/v1/user/me` - Current user
  - `GET /api/v1/admin/overview` - Admin stats
  - `GET /api/v1/admin/issues` - Admin issues

**Deliverables**:
- Full Vite app structure (`src/components`, `src/pages`, `src/hooks`, `src/lib`, `src/stores`)
- Backend API integration (Axios client with interceptors)
- shadcn setup + custom theme (MockUrl blue/green palette)
- Vitest + React Testing Library tests (unit: components, integration: API hooks)
- E2E tests: Cypress/Playwright (create endpoint → log request → view history)
- Deploy: Vercel/Netlify config (`vercel.json` or `netlify.toml`)
- README: `npm run dev` + screenshots matching MockUrl
- `.env.example`: `VITE_API_URL=http://localhost:3000`

**Polish Requirements**:
- Keyboard navigation (Tab, Enter, Escape)
- ARIA labels for screen readers
- 60fps animations (Framer Motion with `will-change`)
- Loading states (skeletons, spinners)
- Error states (retry buttons, error messages)
- Empty states (illustrations, helpful messages)
- Dark mode (default) with light mode toggle
- Mobile responsive (breakpoints: sm, md, lg, xl)
- Accessible colors (WCAG AA contrast)

**NO backend code** - Frontend-only. Backend-first data flow (assume backend APIs exist and work).
