import { describe, it, expect } from 'vitest';
import {
  canTransition, nextStatuses, isTerminal, reasonRequiredFor, slaState,
  REQUEST_STATUSES, OPEN_REQUEST_STATUSES, type RequestStatus,
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
