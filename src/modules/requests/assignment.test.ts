import { describe, it, expect } from 'vitest';
import { pickAssignee } from './assignment';
import type { OnDutyStaff } from '@/modules/housekeeping';

/**
 * The ranking, on its own.
 *
 * The database part of routing (who is on shift, who covers the floor) is proven
 * in tests/integration/routing.test.ts. This is the rule itself: given the
 * people who qualify and what they are already carrying, who gets it.
 *
 * It lives in `assignment.ts` rather than `routing.ts` so this file does not
 * need a DATABASE_URL to run — importing the queries would drag the pool in.
 */
const person = (fullName: string, staffUserId = fullName.toLowerCase()): OnDutyStaff => ({
  staffUserId,
  fullName,
  roleKeys: ['HOUSEKEEPING'],
  clockedInAt: new Date('2026-09-01T09:00:00Z'),
});

describe('pickAssignee', () => {
  it('gives it to whoever is carrying least', () => {
    const chosen = pickAssignee(
      [person('Sunita'), person('Ravi'), person('Meera')],
      new Map([['sunita', 3], ['ravi', 1], ['meera', 2]]),
    );
    // Otherwise the first name alphabetically does every job on a busy evening.
    expect(chosen?.fullName).toBe('Ravi');
  });

  it('treats an absent count as nothing carried', () => {
    const chosen = pickAssignee(
      [person('Sunita'), person('Ravi')],
      new Map([['sunita', 2]]),
    );
    expect(chosen?.fullName).toBe('Ravi');
  });

  it('breaks a tie on the name, not on who clocked in first', () => {
    // "Longest on duty" would hand the busiest evening to whoever arrived
    // earliest. Alphabetical is at least explainable to the person picked.
    const early = { ...person('Sunita'), clockedInAt: new Date('2026-09-01T06:00:00Z') };
    const late = { ...person('Ravi'), clockedInAt: new Date('2026-09-01T14:00:00Z') };

    expect(pickAssignee([early, late], new Map())?.fullName).toBe('Ravi');
    // And the order the candidates arrive in does not change the answer.
    expect(pickAssignee([late, early], new Map())?.fullName).toBe('Ravi');
  });

  it('is stable — the same input picks the same person', () => {
    const candidates = [person('Ravi'), person('Sunita'), person('Meera')];
    const counts = new Map([['ravi', 2], ['sunita', 2], ['meera', 2]]);
    const first = pickAssignee(candidates, counts);
    for (let i = 0; i < 5; i += 1) {
      expect(pickAssignee(candidates, counts)?.staffUserId).toBe(first?.staffUserId);
    }
  });

  it('returns null when nobody qualifies', () => {
    // The caller leaves the request OPEN and records why — a request routed to
    // nobody must not look handled.
    expect(pickAssignee([], new Map())).toBeNull();
  });

  it('does not mutate the candidates it was given', () => {
    const candidates = [person('Sunita'), person('Ravi')];
    const order = candidates.map((c) => c.fullName);
    pickAssignee(candidates, new Map([['sunita', 5]]));
    expect(candidates.map((c) => c.fullName)).toEqual(order);
  });
});
