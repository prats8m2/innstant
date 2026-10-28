import { parseClock } from '@/lib/clock';
import { ValidationError } from '@/lib/errors';

/**
 * The checks every schedule passes before it is stored: a collection's
 * (D-084) and an offer's (D-085), which share the same four fields and the
 * same meaning. One set of rules and one set of messages, so a manager is
 * told the same thing on both screens.
 */

export function validateWindow(
  from: string | null | undefined,
  until: string | null | undefined,
): { from: string | null; until: string | null } {
  const start = from?.trim() || null;
  const end = until?.trim() || null;

  if (!start && !end) return { from: null, until: null };
  if (!start || !end) {
    throw new ValidationError('A window needs both a start and an end — or neither.');
  }

  let startMinutes: number;
  let endMinutes: number;
  try {
    startMinutes = parseClock(start);
    endMinutes = parseClock(end);
  } catch {
    throw new ValidationError('Times are 24-hour, like 22:00 and 01:00.');
  }

  if (startMinutes === endMinutes) {
    throw new ValidationError('A window that starts and ends at the same minute shows nothing.');
  }

  return { from: start, until: end };
}

/** 0 = Sunday. All seven is every day, stored as NULL (see migration 0010). */
export function validateDays(days: readonly number[] | null | undefined): number[] | null {
  if (!days) return null;
  const unique = [...new Set(days)].sort((a, b) => a - b);
  if (unique.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
    throw new ValidationError('Days run from Sunday (0) to Saturday (6).');
  }
  if (unique.length === 0) {
    throw new ValidationError('Pick at least one day, or switch the collection off.');
  }
  return unique.length === 7 ? null : unique;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function validateDates(
  startsOn: string | null | undefined,
  endsOn: string | null | undefined,
): { startsOn: string | null; endsOn: string | null } {
  const start = startsOn?.trim() || null;
  const end = endsOn?.trim() || null;
  for (const date of [start, end]) {
    if (date === null) continue;
    const parsed = new Date(`${date}T00:00:00Z`);
    if (!ISO_DATE.test(date) || Number.isNaN(parsed.getTime())
      || parsed.toISOString().slice(0, 10) !== date) {
      throw new ValidationError('Dates are written like 2026-11-05.');
    }
  }
  if (start && end && end < start) {
    throw new ValidationError('It ends before it starts. Swap the dates.');
  }
  return { startsOn: start, endsOn: end };
}
