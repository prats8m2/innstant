import { describe, it, expect } from 'vitest';
import { renderNotification } from './templates';

/**
 * A row is a template name and a payload. These are the sentences it becomes.
 *
 * Worth its own file because the wording is the product here: an alert nobody
 * reads is the same as an alert nobody sent, and "SLA breach on SR-0042" is an
 * alert nobody reads.
 */
describe('rendering a notification', () => {
  const escalated = (payload: Record<string, unknown>) =>
    renderNotification({ template: 'service_request.escalated', payload });

  it('leads with the number and how late it is', () => {
    const { title } = escalated({ requestNumber: 'SR-0042', level: 1, minutesLate: 12 });
    expect(title).toBe('SR-0042 is 12 minutes late');
  });

  it('says one minute, not 1 minutes', () => {
    expect(escalated({ requestNumber: 'SR-1', level: 1, minutesLate: 1 }).title)
      .toBe('SR-1 is 1 minute late');
  });

  it('tells each level a different thing to do', () => {
    const bodies = [1, 2, 3].map((level) =>
      escalated({ requestNumber: 'SR-1', level, minutesLate: 10 }).body);
    expect(new Set(bodies).size).toBe(3);
    // Level 1 is the assignee's own job; level 3 is the manager's.
    expect(bodies[0]).toMatch(/assigned to you/i);
    expect(bodies[2]).toMatch(/yourself/i);
  });

  it('never apologises and is never vague', () => {
    for (const level of [1, 2, 3]) {
      const { body } = escalated({ requestNumber: 'SR-1', level, minutesLate: 10 });
      expect(body).not.toMatch(/sorry|apolog|unfortunately|something went wrong/i);
      expect(body.length).toBeGreaterThan(20);
    }
  });

  it('sends the reader to the board, which is where the work is', () => {
    expect(escalated({ requestNumber: 'SR-1', level: 2, minutesLate: 10 }).href)
      .toBe('/housekeeping');
  });

  /**
   * A payload from an older deploy, or one a bug wrote half of. The bell must
   * still render something a person can act on — silence is the failure the
   * whole table exists to prevent.
   */
  it('survives a payload with nothing in it', () => {
    const rendered = escalated({});
    expect(rendered.title).toContain('A request');
    expect(rendered.body).toBe(
      'It is assigned to you. Go now, or hand it back so somebody else can take it.',
    );
  });

  it('falls back to level 1 wording for a level it does not know', () => {
    expect(escalated({ requestNumber: 'SR-1', level: 9, minutesLate: 4 }).body)
      .toMatch(/assigned to you/i);
  });

  it('shows an unknown template rather than a blank card', () => {
    const rendered = renderNotification({ template: 'order.ready', payload: {} });
    expect(rendered.title).not.toBe('');
    expect(rendered.body).toContain('order.ready');
    expect(rendered.href).toBeNull();
  });

  it('does not go negative on a clock that moved backwards', () => {
    expect(escalated({ requestNumber: 'SR-1', level: 1, minutesLate: -3 }).title)
      .toBe('SR-1 is 0 minutes late');
  });
});
