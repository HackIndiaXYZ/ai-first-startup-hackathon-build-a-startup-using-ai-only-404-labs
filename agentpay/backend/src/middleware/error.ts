import { FastifyError, FastifyRequest, FastifyReply } from 'fastify';
import { ZodError } from 'zod';

export function errorHandler(
  error: FastifyError | Error,
  request: FastifyRequest,
  reply: FastifyReply
): void {
  const requestId = request.id;

  // Zod validation errors
  if (error instanceof ZodError) {
    reply.code(422).send({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed.',
        request_id: requestId,
        details: error.flatten().fieldErrors,
      },
    });
    return;
  }

  // Fastify errors (including 404, etc.)
  if ('statusCode' in error && error.statusCode) {
    reply.code(error.statusCode).send({
      error: {
        code: error.code || 'HTTP_ERROR',
        message: error.message,
        request_id: requestId,
      },
    });
    return;
  }

  // Postgres errors
  if ('code' in error) {
    const pgError = error as NodeJS.ErrnoException & { code: string; constraint?: string };
    if (pgError.code === '23505') {
      reply.code(409).send({
        error: {
          code: 'CONFLICT',
          message: 'A resource with this identifier already exists.',
          request_id: requestId,
        },
      });
      return;
    }
    if (pgError.code === '23503') {
      reply.code(422).send({
        error: {
          code: 'REFERENCE_ERROR',
          message: 'Referenced resource does not exist.',
          request_id: requestId,
        },
      });
      return;
    }
  }

  // Unknown errors — don't expose internals
  request.log.error(error, 'Unhandled error');
  reply.code(500).send({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An internal error occurred.',
      request_id: requestId,
    },
  });
}
