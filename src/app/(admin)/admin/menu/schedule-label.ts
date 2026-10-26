import type { ScheduleState } from '@/modules/catalog';

/**
 * A collection's state in the words the console uses, on the collections
 * page and on the board's cards alike. One function so the two screens
 * cannot describe one collection two ways (D-084).
 */
export function scheduleLabel(state: ScheduleState): { label: string; tone: 'live' | 'waiting' | 'off' } {
  switch (state.kind) {
    case 'live': return { label: 'showing now', tone: 'live' };
    case 'later': return { label: `later today · from ${state.from}`, tone: 'waiting' };
    case 'upcoming': return { label: `starts ${shortDate(state.startsOn)}`, tone: 'waiting' };
    case 'ended': return { label: `ended ${shortDate(state.endedOn)}`, tone: 'off' };
    case 'not-today': return { label: 'not showing today', tone: 'off' };
  }
}

/** `2026-11-05` → `5 Nov`. A bare date: UTC, so no zone moves it. */
function shortDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
    .format(new Date(Date.UTC(y!, m! - 1, d!)));
}
