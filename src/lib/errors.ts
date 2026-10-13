/**
 * Typed errors, thrown — never returned as `{ error }` tuples.
 * Mapped to an HTTP status in exactly ONE place: `httpStatusFor()`.
 *
 * Guest-facing messages say what happened and what to do. They do not
 * apologise and they are never vague (CLAUDE.md "Conventions").
 */

export abstract class AppError extends Error {
  abstract readonly code: string;
  /** Safe to show a user. Everything else stays in the log. */
  abstract readonly publicMessage: string;

  constructor(message: string, readonly context: Record<string, unknown> = {}) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * No session, or a session that no longer resolves.
 *
 * The default is written for the staff console, where signing in is a thing a
 * person can actually do. It is wrong on a guest surface — there is no sign-in
 * anywhere in the guest app (#9), so telling somebody to do one sends them
 * looking for a screen that does not exist. A guest-facing throw passes its
 * own sentence; see `requireVisitSession()` in src/lib/api-auth.ts.
 */
export class UnauthenticatedError extends AppError {
  readonly code = 'UNAUTHENTICATED';
  readonly publicMessage: string;
  constructor(message: string, publicMessage?: string, context: Record<string, unknown> = {}) {
    super(message, context);
    this.publicMessage = publicMessage ?? 'Sign in to continue.';
  }
}

/**
 * The caller is known and lacks the permission — at a property they can
 * legitimately see. Distinct from NotFoundError on purpose; see the note on
 * `httpStatusFor`.
 *
 * ─── The message is the caller's, like every other error here ──────────────
 *
 * This used to hold a fixed `publicMessage` of "You do not have permission to do
 * that." — so five throw sites that had each written a specific, actionable
 * sentence had all of them silently replaced by that one. A guest whose card had
 * been declined read "You do not have permission to do that" instead of "Charges
 * to this room are on hold. The front desk can take the order", and had done
 * since P1.
 *
 * It now behaves like `ValidationError` and `ConflictError`: what the thrower
 * writes is what the person reads. A refusal that genuinely should not explain
 * itself says the vague sentence deliberately and puts the detail in `context`,
 * which is logged and never sent — `authorize()` is the one that does.
 */
export class ForbiddenError extends AppError {
  readonly code = 'FORBIDDEN';
  readonly publicMessage: string;
  constructor(publicMessage: string, context: Record<string, unknown> = {}) {
    super(publicMessage, context);
    this.publicMessage = publicMessage;
  }
}

/**
 * Also used when a caller has no business knowing a resource exists.
 *
 * A staff user reaching across properties gets this, never ForbiddenError:
 * 403 would confirm the resource exists, and that single bit is enough to
 * enumerate another hotel's rooms or orders. Cross-tenant access is
 * indistinguishable from a typo, by design.
 *
 * ─── The message is the caller's — the same fix ForbiddenError had ─────────
 *
 * This held a fixed `publicMessage` of 'That is no longer available.', and so
 * every one of the thirty-odd throw sites that had written a specific,
 * actionable sentence had it silently replaced. "No such room at this
 * property", "That link has expired or has already been used. Ask for a new
 * one", "That dish is no longer on the menu" — all of them, since P0, read as
 * one vague line.
 *
 * It is the identical bug the note on `ForbiddenError` above describes having
 * already been found and fixed there, in a class written the same way on the
 * same day. Finding it twice is the argument for the rule the two of them now
 * share: **what the thrower writes is what the person reads.**
 *
 * ─── Which means a vague refusal has to say so deliberately ────────────────
 *
 * Two kinds of throw must NOT explain themselves, and both now do that on
 * purpose rather than by accident:
 *
 *   · `authorize()` — a property the session cannot see. Naming it would
 *     confirm it exists.
 *   · `QrNotUsableError` — unknown code, revoked sticker, wrong version and
 *     no-active-stay are ONE sentence, because a scanner in a corridor must
 *     not learn which, and in particular must not learn whether a room is
 *     occupied (D-012).
 *
 * Both pass a deliberately uninformative sentence and put the detail in
 * `context`, which is logged and never sent.
 */
export class NotFoundError extends AppError {
  readonly code = 'NOT_FOUND';
  readonly publicMessage: string;
  constructor(publicMessage: string, context: Record<string, unknown> = {}) {
    super(publicMessage, context);
    this.publicMessage = publicMessage;
  }
}

/** Input failed validation at a boundary. */
export class ValidationError extends AppError {
  readonly code = 'VALIDATION';
  readonly publicMessage: string;
  constructor(publicMessage: string, context: Record<string, unknown> = {}) {
    super(publicMessage, context);
    this.publicMessage = publicMessage;
  }
}

/** The action is legal but not from the current state — a state machine said no. */
export class ConflictError extends AppError {
  readonly code = 'CONFLICT';
  readonly publicMessage: string;
  constructor(publicMessage: string, context: Record<string, unknown> = {}) {
    super(publicMessage, context);
    this.publicMessage = publicMessage;
  }
}

/** Rate limited — verification attempts, OTP sends, public endpoints. */
export class TooManyAttemptsError extends AppError {
  readonly code = 'TOO_MANY_ATTEMPTS';
  readonly publicMessage: string;
  constructor(readonly retryAfterSeconds: number, publicMessage?: string) {
    super('too many attempts', { retryAfterSeconds });
    this.publicMessage =
      publicMessage ?? `Too many attempts. Try again in ${Math.ceil(retryAfterSeconds / 60)} minutes.`;
  }
}

/**
 * The single mapping point. Adding a status anywhere else is how a 403 ends up
 * leaking the existence of another hotel's data.
 */
export function httpStatusFor(error: unknown): number {
  if (!(error instanceof AppError)) return 500;
  switch (error.code) {
    case 'UNAUTHENTICATED': return 401;
    case 'FORBIDDEN': return 403;
    case 'NOT_FOUND': return 404;
    case 'VALIDATION': return 422;
    case 'CONFLICT': return 409;
    case 'TOO_MANY_ATTEMPTS': return 429;
    default: return 500;
  }
}

/** What a client is allowed to see. Never the raw message of a non-AppError. */
export function publicPayloadFor(error: unknown): { code: string; message: string } {
  if (error instanceof AppError) return { code: error.code, message: error.publicMessage };
  return { code: 'INTERNAL', message: 'Something went wrong on our side.' };
}
