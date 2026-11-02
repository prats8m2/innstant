/**
 * "8:52pm" — the board's clock, on the PROPERTY's zone (CLAUDE.md "Dates").
 *
 * Not `formatClock()`: that one says "noon" and "midnight", which is right for
 * opening hours and wrong for a wall clock that ticks through them.
 *
 * The space ICU puts before the meridiem (a narrow no-break space in newer
 * versions) is dropped, as the board writes it.
 */
export function clock12(at: number | Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone,
  })
    .format(new Date(at))
    .replace(/\s/g, '')
    .toLowerCase();
}
