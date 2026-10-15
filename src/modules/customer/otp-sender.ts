import { logger } from '@/lib/logger';

/**
 * How a one-time code reaches a phone. D-081.
 *
 * ─── Why this is an interface and not a Twilio call ────────────────────────
 *
 * The same reasoning as `PmsAdapter` (EXTENSION-POINTS §B, D-038): the
 * boundary is guarded more carefully than the implementation behind it,
 * because the implementation is the part that gets replaced.
 *
 * Adding an SMS provider is a decision with a running cost and an account
 * somebody has to own — CLAUDE.md says ask before adding an external service,
 * and nobody has. So the flow is built whole against this interface and ships
 * with the console sender below. Everything downstream — the challenge table,
 * the rate limits, the session, the screens — is finished and exercised. When
 * a provider is chosen it is one file and one environment variable, and
 * nothing above this line changes.
 *
 * ─── What a sender is NOT allowed to do ────────────────────────────────────
 *
 * Return anything. A sender that handed the code back to its caller would
 * invite a route handler putting it in a response "just for development",
 * which is how a code ends up in a log aggregator, a crash report and a
 * support screenshot. It takes the code and it is responsible for it.
 */
export interface OtpSender {
  /** Stable, logged, and used to pick the implementation. */
  readonly name: string;
  send(input: { phone: string; code: string; expiresInMinutes: number }): Promise<void>;
}

/**
 * The one that ships. Writes the code to the server log and nowhere else.
 *
 * This is a development and staging sender, and it is honest about being one:
 * anybody who can read the server log can sign in as anybody. That is exactly
 * as bad as it sounds and exactly why `assertSenderIsSafeFor()` below refuses
 * to let it run in production.
 */
export class ConsoleOtpSender implements OtpSender {
  readonly name = 'console';

  async send(input: { phone: string; code: string; expiresInMinutes: number }): Promise<void> {
    logger.warn(
      {
        phone: input.phone,
        code: input.code,
        expiresInMinutes: input.expiresInMinutes,
        sender: this.name,
      },
      'OTP NOT SENT — no SMS provider configured. The code is in this log line.',
    );
  }
}

/**
 * Picked once, from the environment.
 *
 * `SMS_PROVIDER_KEY` already exists in .env as an empty placeholder. When it
 * holds a key, this is where the real sender is constructed — and the
 * assertion below starts passing in production for the first time.
 */
export function otpSender(): OtpSender {
  // A fixed code and a sender that announces it travel together — selecting
  // one without the other is how this gets left on quietly.
  if (process.env.OTP_DEMO_CODE?.trim()) return new DemoOtpSender();

  // No real provider is wired yet. The branch exists so that adding one is an
  // import and a return, rather than the first-ever notion that there could
  // be more than one sender.
  return new ConsoleOtpSender();
}

/**
 * The demo sender. Pairs with `OTP_DEMO_CODE`.
 *
 * It sends nothing and — unlike `ConsoleOtpSender` — it does not write the
 * code down either, because with a fixed code there is nothing to write: the
 * code is in an environment variable and whoever is demonstrating already
 * knows it. Logging it per request would add a leak without adding an ability.
 *
 * What it DOES log, every time, is that a fixed code is in force. A thing this
 * dangerous should be impossible to have switched on without noticing.
 */
export class DemoOtpSender implements OtpSender {
  readonly name = 'demo';

  async send(input: { phone: string; code: string; expiresInMinutes: number }): Promise<void> {
    logger.warn(
      { phone: input.phone, sender: this.name, expiresInMinutes: input.expiresInMinutes },
      'FIXED DEMO OTP IS ACTIVE — every number signs in with the same code. '
        + 'Unset OTP_DEMO_CODE to restore real codes.',
    );
  }
}

/**
 * Refuse to run the console sender in production.
 *
 * Called at the point a code is about to be generated, not at startup: a
 * process that boots fine and then silently logs everybody's OTP is worse
 * than one that refuses the first sign-in attempt with a message naming the
 * problem. The guest-facing message says nothing about why.
 */
export function assertSenderIsSafeFor(sender: OtpSender, env: string | undefined): void {
  if (env === 'production' && sender.name === 'console') {
    throw new Error(
      'Refusing to issue an OTP in production with the console sender: the code ' +
        'would be written to the server log. Configure SMS_PROVIDER_KEY and a real ' +
        'OtpSender before enabling customer sign-in.',
    );
  }

  /**
   * The demo sender is NOT refused in production, and that is a decision
   * rather than an oversight: a fixed code is the only way to demonstrate
   * sign-in before an SMS provider exists, and refusing it here would mean
   * the demo lies about what the product does.
   *
   * It is not waved through either. Switching it on is an explicit variable,
   * every send says so at warn level, and the sender itself is the one that
   * refuses to write the code down. The console sender stays refused because
   * its failure mode is different and worse: a RANDOM code in a log is a
   * credential anyone with log access can use once, per person, silently.
   */
}
