import { describe, it, expect } from 'vitest';
import { escalationFor, audienceFor, ESCALATION_STEPS } from './escalation-policy';

const target = new Date('2026-09-01T18:00:00Z');
const late = (minutes: number) => new Date(target.getTime() + minutes * 60_000);

const open = (escalationLevel = 0) => ({
  status: 'OPEN' as const,
  slaTargetAt: target,
  escalationLevel,
});

describe('escalationFor', () => {
  it('does nothing before the promise is up', () => {
    const decision = escalationFor(open(), late(-1));
    expect(decision).toEqual({ level: 0, shouldEscalate: false, minutesLate: 0 });
  });

  it('raises level 1 the moment it is late', () => {
    const decision = escalationFor(open(), late(0));
    expect(decision.level).toBe(1);
    expect(decision.shouldEscalate).toBe(true);
  });

  it('reaches the duty manager ten minutes past', () => {
    expect(escalationFor(open(), late(9)).level).toBe(1);
    expect(escalationFor(open(), late(10)).level).toBe(2);
    expect(audienceFor(2)).toEqual(['ASSIGNEE', 'DUTY_MANAGER']);
  });

  it('stops at three', () => {
    // Escalating continuously is noise a duty manager mutes, and a muted alert
    // is the failure this whole mechanism exists to prevent.
    expect(escalationFor(open(), late(30)).level).toBe(3);
    expect(escalationFor(open(), late(300)).level).toBe(3);
    expect(escalationFor(open(3), late(300)).shouldEscalate).toBe(false);
  });

  it('does not re-raise a level already raised', () => {
    expect(escalationFor(open(1), late(5)).shouldEscalate).toBe(false);
    expect(escalationFor(open(1), late(11)).shouldEscalate).toBe(true);
    expect(escalationFor(open(2), late(11)).shouldEscalate).toBe(false);
  });

  it('never goes back down', () => {
    // A corrected target can put a request back inside its promise. Somebody has
    // already been told; telling them it is fine now is worse than silence.
    const decision = escalationFor(
      { status: 'OPEN', slaTargetAt: new Date('2026-09-01T23:00:00Z'), escalationLevel: 2 },
      late(0),
    );
    expect(decision.level).toBe(2);
    expect(decision.shouldEscalate).toBe(false);
  });

  it('stops the clock when the work stops', () => {
    for (const status of ['COMPLETED', 'VERIFIED', 'CANCELLED', 'REJECTED'] as const) {
      const decision = escalationFor({ status, slaTargetAt: target, escalationLevel: 0 }, late(90));
      expect(decision.shouldEscalate, status).toBe(false);
      expect(decision.level, status).toBe(0);
    }
  });

  it('keeps escalating a request somebody is working on', () => {
    // DATA-MODEL §6 — a breach is not a status. Someone IS walking, and it is
    // still late.
    const decision = escalationFor(
      { status: 'IN_PROGRESS', slaTargetAt: target, escalationLevel: 0 },
      late(12),
    );
    expect(decision.level).toBe(2);
    expect(decision.shouldEscalate).toBe(true);
  });

  it('says nothing without a promise to miss', () => {
    expect(escalationFor(
      { status: 'OPEN', slaTargetAt: null, escalationLevel: 0 }, late(90),
    ).shouldEscalate).toBe(false);
  });

  it('measures lateness in wall-clock minutes, not multiples of the SLA', () => {
    // A guest ten minutes past a five-minute promise and ten minutes past a
    // forty-minute one are both ten minutes past.
    expect(escalationFor(open(), late(10)).minutesLate).toBe(10);
  });

  it('tells only the assignee at level one', () => {
    expect(audienceFor(1)).toEqual(['ASSIGNEE']);
    expect(audienceFor(0)).toEqual([]);
  });

  it('has thresholds in ascending order, which the loop relies on', () => {
    const minutes = ESCALATION_STEPS.map((s) => s.afterMinutesLate);
    expect([...minutes].sort((a, b) => a - b)).toEqual([...minutes]);
  });
});
