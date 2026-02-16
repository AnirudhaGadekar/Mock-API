# Comprehensive Performance Optimization Audit for API Mocking Platform

## Context
You are auditing a production-grade API mocking platform similar to Beeceptor with the following core features:

### Core Features:
1. **Mock HTTP Endpoints** - Dynamic endpoint creation with custom rules
2. **Request History & Logging** - Real-time capture of all incoming requests
3. **WebSocket Tunnel Proxy** - Local-to-public HTTPS tunneling via WebSocket
4. **Custom Domain Support** - SSL provisioning and DNS verification
5. **AI-Powered Rule Generation** - Claude API integration for natural language mock creation
6. **WebSocket/SSE Mocking** - Real-time protocol simulation
7. **GraphQL/gRPC Support** - Advanced protocol mocking
8. **Request Transformation** - Conditional request/response modification
9. **OpenAPI Integration** - Schema import and data generation
10. **Advanced Search & Filtering** - Request history with complex queries

### Technology Stack:
- **Backend**: Fastify (Node.js), TypeScript
- **Database**: PostgreSQL with Prisma ORM
- **Cache**: Redis (ioredis)
- **Real-time**: WebSocket (ws package)
- **Frontend**: React, TanStack Query (React Query)

---

## Performance Audit Instructions

Analyze the **entire codebase** systematically and identify:

### 1. DATABASE & QUERY OPTIMIZATION

#### Check for:
- **Missing Indexes**: Any foreign keys, frequently queried fields, or composite indexes missing?
  - Check `schema.prisma` for:
    - `userId` fields (user ownership queries)
    - `endpointId` fields (endpoint relationships)
    - `createdAt` fields (time-based queries)
    - Composite indexes for common query patterns (e.g., `userId + endpointId`)
  - Are there any queries that filter by multiple fields without a composite index?

- **N+1 Query Problems**:
  - Are we fetching related data in loops instead of using `include` or `select`?
  - Example: Loading endpoint → then loading rules → then loading requests in separate queries
  - Should use Prisma's `include` for eager loading

- **Full Table Scans**:
  - Are there queries without WHERE clauses on large tables?
  - Request history table could grow to millions - is pagination enforced?
  - Are we doing `findMany()` without limits on potentially large datasets?

- **Query Optimization**:
  - Are we selecting only needed fields with `select: { id: true, name: true }` or fetching entire objects?
  - Can expensive aggregations be cached?
  - Are we using `count()` on large tables without indexes?

#### Specific Areas to Check:
```typescript
// Example patterns to find and optimize:

// ❌ BAD: N+1 problem
const endpoints = await prisma.endpoint.findMany({ where: { userId } });
for (const endpoint of endpoints) {
  const rules = await prisma.rule.findMany({ where: { endpointId: endpoint.id } }); // N+1!
}

// ✅ GOOD: Single query with include
const endpoints = await prisma.endpoint.findMany({
  where: { userId },
  include: { rules: true }
});

// ❌ BAD: No pagination on large table
const allRequests = await prisma.request.findMany({ where: { endpointId } }); // Could be millions!

// ✅ GOOD: Paginated with limit
const requests = await prisma.request.findMany({
  where: { endpointId },
  take: 50,
  skip: page * 50,
  orderBy: { createdAt: 'desc' }
});
```

### 2. CACHING STRATEGY

#### Evaluate:
- **Redis Caching**:
  - Are frequently accessed but rarely changed data cached? (e.g., endpoint configurations, mock rules)
  - Cache TTL appropriate for data volatility?
  - Are we using Redis for:
    - ✅ Active tunnel sessions (good - in-memory Map currently used, could use Redis for multi-server)
    - ✅ Rate limiting counters
    - ⚠️ Mock rule lookups (should be cached)
    - ⚠️ User authentication sessions
    - ⚠️ Endpoint configurations

- **Cache Invalidation**:
  - Do we invalidate cache when data changes?
  - Pattern: When rule is updated → invalidate endpoint rules cache
  - Using cache tags/keys properly?

#### Recommended Caching:
```typescript
// Cache pattern for mock rules
async function getEndpointRules(endpointId: string) {
  const cacheKey = `endpoint:${endpointId}:rules`;
  
  // Try cache first
  const cached = await redis.get(cacheKey);
  if (cached) return JSON.parse(cached);
  
  // Fetch from DB
  const rules = await prisma.rule.findMany({ where: { endpointId } });
  
  // Cache for 5 minutes
  await redis.setex(cacheKey, 300, JSON.stringify(rules));
  return rules;
}
```

### 3. IN-MEMORY DATA STRUCTURES & ALGORITHMS

