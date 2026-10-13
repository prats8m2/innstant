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
/**
 * `/api/v1` answers cross-origin. D-080.
 *
 * ─── Why a wildcard is the SAFE choice here, not the lazy one ──────────────
 *
 * A native client is not subject to CORS at all — RN's `fetch` ignores it — so
 * none of this is for the app. It is for every other client: Expo's web
 * target, a future ordering page on a restaurant's own domain, and anyone
 * debugging with curl or a browser console.
 *
 * `*` CANNOT be combined with credentials: a browser refuses to send cookies
 * to a wildcard origin, and refuses the response if the server tries to allow
 * both. That is exactly the behaviour this API wants. It authenticates by
 * BEARER TOKEN — a header a cross-origin page can only set if it already has
 * the token — so there is no ambient authority to abuse and no CSRF to
 * defend: a malicious page can make the request and will be answered 401,
 * because it has nothing to put in the header.
 *
 * The cookie fallback in `guestCredentialFrom` simply does not work
 * cross-origin, which is correct rather than a limitation. Same-origin callers
 * (the web app itself) are unaffected.
 *
 * If this ever needs credentials cross-origin, the wildcard has to become an
 * allow-list of exact origins and `Vary: Origin` has to be set. Do not add
 * `Allow-Credentials` to a wildcard; browsers reject it, which is the one
 * mercy in this area.
 */
const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type',
  // A day. The preflight answer cannot go stale in a way that matters — the
  // methods and headers are fixed by this file.
  'access-control-max-age': '86400',
};

/** The preflight. Every route exports this; it carries no data and no auth. */
export function corsPreflight(): Response {
  return new Response(null, { status: 204, headers: CORS });
}

export function apiHandler<T>(
  route: string,
  fn: (request: Request, ctx: { log: ReturnType<typeof requestLogger> }) => Promise<T>,
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    const reqId = request.headers.get(REQUEST_ID_HEADER) ?? newRequestId();
    const log = requestLogger(reqId, { route });

    try {
      const body = await fn(request, { log });
      return Response.json(body, { headers: { ...CORS, [REQUEST_ID_HEADER]: reqId } });
    } catch (error) {
      const status = httpStatusFor(error);
      const payload = publicPayloadFor(error);

      // 5xx is ours and gets the stack; 4xx is the client's and gets a line.
      // Logging a refused order at error level is how a log stops being read.
      if (status >= 500) log.error({ err: error }, 'api request failed');
      else log.info({ status, code: payload.code }, 'api request refused');

      return Response.json(payload, {
        status,
        // On the failures too: a browser that cannot read a 401 because the
        // header is missing reports a CORS error instead, and the client
        // sees a network failure where the server gave a clear answer.
        headers: { ...CORS, [REQUEST_ID_HEADER]: reqId },
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
