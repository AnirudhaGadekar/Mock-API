/**
 * Fastify type augmentations for MockUrl
 */
import 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    endpoint?: import('./mock.types.js').Endpoint;
    _requestLogStart?: number;
    _pathForRules?: string;
    user?: any;
    v2Auth?: import('../middleware/auth-v2.middleware.js').V2AuthContext;
  }
}
