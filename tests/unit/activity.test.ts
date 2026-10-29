import { describe, it, expect } from 'vitest';
import { describeActivity } from '@/lib/activity';

describe('describeActivity', () => {
  it('names the order or request a transition was about', () => {
    expect(describeActivity('order.accepted', { orderNumber: 'KE-1185' }))
      .toEqual({ text: 'Accepted order KE-1185', kind: 'order' });
    expect(describeActivity('order.out_for_delivery', { orderNumber: 'KE-1185' })?.text)
      .toBe('Took up order KE-1185');
    expect(describeActivity('service_request.completed', { requestNumber: 'RQ-0042' })?.text)
      .toBe('Finished request RQ-0042');
  });

  it('says which dish was 86’d and put back', () => {
    expect(describeActivity('menu_item.unavailable', { name: 'Laal maas' })?.text)
      .toBe('Took Laal maas off the menu');
    expect(describeActivity('menu_item.available', { name: 'Laal maas' })?.text)
      .toBe('Put Laal maas back on the menu');
  });

  it('tells a manager’s clock-out apart from somebody’s own', () => {
    expect(describeActivity('shift.clocked_out', {})?.text).toBe('Clocked out');
    expect(describeActivity('shift.clocked_out', { byManager: true })?.text).toBe('Clocked somebody else out');
  });

  it('drops what it cannot say plainly rather than showing an event name', () => {
    expect(describeActivity('guest_session.issued', {})).toBeNull();
    expect(describeActivity('something.new', {})).toBeNull();
  });
});
