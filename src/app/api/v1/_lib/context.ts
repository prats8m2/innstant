import { withTenant, type Tx } from '@/db';
import {
  getOutletConfig, getOutletHours, outletOpenState, describeOpenState,
} from '@/modules/catalog';
import { findProperty } from '@/modules/identity';
import { localTimeAt, formatClock, type LocalTime } from '@/lib/clock';
import { NotFoundError } from '@/lib/errors';
import type { VisitGuestSession } from '@/modules/access';
import type { OutletMenu } from '@/modules/catalog';
import { apiOutlet } from './serialise';
import type { ApiOutlet, ApiProperty } from '@/lib/api-contract';

/**
 * What nearly every `/api/v1` handler needs before it can answer. D-080.
 *
 * The property (for its clock), the outlet the link points at, and the
 * property-local time — because a dish's schedule, a collection's window and
 * the kitchen's own hours are all property-local, never the server's
 * (CLAUDE.md "Dates"). A handler that forgot to read the timezone would serve
 * a breakfast menu at dinner to somebody in Udaipur because the container runs
 * in Amsterdam.
 *
 * One transaction, because these are three reads a single screen needs
 * together and the open line has to agree with the menu beneath it.
 */
export interface VisitContext {
  propertyId: string;
  tenantId: string;
  outletId: string;
  outlet: OutletMenu['outlet'];
  apiOutlet: ApiOutlet;
  apiProperty: ApiProperty;
  timeZone: string;
  at: LocalTime;
}

export async function loadVisitContext(
  tx: Tx,
  session: VisitGuestSession,
): Promise<VisitContext> {
  const property = await findProperty(tx, session.propertyId);
  const timeZone = property?.timezone ?? 'Asia/Kolkata';
  const at = localTimeAt(new Date(), timeZone);

  const outlet = await getOutletConfig(tx, {
    propertyId: session.propertyId,
    outletId: session.outletId,
  });
  // The link points at an outlet that has since been archived. A configuration
  // state rather than a failure, and the app has a screen for it — but there is
  // nothing to serve.
  if (!outlet) throw new NotFoundError('This menu is no longer being served.');

  const state = outletOpenState(await getOutletHours(tx, outlet.id), at);

  return {
    propertyId: session.propertyId,
    tenantId: session.tenantId,
    outletId: outlet.id,
    outlet,
    apiOutlet: apiOutlet(outlet, {
      // The same sentence the web menu shows, from the same function — "Open
      // until 11:30pm" is worked out in one place or it is worked out twice.
      line: outlet.isAcceptingOrders
        ? describeOpenState(state, formatClock)
        : 'The kitchen has stopped taking orders',
      // `isAcceptingOrders` is the manual switch a manager throws mid-service
      // and it WINS: a kitchen that has stopped is stopped whatever the
      // schedule says.
      isOpen: state.isOpen && outlet.isAcceptingOrders,
      /*
        The clock time a closed screen can print on its own — "Ordering opens
        noon". Three conditions, all of them about not claiming an hour the
        kitchen never promised: shut by the SCHEDULE (not by a manager's
        switch, which has no reopening time attached), with a next window, and
        that window TODAY — because "opens 7am" under a Tuesday evening is a
        sentence about Wednesday wearing a clock time's clothes. Everything
        else is already said in full by `openLine` above.
      */
      opensAt: !state.isOpen && outlet.isAcceptingOrders && state.nextOpen?.today
        ? formatClock(state.nextOpen.opensAt)
        : null,
    }),
    apiProperty: {
      id: session.propertyId,
      name: property?.name ?? 'This property',
      city: property?.city ?? null,
      timezone: timeZone,
    },
    timeZone,
    at,
  };
}

/** The same, opening its own transaction — for handlers that need nothing else. */
export async function withVisitContext<T>(
  session: VisitGuestSession,
  fn: (tx: Tx, ctx: VisitContext) => Promise<T>,
): Promise<T> {
  return withTenant(
    { tenantId: session.tenantId, propertyId: session.propertyId },
    async (tx) => fn(tx, await loadVisitContext(tx, session)),
  );
}
