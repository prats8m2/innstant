import { describe, it, expect } from 'vitest';
// The pure module directly, not the barrel: `@/modules/ordering` re-exports the
// query layer, which opens the pool on import and would need a DATABASE_URL to
// test two pure functions.
import {
  toKitchenTicket, byRunnerPriority, type KitchenTicket,
} from '@/modules/ordering/kitchen-ticket';

/**
 * The runner queue crashed in production with
 *
 *   TypeError: (a.readyAt ?? a.placedAt ?? …).getTime is not a function
 *
 * because `kitchenTickets()` passed the driver's raw `timestamptz` straight
 * through, behind a `tx.execute<{ placed_at: Date }>` generic that ASSERTS
 * rather than parses. The value was a string; the type said Date; nothing in
 * typecheck, lint or the build could see the difference.
 *
 * It hid for so long because `Array.sort` does not call a comparator on a list
 * shorter than two. A property with one tray moving worked perfectly — in dev,
 * in every screenshot, and in the e2e suite, which moves one order at a time.
 *
 * So these tests feed the mapper the shape a driver really returns, and the
 * comparator two tickets rather than one.
 */

/** The row shape `kitchenTickets` selects, with timestamps as the wire sends them. */
function row(over: Partial<Parameters<typeof toKitchenTicket>[0]> = {}) {
  return {
    id: 'ord-1',
    order_number: 'KE-1182',
    status: 'READY' as const,
    destination_label: 'Room 214',
    fulfilment: 'IN_ROOM' as const,
    room_number: '214' as string | null,
    placed_at: '2026-09-19T11:00:00.000Z',
    promised_by_at: '2026-09-19T11:35:00.000Z',
    ready_at: '2026-09-19T11:20:00.000Z',
    assigned_runner_id: null,
    guest_notes: null,
    dietary_flags: null,
    lines: null,
    ...over,
  };
}

describe('toKitchenTicket', () => {
  it('turns the driver’s strings into real Dates', () => {
    const ticket = toKitchenTicket(row());

    for (const field of ['placedAt', 'promisedByAt', 'readyAt'] as const) {
      expect(ticket[field], `${field} must be a Date`).toBeInstanceOf(Date);
    }
    expect(ticket.readyAt!.toISOString()).toBe('2026-09-19T11:20:00.000Z');
  });

  it('leaves a Date alone when the driver already gave one', () => {
    const already = new Date('2026-09-19T11:20:00.000Z');
    const ticket = toKitchenTicket(row({ ready_at: already }));

    expect(ticket.readyAt).toBeInstanceOf(Date);
    expect(ticket.readyAt!.getTime()).toBe(already.getTime());
  });

  /**
   * `new Date(null)` is the epoch. A ticket that never stamped a time would
   * read as 1 January 1970 on a kitchen display, which is worse than blank —
   * the age badge would show it as forty years late and colour it accordingly.
   */
  it('keeps null as null rather than turning it into 1970', () => {
    const ticket = toKitchenTicket(row({ ready_at: null, promised_by_at: null }));

    expect(ticket.readyAt).toBeNull();
    expect(ticket.promisedByAt).toBeNull();
  });

  it('survives a row with no lines and no dietary flags', () => {
    const ticket = toKitchenTicket(row({ lines: null, dietary_flags: null }));

    expect(ticket.lines).toEqual([]);
    expect(ticket.dietaryFlags).toEqual([]);
  });
});

describe('byRunnerPriority', () => {
  const ticket = (over: Partial<KitchenTicket>): KitchenTicket =>
    ({ ...toKitchenTicket(row()), ...over });

  /** The exact call that threw: two tickets, mapped from the wire, sorted. */
  it('sorts a queue built from raw rows without throwing', () => {
    const queue = [
      toKitchenTicket(row({ id: 'a', ready_at: '2026-09-19T11:20:00.000Z' })),
      toKitchenTicket(row({ id: 'b', ready_at: '2026-09-19T11:05:00.000Z' })),
    ];

    expect(() => queue.sort(byRunnerPriority)).not.toThrow();
    // Longest on the pass first — that is the tray going cold.
    expect(queue.map((t) => t.id)).toEqual(['b', 'a']);
  });

  it('puts trays still waiting ahead of trays already being carried', () => {
    const carried = ticket({
      id: 'carried', status: 'OUT_FOR_DELIVERY',
      readyAt: new Date('2026-09-19T10:00:00.000Z'),
    });
    const waiting = ticket({
      id: 'waiting', status: 'READY',
      readyAt: new Date('2026-09-19T11:50:00.000Z'),
    });

    // Even though the carried one has been out far longer.
    expect([carried, waiting].sort(byRunnerPriority).map((t) => t.id))
      .toEqual(['waiting', 'carried']);
  });

  it('falls back to placedAt when a row never stamped ready_at', () => {
    const stamped = ticket({
      id: 'stamped', readyAt: new Date('2026-09-19T11:30:00.000Z'),
    });
    const unstamped = ticket({
      id: 'unstamped', readyAt: null, placedAt: new Date('2026-09-19T11:00:00.000Z'),
    });

    expect([stamped, unstamped].sort(byRunnerPriority).map((t) => t.id))
      .toEqual(['unstamped', 'stamped']);
  });
});
