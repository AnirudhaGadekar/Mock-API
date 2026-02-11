import { z } from 'zod';

export const stateValueSchema = z.any().refine(
  (val) => {
    try {
      const str = JSON.stringify(val);
      return str.length < 100 * 1024; // 100KB max
    } catch {
      return false;
    }
  },
  { message: 'State value too large (max 100KB)' }
);

export const stateKeySchema = z.string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9-_:.]+$/, 'Invalid state key format');

export const endpointIdSchema = z.string()
  .uuid('Invalid endpoint ID format');