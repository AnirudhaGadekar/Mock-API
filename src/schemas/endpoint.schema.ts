import { z } from 'zod';

export const createEndpointSchema = z.object({
  name: z.string()
    .min(1, 'Name is required')
    .max(100, 'Name too long')
    .regex(/^[a-zA-Z0-9-_]+$/, 'Name can only contain alphanumeric, dash, underscore'),
  
  rules: z.array(z.object({
    method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']),
    path: z.string()
      .regex(/^\/[a-zA-Z0-9-_/{}]*$/, 'Invalid path format'),
    conditions: z.array(z.object({
      type: z.enum(['header', 'query', 'body', 'state']),
      key: z.string(),
      operator: z.enum(['equals', 'contains', 'regex', 'exists']),
      value: z.any().optional(),
    })).optional(),
    response: z.object({
      status: z.number().min(100).max(599),
      body: z.any(),
      headers: z.record(z.string()).optional(),
      delay: z.number().min(0).max(30000).optional(),
    }),
  })).max(100, 'Too many rules (max 100)'),
  
  settings: z.object({
    webhookUrl: z.string().url().optional(),
    logRequests: z.boolean().optional(),
  }).optional(),
});

export const updateEndpointSchema = z.object({
  name: z.string()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z0-9-_]+$/)
    .optional(),
  rules: createEndpointSchema.shape.rules.optional(),
  settings: createEndpointSchema.shape.settings.optional(),
});

export type CreateEndpointInput = z.infer<typeof createEndpointSchema>;
export type UpdateEndpointInput = z.infer<typeof updateEndpointSchema>;