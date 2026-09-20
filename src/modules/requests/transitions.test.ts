import { describe, it, expect } from 'vitest';
import {
  canTransition, nextStatuses, isTerminal, reasonRequiredFor, slaState,
  REQUEST_STATUSES, OPEN_REQUEST_STATUSES, requestStateFor,
  REQUEST_OPEN_TO_A_GUEST, type RequestStatus,
} from './transitions';

describe('the request state machine', () => {
  it('walks the happy path', () => {
    expect(canTransition('OPEN', 'ASSIGNED')).toBe(true);
    expect(canTransition('ASSIGNED', 'IN_PROGRESS')).toBe(true);
    expect(canTransition('IN_PROGRESS', 'COMPLETED')).toBe(true);
    expect(canTransition('COMPLETED', 'VERIFIED')).toBe(true);
  });

  it('lets someone pick a request up and start walking in one tap', () => {
    // Forcing "assign to me" then "start" for one decision is how a board gets
    // ignored by the people it is for.
    expect(canTransition('OPEN', 'IN_PROGRESS')).toBe(true);
  });

  it('lets an assignee hand it back', () => {
    // Called away, wrong floor, already dealt with by someone else.
    expect(canTransition('ASSIGNED', 'OPEN')).toBe(true);
    // But not once they have started — that is a completion or a rejection.
    expect(canTransition('IN_PROGRESS', 'OPEN')).toBe(false);
  });

  it('allows a guest to cancel from every live state', () => {
    // A guest who found their own towels while a runner was on the stairs. This
    // is the common case, not a race to prevent.
    for (const from of OPEN_REQUEST_STATUSES) {
      expect(canTransition(from, 'CANCELLED'), from).toBe(true);
    }
  });

  it('does not reopen finished work', () => {
    for (const from of ['VERIFIED', 'REJECTED', 'CANCELLED'] as const) {
      expect(nextStatuses(from)).toEqual([]);
      expect(isTerminal(from)).toBe(true);
    }
    expect(canTransition('COMPLETED', 'IN_PROGRESS')).toBe(false);
    expect(canTransition('CANCELLED', 'OPEN')).toBe(false);
  });

  it('treats COMPLETED as done but not terminal — a supervisor may verify', () => {
    expect(isTerminal('COMPLETED')).toBe(false);
    expect(nextStatuses('COMPLETED')).toEqual(['VERIFIED']);
  });

  it('requires a reason for the two transitions a guest is told about', () => {
    expect(reasonRequiredFor('REJECTED')).toBe('rejection');
    expect(reasonRequiredFor('CANCELLED')).toBe('cancellation');
    expect(reasonRequiredFor('COMPLETED')).toBeNull();
  });

  it('has a defined flow for every status in the enum', () => {
    // A status added to the schema without a row here would throw on read.
    for (const status of REQUEST_STATUSES as readonly RequestStatus[]) {
      expect(Array.isArray(nextStatuses(status)), status).toBe(true);
    }
  });
});

describe('slaState', () => {
  const at = (iso: string) => new Date(iso);
  const target = at('2026-09-01T18:15:00Z');

  it('counts down while the work is live', () => {
    const state = slaState(
      { status: 'OPEN', slaTargetAt: target, completedAt: null },
      at('2026-09-01T18:10:00Z'),
    );
    expect(state.breached).toBe(false);
    expect(state.secondsRemaining).toBe(300);
  });

  it('breaches the second the target passes', () => {
    expect(slaState(
      { status: 'IN_PROGRESS', slaTargetAt: target, completedAt: null },
      at('2026-09-01T18:15:01Z'),
    ).breached).toBe(true);
  });

  it('is still breaching while someone is working on it', () => {
    // DATA-MODEL §6 — a breach is not a status. Someone IS walking, and the
    // duty manager needs both facts at once.
    const state = slaState(
      { status: 'IN_PROGRESS', slaTargetAt: target, completedAt: null },
      at('2026-09-01T18:40:00Z'),
    );
    expect(state.breached).toBe(true);
    expect(state.secondsRemaining).toBe(-1500);
  });

  it('stops the clock when the work stops, not when the board is read', () => {
    for (const status of ['COMPLETED', 'VERIFIED', 'CANCELLED', 'REJECTED'] as const) {
      const state = slaState(
        { status, slaTargetAt: target, completedAt: at('2026-09-01T18:12:00Z') },
        at('2026-09-02T09:00:00Z'),
      );
      expect(state.breached, status).toBe(false);
      expect(state.secondsRemaining, status).toBeNull();
    }
  });

  it('says nothing when there is no target', () => {
    expect(slaState({ status: 'OPEN', slaTargetAt: null, completedAt: null }, new Date()))
      .toEqual({ breached: false, secondsRemaining: null });
  });
});

/**
 * The guest-facing vocabulary, held to the machine.
 *
 * The activity list shows food and amenities side by side, so a status added to
 * REQUEST_STATUSES without a line here renders as nothing at somebody waiting
 * for towels. The ordering module's `track.test.ts` holds `orderStateFor` to
 * exactly the same standard, and for the same reason.
 */
describe('requestStateFor', () => {
  it('has a line for every status the machine can reach', () => {
    for (const status of REQUEST_STATUSES) {
      const state = requestStateFor(status);
      expect(state, `no state for ${status}`).toBeDefined();
      expect(state.label.length, `${status} has an empty label`).toBeGreaterThan(0);
    }
  });

  it('never shows a raw status name to a guest', () => {
    for (const status of REQUEST_STATUSES) {
      expect(requestStateFor(status).label, `${status} leaks the enum`)
        .not.toMatch(/[A-Z]{3,}|_/);
    }
  });

  it('reserves the stopped tone for requests that are not coming', () => {
    const stopped = REQUEST_STATUSES.filter((s) => requestStateFor(s).tone === 'stopped');
    expect([...stopped].sort()).toEqual(['CANCELLED', 'REJECTED']);
  });

  /**
   * The guest's "still coming" and the staff board's "not finished with" are
   * DIFFERENT questions that happen to share three statuses today.
   *
   * COMPLETED is the one that separates them: it stays on a staff board until
   * somebody verifies the work, because VERIFIED is a second signature from a
   * second person. From the guest's side the towels are in their hand, and a
   * screen still saying "on the way up" would be contradicting the towels.
   *
   * They are asserted apart so that a future change to the board's set cannot
   * silently drag the guest's with it.
   */
  it('separates what a guest is still waiting for from what a board is still holding', () => {
    expect([...REQUEST_OPEN_TO_A_GUEST].sort())
      .toEqual(['ASSIGNED', 'IN_PROGRESS', 'OPEN']);

    expect(requestStateFor('COMPLETED').tone, 'the towels arrived').toBe('done');
    expect(REQUEST_OPEN_TO_A_GUEST).not.toContain('COMPLETED' as RequestStatus);
    expect(OPEN_REQUEST_STATUSES).not.toContain('COMPLETED' as RequestStatus);
  });

  it('agrees with the machine about what is over', () => {
    for (const status of REQUEST_STATUSES) {
      // Anything terminal must not read as still coming.
      if (isTerminal(status)) {
        expect(requestStateFor(status).tone, `${status} is terminal`).not.toBe('open');
        expect(REQUEST_OPEN_TO_A_GUEST).not.toContain(status);
      }
    }
  });
});
