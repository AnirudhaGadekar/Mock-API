/**
 * Global custom error classes used across the API.
 * Keeping them centralized ensures consistent error shapes and logging.
 */

export type ErrorMetadata = Record<string, unknown>;

export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly meta?: ErrorMetadata;

  constructor(message: string, options: { statusCode?: number; code?: string; meta?: ErrorMetadata } = {}) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = options.statusCode ?? 500;
    this.code = options.code ?? 'INTERNAL_ERROR';
    this.meta = options.meta;
  }
}

export class NotFoundError extends ApiError {
  constructor(message = 'Resource not found', meta?: ErrorMetadata) {
    super(message, { statusCode: 404, code: 'NOT_FOUND', meta });
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends ApiError {
  constructor(message = 'Validation failed', meta?: ErrorMetadata) {
    super(message, { statusCode: 422, code: 'VALIDATION_ERROR', meta });
    this.name = 'ValidationError';
  }
}

export class RateLimitError extends ApiError {
  public readonly retryAfter?: number;

  constructor(message = 'Rate limit exceeded', meta?: ErrorMetadata & { retryAfter?: number }) {
    super(message, { statusCode: 429, code: 'RATE_LIMIT_EXCEEDED', meta });
    this.name = 'RateLimitError';
    this.retryAfter = meta?.retryAfter;
  }
}
