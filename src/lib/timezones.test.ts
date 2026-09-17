import { describe, it, expect } from 'vitest';
import { offeredTimezones } from './timezones';

describe('offeredTimezones', () => {
  it('always contains the zone the property is already on', () => {
    // The exact case that broke: this runtime's ICU canonicalises to
    // Asia/Calcutta, and every property in the product stores Asia/Kolkata.
    expect(offeredTimezones('Asia/Kolkata')).toContain('Asia/Kolkata');
    expect(offeredTimezones('Asia/Calcutta')).toContain('Asia/Calcutta');
  });

  it('does not duplicate one the runtime already offers', () => {
    const supported = Intl.supportedValuesOf('timeZone');
    const known = supported[0]!;
    const offered = offeredTimezones(known);
    expect(offered.filter((z) => z === known)).toHaveLength(1);
    expect(offered).toHaveLength(supported.length);
  });

  it('keeps the list sorted when it adds one', () => {
    const offered = offeredTimezones('Asia/Kolkata');
    const sorted = [...offered].sort((a, b) => a.localeCompare(b));
    expect(offered).toEqual(sorted);
  });

  /**
   * The invariant a `<select>` needs: a value with no matching option makes the
   * browser select the first one, and the next submit writes it.
   */
  it('never leaves the current value unselectable', () => {
    for (const zone of ['Asia/Kolkata', 'Asia/Calcutta', 'Europe/London', 'America/New_York']) {
      expect(offeredTimezones(zone), zone).toContain(zone);
    }
  });
});
