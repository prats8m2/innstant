/**
 * One line of somebody's recent work, in words (D-088): "Accepted order
 * KE-1185", "Closed request RQ-0042", "Took Laal maas off the menu".
 *
 * Pure, so it is tested without a database. Returns null for an event that
 * means nothing to a manager reading a colleague's day — those are dropped
 * rather than shown as raw event names.
 */
export interface ActivityLine {
  /** The sentence. */
  text: string;
  /** What kind of work, for the icon and the filter. */
  kind: 'order' | 'request' | 'menu' | 'stay' | 'staff' | 'shift' | 'setup';
}

const ORDER_VERBS: Record<string, string> = {
  accepted: 'Accepted', preparing: 'Started cooking', ready: 'Marked ready',
  out_for_delivery: 'Took up', delivered: 'Handed over', rejected: 'Rejected',
  cancelled: 'Cancelled', placed: 'Placed',
};

const REQUEST_VERBS: Record<string, string> = {
  acknowledged: 'Picked up', in_progress: 'Started', completed: 'Finished',
  verified: 'Checked', cancelled: 'Cancelled', assigned: 'Assigned',
};

const PLAIN: Record<string, ActivityLine> = {
  'stay.created': { text: 'Checked a guest in', kind: 'stay' },
  'stay.checked_out': { text: 'Checked a guest out', kind: 'stay' },
  'folio.settled': { text: 'Settled a folio', kind: 'stay' },
  'folio.payment_taken': { text: 'Took a payment', kind: 'stay' },
  'guest_session.vouched': { text: 'Vouched for a guest at the desk', kind: 'stay' },
  'shift.clocked_in': { text: 'Clocked in', kind: 'shift' },
  'shift.zones_changed': { text: 'Changed the floors they cover', kind: 'shift' },
  'menu.arranged': { text: 'Rearranged the menu', kind: 'menu' },
  'property.updated': { text: 'Changed the hotel’s settings', kind: 'setup' },
  'property.branding_updated': { text: 'Changed the branding', kind: 'setup' },
  'property.guest_info_updated': { text: 'Changed the guest info', kind: 'setup' },
  'outlet.hours_updated': { text: 'Changed the kitchen’s hours', kind: 'setup' },
  'outlet.settings_updated': { text: 'Changed what the kitchen charges', kind: 'setup' },
  'staff.invite_accepted': { text: 'Set their password', kind: 'staff' },
};

export function describeActivity(
  eventType: string,
  payload: Record<string, unknown>,
): ActivityLine | null {
  const [entity, verb] = splitOnce(eventType);
  const str = (key: string) => (typeof payload[key] === 'string' ? (payload[key] as string) : null);

  if (entity === 'order' && verb && ORDER_VERBS[verb]) {
    const number = str('orderNumber');
    return { text: `${ORDER_VERBS[verb]} order${number ? ` ${number}` : ''}`, kind: 'order' };
  }
  if (entity === 'service_request' && verb && REQUEST_VERBS[verb]) {
    const number = str('requestNumber');
    return { text: `${REQUEST_VERBS[verb]} request${number ? ` ${number}` : ''}`, kind: 'request' };
  }
  if (eventType === 'shift.clocked_out') {
    return {
      text: payload.byManager ? 'Clocked somebody else out' : 'Clocked out',
      kind: 'shift',
    };
  }
  if (entity === 'menu_item' || entity === 'menu_category' || entity === 'collection'
      || entity === 'menu_offer' || entity === 'modifier_group' || entity === 'modifier_option') {
    const name = str('name');
    // The 86 switch, from the kitchen display or the menu board.
    if (eventType === 'menu_item.unavailable') {
      return { text: `Took ${name ?? 'a dish'} off the menu`, kind: 'menu' };
    }
    if (eventType === 'menu_item.available') {
      return { text: `Put ${name ?? 'a dish'} back on the menu`, kind: 'menu' };
    }
    const what = entity === 'menu_item' ? 'a dish' : entity === 'menu_category' ? 'a section'
      : entity === 'collection' ? 'a collection' : entity === 'menu_offer' ? 'an offer' : 'an option';
    const did = verb === 'created' ? 'Added' : verb === 'archived' ? 'Removed'
      : verb === 'repriced' ? 'Repriced' : 'Edited';
    return { text: `${did} ${name ?? what}`, kind: 'menu' };
  }
  if (entity === 'staff' && verb) {
    const words: Record<string, string> = {
      updated: 'Edited a colleague’s details', role_granted: 'Gave somebody a role',
      role_revoked: 'Took a role away', deactivated: 'Switched somebody off',
      reactivated: 'Switched somebody back on', invite_reissued: 'Sent a sign-in link',
      invited: 'Invited somebody',
    };
    if (words[verb]) return { text: words[verb]!, kind: 'staff' };
  }
  if (['room', 'room_type', 'floor', 'qr'].includes(entity) && verb) {
    const what = entity === 'room_type' ? 'a room type' : entity === 'qr' ? 'a QR sticker' : `a ${entity}`;
    const did = verb === 'created' ? 'Added' : verb === 'archived' ? 'Took out of service'
      : verb === 'restored' ? 'Restored' : verb === 'deleted' ? 'Removed'
      : verb === 'regenerated' ? 'Reprinted' : 'Edited';
    return { text: `${did} ${what}`, kind: 'setup' };
  }
  return PLAIN[eventType] ?? null;
}

function splitOnce(value: string): [string, string | undefined] {
  const at = value.indexOf('.');
  return at < 0 ? [value, undefined] : [value.slice(0, at), value.slice(at + 1)];
}
