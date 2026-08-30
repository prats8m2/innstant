import { describe, expect, it } from 'vitest';
import {
  ORDER_STATUSES, canTransition, nextStatuses, isTerminal,
  reasonRequiredFor, KITCHEN_OPEN_STATUSES, STATUS_TIMESTAMP,
  type OrderStatus,
} from './transitions';

/**
 * Every transition in the machine gets a test (CLAUDE.md "Tests"). These are
 * cheap and they are the difference between a state machine and a set of
 * strings that mostly behave.
 */
describe('order state machine', () => {
  it('walks the happy path a dish actually takes', () => {
    const path: OrderStatus[] = [
      'PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CLOSED',
    ];
    for (let i = 0; i < path.length - 1; i += 1) {
      expect(canTransition(path[i]!, path[i + 1]!), `${path[i]} → ${path[i + 1]}`).toBe(true);
    }
  });

  it('lets a runner skip the trip for a tray collected at the pass', () => {
    // READY → DELIVERED without OUT_FOR_DELIVERY: the guest came to get it, or
    // the kitchen is on the same floor. Real, and not worth a fake leg.
    expect(canTransition('READY', 'DELIVERED')).toBe(true);
  });

  it('never goes backwards', () => {
    expect(canTransition('PREPARING', 'ACCEPTED')).toBe(false);
    expect(canTransition('READY', 'PREPARING')).toBe(false);
    expect(canTransition('DELIVERED', 'READY')).toBe(false);
  });

  it('lets the kitchen reject before it commits, and not after', () => {
    // A kitchen that cannot say "we are out of sole" accepts and then fails
    // silently, which is worse for the guest.
    expect(canTransition('PLACED', 'REJECTED')).toBe(true);
    expect(canTransition('ACCEPTED', 'REJECTED')).toBe(true);
    // Once a pan is on, this is a conversation, not a tap.
    expect(canTransition('PREPARING', 'REJECTED')).toBe(false);
  });

  it('stops cancelling once the food is cooked', () => {
    expect(canTransition('PLACED', 'CANCELLED')).toBe(true);
    expect(canTransition('PREPARING', 'CANCELLED')).toBe(true);
    expect(canTransition('READY', 'CANCELLED')).toBe(false);
    expect(canTransition('DELIVERED', 'CANCELLED')).toBe(false);
  });

  it('treats a dispute as being about the money, not the food', () => {
    expect(canTransition('DELIVERED', 'DISPUTED')).toBe(true);
    expect(canTransition('CLOSED', 'DISPUTED')).toBe(true);
    // Nothing has been charged that could be disputed yet.
    expect(canTransition('PLACED', 'DISPUTED')).toBe(false);
  });

  it('leaves rejected and cancelled with nowhere to go', () => {
    expect(nextStatuses('REJECTED')).toEqual([]);
    expect(nextStatuses('CANCELLED')).toEqual([]);
    expect(isTerminal('REJECTED')).toBe(true);
    expect(isTerminal('CANCELLED')).toBe(true);
    expect(isTerminal('CLOSED')).toBe(true);
    expect(isTerminal('READY')).toBe(false);
  });

  it('demands a reason for the two transitions a guest will ask about', () => {
    expect(reasonRequiredFor('REJECTED')).toBe('rejection');
    expect(reasonRequiredFor('CANCELLED')).toBe('cancellation');
    expect(reasonRequiredFor('READY')).toBeNull();
  });

  it('declares every status, with no orphans', () => {
    // A status in the enum with no entry in the table would throw at runtime
    // the first time an order reached it.
    for (const status of ORDER_STATUSES) {
      expect(() => nextStatuses(status), status).not.toThrow();
    }
  });

  it('shows the kitchen only what it can still act on', () => {
    expect(KITCHEN_OPEN_STATUSES).toEqual(['PLACED', 'ACCEPTED', 'PREPARING', 'READY']);
    for (const status of KITCHEN_OPEN_STATUSES) {
      expect(isTerminal(status), status).toBe(false);
    }
  });

  it('stamps a column for every status a human waits on', () => {
    for (const status of ['PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'DELIVERED'] as const) {
      expect(STATUS_TIMESTAMP[status], status).toBeTruthy();
    }
    // Redundant with event_log by design (DATA-MODEL §6) — but only for the
    // states an SLA is measured against.
    expect(STATUS_TIMESTAMP.REJECTED).toBeUndefined();
  });
});
