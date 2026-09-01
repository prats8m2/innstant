/**
 * A queued row is a template name and a payload, never a rendered string
 * (DATA-MODEL §8). This is where the two become a sentence.
 *
 * ─── Why the wording is not in the row ─────────────────────────────────────
 *
 * `queueNotifications()` stores `service_request.escalated` and
 * `{ requestNumber, level, minutesLate }`. Rendering here rather than at write
 * time means changing what an escalation SAYS does not rewrite what past
 * escalations said they said — the row stays the audit record of what happened,
 * and the wording stays a product decision that can be edited on a Tuesday.
 *
 * It also keeps this file pure. No database, no React, no `Tx` — so it unit
 * tests, and so a client component can be handed the finished strings as props
 * rather than importing a module index and dragging `pg` into the browser
 * bundle.
 */

export interface RenderedNotification {
  /** One line, the thing that is true. Shown in bold on the bell. */
  title: string;
  /** One line, what to do about it. Never an apology, never vague. */
  body: string;
  /** Where the work is, or null when there is nowhere useful to send anyone. */
  href: string | null;
}

export interface NotificationContent {
  template: string;
  payload: Record<string, unknown>;
}

export function renderNotification(input: NotificationContent): RenderedNotification {
  switch (input.template) {
    case 'service_request.escalated':
      return escalated(input.payload);
    default:
      return unknownTemplate(input.template);
  }
}

function escalated(payload: Record<string, unknown>): RenderedNotification {
  const number = str(payload.requestNumber) ?? 'A request';
  const level = num(payload.level) ?? 1;
  const late = num(payload.minutesLate) ?? 0;

  return {
    // "12 minutes late", not "SLA breach". The person reading this on a phone
    // in a corridor needs the number, not the vocabulary.
    title: `${number} is ${minutes(late)} late`,
    body: BODY_BY_LEVEL[level] ?? BODY_BY_LEVEL[1]!,
    // The board, not a per-request page — there is no such page, and a link
    // that 404s is worse than a link that lands one tap away.
    href: '/housekeeping',
  };
}

/**
 * Three sentences for three audiences (D-028). Level 1 is the assignee, level 2
 * the duty manager, level 3 the duty manager again and by then it is theirs.
 */
const BODY_BY_LEVEL: Record<number, string> = {
  1: 'It is assigned to you. Go now, or hand it back so somebody else can take it.',
  2: 'Nobody has finished it. Find whoever has it, or give it to somebody who is free.',
  3: 'Half an hour past the promise. Deal with this one yourself.',
};

/**
 * A template nothing renders yet.
 *
 * Deliberately not a blank card and not a throw. A drainer that meets a
 * template from a newer deploy — or a row queued by a branch that landed
 * first — should still show the staff member that SOMETHING was sent to them,
 * with enough to ask about it. Silence is the failure this table exists to
 * prevent.
 */
function unknownTemplate(template: string): RenderedNotification {
  return {
    title: 'An alert with no wording yet',
    body: `Sent as "${template}". Tell whoever runs this system what you were doing.`,
    href: null,
  };
}

/** "1 minute", "12 minutes". Nothing here is ever big enough to need grouping. */
function minutes(value: number): string {
  const whole = Math.max(0, Math.round(value));
  return whole === 1 ? '1 minute' : `${whole} minutes`;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
