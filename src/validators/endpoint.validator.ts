import { z } from 'zod';

/**
 * Custom endpoint name validator (MockUrl spec): /^[a-z0-9-]{5,40}$/
 */
export const endpointNameSchema = z
  .string()
  .min(5, 'Endpoint name must be at least 5 characters')
  .max(40, 'Endpoint name must be at most 40 characters')
  .regex(/^[a-z0-9-]{5,40}$/, {
    message: 'Endpoint name must be 5-40 characters, lowercase alphanumeric and hyphens only',
  });

/**
 * Mock rule response schema (MockUrl-compatible)
 */
export const mockRuleResponseSchema = z.object({
  status: z.number().int().min(100).max(599),
  body: z.unknown().optional(),
  headers: z.record(z.string()).optional(),
  delay: z.number().int().min(0).max(30000).optional(), // max 30s delay
});

/**
 * Mock rule schema (matches MockUrl structure)
 */
export const mockRuleSchema = z.object({
  path: z.string().regex(/^\/.*$/, { message: 'Path must start with /' }),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']),
  response: mockRuleResponseSchema,
  condition: z
    .object({
      queryParams: z.record(z.string()).optional(),
      headers: z.record(z.string()).optional(),
      bodyContains: z.string().optional(),
    })
    .optional(),
  sequence: z.boolean().optional(), // If true, cycle through multiple matching rules
});

/**
 * Default mock rules (MockUrl spec exact)
 */
export const DEFAULT_MOCK_RULES = [
  {
    path: '/todo',
    method: 'GET' as const,
    response: {
      status: 200,
      body: [{ id: 1, title: 'Mock todo', done: false }],
    },
  },
  {
    path: '/todo',
    method: 'POST' as const,
    response: {
      status: 201,
      body: '{{JSON.stringify(req.body)}}',
      headers: { Location: '/todo/{{req.body.id}}' },
    },
  },
];

/**
 * CREATE endpoint request schema (MockUrl: { name } → optional rules)
 */
export const createEndpointSchema = z.object({
  name: endpointNameSchema,
  rules: z.array(mockRuleSchema).min(1).max(50).optional(),
});

export type CreateEndpointInput = z.infer<typeof createEndpointSchema>;

/**
 * LIST endpoints query schema
 */
export const listEndpointsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  afterId: z.string().uuid().optional(),
  sort: z.enum(['createdAt:desc', 'createdAt:asc', 'name:asc', 'name:desc']).default('createdAt:desc'),
  search: z.string().max(100).optional(),
});

export type ListEndpointsQuery = z.infer<typeof listEndpointsQuerySchema>;

/**
 * Endpoint response schema (matches MockUrl API format)
 */
export const endpointResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  subdomain: z.string(),
  url: z.string().url(),
  dashboardUrl: z.string(),
  description: z.string().nullable(),
  rules: z.array(mockRuleSchema),
  requestCount: z.number().int(),
  createdAt: z.date(),
  updatedAt: z.date(),
  stats: z
    .object({
      requests24h: z.number().int(),
      totalRequests: z.number().int(),
      lastRequestAt: z.date().nullable(),
    })
    .optional(),
});

export type EndpointResponse = z.infer<typeof endpointResponseSchema>;

/**
 * API error response schema (MockUrl-compatible)
 */
export const apiErrorSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
  }),
  timestamp: z.string().datetime(),
});

/**
 * Success response wrapper
 */
export const apiSuccessSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    success: z.literal(true),
    data: dataSchema,
    timestamp: z.string().datetime(),
  });

/**
 * Pagination response schema
 */
export const paginatedResponseSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    success: z.literal(true),
    data: z.object({
      endpoints: z.array(itemSchema),
      nextCursor: z.string().uuid().nullable(),
      totalCount: z.number().int(),
      hasMore: z.boolean(),
    }),
    timestamp: z.string().datetime(),
  });
