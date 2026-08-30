/**
 * The request id. One value, followed from the edge to the log line.
 *
 * Kept in its own module with no dependencies because BOTH runtimes import it:
 * the middleware runs on the edge (no Node built-ins, no pino) and route
 * handlers run in Node. Anything heavier here would break the middleware.
 */
export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * An inbound id is accepted so a trace survives a proxy hop — but it arrives
 * from the public internet and lands in log lines, so it is bounded and
 * restricted to characters that cannot forge a newline or a JSON break. An id
 * that fails this is replaced, not rejected: the request is fine, only the
 * label is suspect.
 */
const SAFE_ID = /^[A-Za-z0-9._:-]{1,64}$/;

export function newRequestId(): string {
  return crypto.randomUUID();
}

export function requestIdFrom(headers: Headers): string {
  const inbound = headers.get(REQUEST_ID_HEADER);
  return inbound && SAFE_ID.test(inbound) ? inbound : newRequestId();
}