#### WebSocket Tunnel Management:
- **Current**: Using `Map<string, TunnelSession>` with `pendingRequests: Map<string, callback>`
- **Bottlenecks to Check**:
  - ⚠️ Linear search through `activeTunnels` to find socketId: `for (const [id, session] of activeTunnels.entries())`
  - ✅ Direct Map lookup by tunnelId is O(1) - good!
  - ⚠️ Should we use a **reverse index** `Map<socketId, tunnelId>` to avoid iteration?

```typescript
// ❌ CURRENT: O(n) search
for (const [id, session] of activeTunnels.entries()) {
  if (session.socketId === socketId) {
    activeTunnels.delete(id);
  }
}

// ✅ OPTIMIZED: O(1) lookup
const socketToTunnel = new Map<string, string>(); // reverse index
const tunnelId = socketToTunnel.get(socketId);
if (tunnelId) activeTunnels.delete(tunnelId);
```

#### Request History Storage:
- Are we storing ALL requests in PostgreSQL?
- For high-traffic endpoints, this could be millions of rows
- Consider:
  - **Time-based partitioning** (PostgreSQL table partitioning by month/week)
  - **Automatic cleanup** of old requests (older than 30 days)
  - **Sampling** for extremely high-traffic endpoints

### 4. ALGORITHM OPTIMIZATION

#### Template Rendering (Handlebars):
- Are we recompiling templates on every request?
- **Should cache compiled templates**:
  ```typescript
  const templateCache = new Map<string, HandlebarsTemplateDelegate>();
  
  function getCompiledTemplate(template: string) {
    if (!templateCache.has(template)) {
      templateCache.set(template, Handlebars.compile(template));
    }
    return templateCache.get(template)!;
  }
  ```

#### Rule Matching:
- **Current approach**: Likely iterating through all rules to find matches
- **Optimization**: Use a **Trie or radix tree** for path matching instead of regex on every request
  - For path patterns like `/api/users/:id`, `/api/products/:id`
  - Can match in O(path length) instead of O(number of rules)
  
```typescript
// ❌ Slow: Check every rule with regex
for (const rule of rules) {
  if (new RegExp(rule.path).test(requestPath)) {
    return rule;
  }
}

// ✅ Fast: Trie-based routing
const router = new PathRouter();
router.add('/api/users/:id', userRule);
router.add('/api/products/:id', productRule);
const matched = router.match('/api/users/123'); // O(path length)
```

#### Search & Filtering:
- **Advanced search on request history**: Are we using PostgreSQL full-text search or basic LIKE queries?
- Recommendations:
  - Use **GIN indexes** for JSONB columns (headers, body)
  - Use **tsvector** for full-text search on request URLs/bodies
  - Consider **Elasticsearch** for complex search if request volume is very high

```sql
-- Add full-text search index
CREATE INDEX idx_requests_search ON requests USING gin(to_tsvector('english', url || ' ' || body));

-- Add GIN index for JSONB headers
CREATE INDEX idx_requests_headers ON requests USING gin(headers);
```

### 5. API RESPONSE TIMES

#### AI Rule Generation:
- **Current**: Claude API calls (can be slow - 2-5 seconds)
- **Acceptable slowness**: This is AI generation, users expect delay
- ✅ This can remain slow - it's functional requirement
- Recommendation: Show loading states, progress indicators

#### OpenAPI Schema Parsing:
- Parsing large OpenAPI specs could be slow
- Cache parsed schemas in Redis
- Consider background processing for very large schemas (>1MB)

#### Tunnel Proxy Request Flow:
- **Critical path**: HTTP request → WebSocket → Local server → WebSocket → Response
- **Current timeout**: 30 seconds (good)
- Check for:
  - Base64 encoding/decoding overhead (necessary but could use streaming)
  - Are we awaiting responses sequentially or can batch?

### 6. FRONTEND PERFORMANCE

#### React Query Optimization:
- **Check for**:
  - Over-fetching: Are we refetching data too often?
  - Missing `staleTime` configuration (causes unnecessary refetches)
  - Large payload rendering (request history with huge bodies)
  
```typescript
// ✅ Set appropriate cache times
useQuery(['endpoints'], fetchEndpoints, {
  staleTime: 5 * 60 * 1000, // 5 minutes
  cacheTime: 10 * 60 * 1000, // 10 minutes
});
```

#### Request History List:
- Rendering thousands of request rows?
- **Use virtualization**: `react-window` or `@tanstack/react-virtual`
- Only render visible rows (50-100) instead of all

#### WebSocket Updates:
- Are we re-rendering entire component tree on every new request?
- Use React.memo() and proper state structure
- Batch updates with `useTransition` or debouncing

### 7. WEBSOCKET PERFORMANCE

#### Connection Management:
- Are we cleaning up closed connections properly?
- Memory leaks from event listeners?
- Ping/pong heartbeat to detect stale connections?

