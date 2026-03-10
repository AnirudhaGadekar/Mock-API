import { FastifyReply, FastifyRequest } from 'fastify';
import { V2ErrorCode } from './v2-error-codes.js';

interface V2ErrorPayload {
  code: V2ErrorCode;
  message: string;
  details?: unknown;
}

export function v2Success<T>(reply: FastifyReply, data: T, statusCode = 200) {
  return reply.status(statusCode).send({
    success: true,
    data,
    timestamp: new Date().toISOString(),
  });
}

export function v2Error(
  request: FastifyRequest,
  reply: FastifyReply,
  statusCode: number,
  error: V2ErrorPayload,
) {
  return reply.status(statusCode).send({
    success: false,
    error,
    timestamp: new Date().toISOString(),
    requestId: request.id,
  });
}
