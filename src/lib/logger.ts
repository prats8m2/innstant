/**
 * Structured logging. Node runtime only — the edge middleware must not import
 * this (see request-id.ts).
 *
 * One line of JSON per event, straight to stdout, which is what Railway
 * collects. No transport and no pretty-printer: pino's pretty transport spawns
 * a worker thread, and a worker inside a Next.js server bundle is a class of
 * problem this project does not need. Read local logs with `| pnpm exec pino-pretty`
 * if you want colour.
 *
 * Every request-scoped log line carries `reqId`, which is the same value the
 * client got back in the `x-request-id` response header — so a guest saying
 * "it failed at 9:40" turns into one grep instead of a timeline reconstruction.
 */
import pino from 'pino';

const isProduction = process.env.NODE_ENV === 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isProduction ? 'info' : 'debug'),
  base: {
    service: 'guest-services',
    env: process.env.NODE_ENV ?? 'development',
    // Railway sets this on every deploy; it is how a log line is tied back to
    // a commit without guessing which build was live.
    release: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
  },
  // Guest phone numbers, tokens and passwords must never reach a log file.
  // This is a backstop for a careless `log.info({ body })`, not a licence to
  // write one.
  redact: {
    paths: [
      'password', '*.password',
      'token', '*.token',
      'phone', '*.phone',
      'req.headers.cookie', 'req.headers.authorization',
    ],
    censor: '[redacted]',
  },
  // Timestamps in ISO, because a human reads these next to a guest complaint.
  timestamp: pino.stdTimeFunctions.isoTime,
});

export type Logger = typeof logger;

/** A child logger bound to one request. Pass it down; do not re-derive it. */
export function requestLogger(reqId: string, fields: Record<string, unknown> = {}): Logger {
  return logger.child({ reqId, ...fields });
}