```typescript
// Add heartbeat
const interval = setInterval(() => {
  for (const [id, session] of activeTunnels.entries()) {
    if (session.ws.readyState !== WebSocket.OPEN) {
      activeTunnels.delete(id);
    } else {
      session.ws.ping();
    }
  }
}, 30000);
```

#### Message Size:
- Are we sending large request/response bodies over WebSocket?
- Consider compression for bodies >10KB

### 8. RATE LIMITING & RESOURCE MANAGEMENT

#### Check:
- Rate limiting per user/endpoint to prevent abuse
- Connection limits per user (max tunnels)
- Request history size limits (auto-cleanup old requests)
- WebSocket connection limits

### 9. SPECIFIC FEATURE AUDITS

#### Custom Domain SSL Provisioning:
- **Let's Encrypt rate limits**: Caching certificates properly?
- Certificate renewal: Using background jobs (not blocking requests)?
- ✅ This process can be slow (DNS propagation, SSL issuance) - it's expected

#### GraphQL/gRPC Support:
- Are we parsing/validating schemas on every request?
- Cache parsed GraphQL schemas and gRPC definitions

#### Request Transformation (JSONPath):
- JSONPath evaluation can be slow on large payloads
- Cache compiled JSONPath expressions
- Consider size limits on transformation targets

---

## Output Format

For each issue found, provide:

### 1. **Issue Location**
- File path and line numbers
- Specific function/component name

### 2. **Performance Impact**
- Current time complexity: O(?)
- Estimated performance impact: High/Medium/Low
- When it becomes a problem: (e.g., ">1000 rules", ">10K requests/day")

### 3. **Recommendation**
- Specific optimization approach
- Expected improvement
- Code example if applicable

### 4. **Acceptable Slowness?**
- Is this slowness functionally necessary?
- Example: AI generation, SSL provisioning, DNS propagation
- If yes, suggest UX improvements (loading states, background jobs)

### 5. **Implementation Priority**
- **P0 - Critical**: Causes timeouts/crashes (e.g., missing indexes on large tables)
- **P1 - High**: Significant performance impact (e.g., N+1 queries)
- **P2 - Medium**: Optimization opportunity (e.g., caching)
- **P3 - Low**: Marginal gains (e.g., micro-optimizations)

---

## Key Questions to Answer

1. **Database**:
   - Are all foreign keys indexed?
   - Are there composite indexes for common query patterns?
   - Is pagination enforced everywhere?

2. **Caching**:
   - What should be cached but isn't?
   - Are cache keys properly invalidated?

3. **Algorithms**:
   - Are we using the right data structures? (Maps vs Arrays vs Sets)
   - Can we replace linear searches with hash lookups?
   - Should we use specialized structures (Trie, heap, etc.)?

4. **Real-time**:
   - WebSocket connection management efficient?
   - Are we batching messages appropriately?

5. **Frontend**:
   - Virtual scrolling for large lists?
   - Are we preventing unnecessary re-renders?

6. **Scale**:
   - What breaks at 1K users? 10K? 100K?
   - Which features need horizontal scaling?

---

## Example Output Format

```
## Issue #1: Missing Index on Foreign Key
**Location**: `prisma/schema.prisma` - Request model
**Impact**: HIGH - O(n) table scan for every request query
**Problem**: No index on `endpointId` field in Request table
**Recommendation**: Add `@@index([endpointId])` to Request model
**Priority**: P0 - Critical (affects all request queries)

## Issue #2: N+1 Query in Endpoint List
**Location**: `src/services/endpoint.service.ts:42`
**Impact**: MEDIUM - Extra queries scale with number of endpoints
**Problem**: Loading rules in a loop after fetching endpoints
**Recommendation**: Use Prisma include to eager load rules
**Priority**: P1 - High (noticeable with >50 endpoints)

## Issue #3: Template Recompilation
**Location**: `src/services/mock.service.ts:127`
**Impact**: MEDIUM - Repeated parsing overhead
**Problem**: Handlebars templates compiled on every request
**Recommendation**: Cache compiled templates in Map
**Priority**: P2 - Medium (matters at high traffic)

## Issue #4: AI Rule Generation Latency
**Location**: `src/services/ai-rule-generator.service.ts:78`
**Impact**: LOW - Functionally necessary delay
**Problem**: Claude API takes 2-5 seconds
**Recommendation**: Acceptable - Add better loading UX and progress indicators
**Priority**: P3 - UX improvement only
```

---

## Final Deliverables

1. **Prioritized list** of performance issues
2. **Specific code changes** for top 10 issues
3. **Database migration** for missing indexes
4. **Caching strategy** recommendations
5. **Algorithm replacements** where beneficial
6. **What NOT to optimize** (functionally necessary slowness)

Analyze the codebase deeply and be thorough. Look for patterns, not just obvious issues.