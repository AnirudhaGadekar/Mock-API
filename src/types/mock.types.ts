/**
 * Core types for MockUrl mock endpoint system
 */

/**
 * Rule response configuration
 */
export interface RuleResponse {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
  headerRewriting?: HeaderRewritingRule[]; // Rule-specific rewriting
  delay?: number; // Delay in milliseconds (0-30000)
}

export interface HeaderRewritingRule {
  key: string;
  value?: string; // If null, delete the header. Supports templating.
  op: 'SET' | 'APPEND' | 'DELETE';
}

/**
 * Rule condition for matching requests
 */
export interface RuleCondition {
  queryParams?: Record<string, string>;
  headers?: Record<string, string>;
  bodyContains?: string;
  jwtValidation?: {
    header?: string; // e.g. "Authorization"
    secret: string;
    issuer?: string;
    audience?: string;
    required?: boolean; // If false, only validate if header is present
  };
}

/**
 * Mock rule definition
 */
export interface Rule {
  id?: string; // Optional unique identifier for sequence tracking
  path: string; // Must start with /
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD';
  response: RuleResponse;
  condition?: RuleCondition;
  sequence?: boolean; // If true, cycle through multiple matching rules
}

/**
 * Endpoint settings
 */
export interface EndpointSettings {
  webhookUrl?: string; // URL to call when endpoint receives a request
  targetUrl?: string; // Single fallback URL (legacy)
  upstreams?: string[]; // Chain of servers to proxy through
  globalHeaderRewriting?: HeaderRewritingRule[]; // Workspace-level rewriting
}

/**
 * Endpoint data structure (compatible with Prisma Json fields for rules/settings)
 */
export interface Endpoint {
  id: string;
  name: string;
  slug: string; // Unique subdomain identifier
  rules: Rule[] | unknown; // Prisma returns Json
  settings?: EndpointSettings | unknown;
  userId?: string | null;
  teamId?: string | null;
  requestCount: number;
  lastActiveAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Formatted endpoint response for API
 */
export interface EndpointResponse {
  id: string;
  name: string;
  subdomain: string;
  url: string;
  dashboardUrl: string;
  rules: Rule[];
  reqCount: number;
  createdAt: Date;
  workspaceType: 'TEAM' | 'PERSONAL';
  teamId?: string | null;
}

/**
 * Request context attached to FastifyRequest
 */
export interface MockRequestContext {
  endpoint: Endpoint;
  _requestLogStart: number; // Timestamp when request started
  _pathForRules: string; // Normalized path for rule matching
}

/**
 * Matched rule result
 */
export interface MatchedRule {
  rule: Rule;
  params: Record<string, string>; // Extracted path parameters
  sequenceIndex?: number; // Index in sequence if sequence rule
}
