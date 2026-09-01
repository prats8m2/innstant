import { describe, it, expect } from 'vitest';
import { outboxBackoffSeconds, OUTBOX_MAX_ATTEMPTS } from './outbox';

/**
 * How long to wait before telling a PMS again.
 *
 * Pure, so the schedule is a table somebody can read rather than a guess buried
 * in a worker. The shape is the product decision: a PMS down for a minute must
 * not delay a checkout by an hour, and one down for the afternoon must not be
 * hammered until it comes back.
 */
describe('the outbox retry schedule', () => {
  it('starts within half a minute', () => {
    expect(outboxBackoffSeconds(1)).toBe(30);
  });

  it('doubles', () => {
    expect(outboxBackoffSeconds(2)).toBe(60);
    expect(outboxBackoffSeconds(3)).toBe(120);
    expect(outboxBackoffSeconds(4)).toBe(240);
  });

  /** Otherwise attempt ten waits a fortnight and the queue looks stuck. */
  it('stops doubling at four hours', () => {
    expect(outboxBackoffSeconds(20)).toBe(4 * 60 * 60);
    expect(outboxBackoffSeconds(OUTBOX_MAX_ATTEMPTS)).toBeLessThanOrEqual(4 * 60 * 60);
  });

  it('never returns a negative or a zero wait', () => {
    for (const attempts of [-5, 0, 1]) {
      expect(outboxBackoffSeconds(attempts)).toBeGreaterThan(0);
    }
  });

  /**
   * Ten attempts on this curve is roughly a day. Past that a row is FAILED and
   * somebody has to look: a queue that retries for ever hides the outage that
   * caused it.
   */
  it('gives up inside a day', () => {
    let total = 0;
    for (let attempt = 1; attempt <= OUTBOX_MAX_ATTEMPTS; attempt += 1) {
      total += outboxBackoffSeconds(attempt);
    }
    expect(total).toBeGreaterThan(6 * 60 * 60);
    expect(total).toBeLessThan(36 * 60 * 60);
  });
});
