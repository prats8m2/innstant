import { z } from 'zod';
import { httpStatusFor, publicPayloadFor, ValidationError } from '@/lib/errors';
import { REQUEST_ID_HEADER, newRequestId } from '@/lib/request-id';
import { requestLogger } from '@/lib/logger';

/**
 * The one place a `/api/v1` handler turns an error into a status. D-080.
 *
 * `httpStatusFor` has always been the single mapping point for the product
 * (src/lib/errors.ts); this is the wrapper that makes every route use it
 * without each one remembering to. A handler throws its typed error — the same
 * `ConflictError` a Server Action throws — and this maps it.
 *
 * ─── What a client is allowed to learn ─────────────────────────────────────
 *
 * `publicPayloadFor` decides, and it is deliberately narrow: a non-AppError
 * becomes `{ code: 'INTERNAL' }` and a generic sentence, never the thrown
 * message. A stack trace reaching a phone is a stack trace reaching whoever
 * has that phone.
 *
 * The request id goes back on every response, including the failures. It is
 * what a customer saying "it would not let me order" can be asked for, and it
 * is already on the log line.
 */
export function apiHandler<T>(
  route: string,
  fn: (request: Request, ctx: { log: ReturnType<typeof requestLogger> }) => Promise<T>,
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    const reqId = request.headers.get(REQUEST_ID_HEADER) ?? newRequestId();
    const log = requestLogger(reqId, { route });

    try {
      const body = await fn(request, { log });
      return Response.json(body, { headers: { [REQUEST_ID_HEADER]: reqId } });
    } catch (error) {
      const status = httpStatusFor(error);
      const payload = publicPayloadFor(error);

      // 5xx is ours and gets the stack; 4xx is the client's and gets a line.
      // Logging a refused order at error level is how a log stops being read.
      if (status >= 500) log.error({ err: error }, 'api request failed');
      else log.info({ status, code: payload.code }, 'api request refused');

      return Response.json(payload, {
        status,
        headers: { [REQUEST_ID_HEADER]: reqId },
      });
    }
  };
}

/**
 * Zod at the boundary (CLAUDE.md "Conventions"), with the failure turned into
 * the product's own error type rather than Zod's.
 *
 * Zod's messages are written for whoever wrote the schema. What reaches a
 * screen has to say what happened and what to do, so a parse failure becomes a
 * `ValidationError` with a sentence the handler chose and the field name in the
 * context, where the log can read it and the customer cannot.
 */
export async function parseBody<S extends z.ZodType>(
  request: Request,
  schema: S,
  message: string,
): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    // A body that is not JSON at all. Same answer as a body that is the wrong
    // shape — a client sending neither is a client with a bug, not a person.
    throw new ValidationError(message);
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError(message, {
      field: String(parsed.error.issues[0]?.path[0] ?? ''),
      issue: parsed.error.issues[0]?.message ?? '',
    });
  }
  return parsed.data;
}

/** The same, for a query string. */
export function parseQuery<S extends z.ZodType>(
  request: Request,
  schema: S,
  message: string,
): z.infer<S> {
  const url = new URL(request.url);
  const parsed = schema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) throw new ValidationError(message);
  return parsed.data;
}
