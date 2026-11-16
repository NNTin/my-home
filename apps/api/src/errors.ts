import { formatPath, type ApiError } from '@my-home/shared';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';

const contextLabel: Record<string, string> = {
  body: 'request body',
  params: 'URL parameters',
  querystring: 'query string',
  headers: 'headers',
};

/** `/openings/2/width` -> `openings[2].width` */
const pointerToPath = (pointer: string) =>
  formatPath(
    pointer
      .split('/')
      .slice(1)
      .filter((p) => p !== '')
      .map((p) => (/^\d+$/.test(p) ? Number(p) : p)),
  );

/** Validation errors become a 400 listing path-based issues; other errors keep their status. */
export function errorHandler(err: FastifyError, request: FastifyRequest, reply: FastifyReply) {
  if (hasZodFastifySchemaValidationErrors(err)) {
    const issues = err.validation.map((v) => ({
      path: pointerToPath(v.instancePath),
      message: v.message ?? 'Invalid value',
    }));
    const where = contextLabel[err.validationContext ?? 'body'] ?? 'request';
    const first = issues[0]!;
    const more = issues.length > 1 ? ` (and ${issues.length - 1} more)` : '';
    const body: ApiError = {
      statusCode: 400,
      error: 'Bad Request',
      message: `Invalid ${where}: ${first.path || '(root)'}: ${first.message}${more}`,
      issues,
    };
    return reply.code(400).send(body);
  }

  const statusCode = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
  if (statusCode >= 500) request.log.error({ err }, 'request failed');
  const body: ApiError = {
    statusCode,
    error: statusCode >= 500 ? 'Internal Server Error' : (err.code ?? 'Error'),
    // Never expose internal error messages to callers.
    message: statusCode >= 500 ? 'Internal server error' : err.message,
  };
  return reply.code(statusCode).send(body);
}
