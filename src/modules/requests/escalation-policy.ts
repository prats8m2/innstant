import type { RequestStatus } from './transitions';
import { SLA_ACTIVE_STATUSES } from './transitions';

/**
 * When a breach becomes somebody else's problem.
 *
 * Pure, and takes the instant — the sweep and any board that wants to show
 * "about to escalate" need the same answer, and a function that reads the clock
 * cannot be tested for the minute either side of a threshold.
 *
 * ─── Why levels rather than one escalation ─────────────────────────────────
 *
 * A request that is two minutes late and one that is forty minutes late are not
 * the same event. One is a busy floor; the other is nobody coming. Escalating
 * once conflates them, and escalating continuously turns into noise a duty
 * manager mutes — which is the failure mode that matters, because the whole
 * point is that somebody looks.
 *
 * Three levels, and it stops:
 *
 *   1  at the breach          — the assignee is told, and the board reddens
 *   2  ten minutes past       — the duty manager is told
 *   3  half an hour past      — it is on the manager's own board as a failure
 *
 * The thresholds are minutes past the target rather than multiples of the SLA:
 * a 5-minute wake-up call and a 45-minute room clean are equally late at the
 * same wall-clock lateness, and a guest waiting ten minutes past a promise does
 * not care that the promise was short.
 */
export const ESCALATION_STEPS = [
  { level: 1, afterMinutesLate: 0 },
  { level: 2, afterMinutesLate: 10 },
  { level: 3, afterMinutesLate: 30 },
] as const;

export type EscalationLevel = 0 | 1 | 2 | 3;

export interface EscalationInput {
  status: RequestStatus;
  slaTargetAt: Date | null;
  /** What has already been raised. Never goes down. */
  escalationLevel: number;
}

export interface EscalationDecision {
  /** The level this request should be at now. */
  level: EscalationLevel;
  /** True when that is higher than where it already is. */
  shouldEscalate: boolean;
  minutesLate: number;
}

export function escalationFor(input: EscalationInput, now: Date): EscalationDecision {
  const current = clampLevel(input.escalationLevel);

  // No promise, or the work has stopped: nothing to escalate. A completed
  // request that sat unverified for an hour is not a breach — the clock stops
  // with the work, which is the same rule `slaState()` follows.
  if (!input.slaTargetAt || !SLA_ACTIVE_STATUSES.includes(input.status)) {
    return { level: current, shouldEscalate: false, minutesLate: 0 };
  }

  const minutesLate = Math.floor((now.getTime() - input.slaTargetAt.getTime()) / 60_000);
  if (minutesLate < 0) {
    return { level: current, shouldEscalate: false, minutesLate: 0 };
  }

  let due: EscalationLevel = 0;
  for (const step of ESCALATION_STEPS) {
    if (minutesLate >= step.afterMinutesLate) due = step.level as EscalationLevel;
  }

  return {
    level: due > current ? due : current,
    // Only ever upward. A request that dropped back below its target — which a
    // corrected `sla_target_at` can do — must not un-escalate: somebody was
    // already told, and telling them it is fine now is worse than silence.
    shouldEscalate: due > current,
    minutesLate,
  };
}

/**
 * Who hears about it at each level.
 *
 * Returned rather than acted on, so the sweep decides how to deliver and this
 * file stays testable without a notifications table.
 */
export function audienceFor(level: EscalationLevel): ('ASSIGNEE' | 'DUTY_MANAGER')[] {
  if (level >= 2) return ['ASSIGNEE', 'DUTY_MANAGER'];
  if (level === 1) return ['ASSIGNEE'];
  return [];
}

function clampLevel(value: number): EscalationLevel {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value >= 3) return 3;
  return Math.floor(value) as EscalationLevel;
}
