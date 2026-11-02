import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { withTenant } from '@/db';
import { resolveStaySession, GUEST_SESSION_COOKIE } from '@/modules/access';
import { findProperty } from '@/modules/identity';
import {
  getRequestCatalog, countRequestsByType, shortlistForChips, getRequestsForStay,
  CALL_SERVICE_KEY, REQUEST_OPEN_TO_A_GUEST,
} from '@/modules/requests';
import { localTimeAt, formatClock, toClock } from '@/lib/clock';
import { AmenityForm } from './amenity-form';
import styles from './amenities.module.css';

/**
 * Amenities — everything a guest can ask for that is not food.
 *
 * Direction A (D-100), `design/reference/direction-a/GuestAmenities.dc.html`:
 * a back arrow, the question, a strip for whatever is already on its way, the
 * list in hairline rows with a stepper on each, and one pinned button.
 *
 * Free and chargeable in ONE list: "free unless it shows a price". Splitting
 * them would make asking for a towel feel like shopping.
 *
 * CLAUDE.md #9 — this whole screen renders for an anonymous REQUEST-tier
 * session. The one prompt appears only if the guest picks something that costs.
 */
export const dynamic = 'force-dynamic';

export default async function AmenitiesScreen({
  params,
}: {
  params: Promise<{ qrCode: string }>;
}) {
  const { qrCode } = await params;
  const store = await cookies();
  const session = await resolveStaySession(store.get(GUEST_SESSION_COOKIE)?.value);

  if (!session) redirect(`/r/${encodeURIComponent(qrCode)}`);

  const base = `/r/${encodeURIComponent(qrCode)}`;

  const { catalog, shortlist, live, timeZone } = await withTenant(
    { tenantId: session.tenantId, propertyId: session.propertyId },
    async (tx) => {
      /**
       * Everything except the one-tap call. All four categories, including
       * SERVICE: laundry and the airport transfer are SERVICE rows, and they
       * belong here. `CALL_SERVICE` has a screen of its own.
       */
      const all = await getRequestCatalog(tx, { propertyId: session.propertyId });
      const cards = all.filter((card) => card.key !== CALL_SERVICE_KEY);

      /** What this property's guests actually ask for (D-071) — counted, not configured. */
      const demand = await countRequestsByType(tx, { propertyId: session.propertyId });

      /**
       * What this room already has on its way — the board's "Ice bucket is on
       * the way" strip. The same read the room home makes.
       */
      const asked = await getRequestsForStay(tx, { stayId: session.stayId });
      const property = await findProperty(tx, session.propertyId);

      return {
        catalog: cards,
        shortlist: shortlistForChips(cards, demand),
        live: asked.filter((request) => REQUEST_OPEN_TO_A_GUEST.includes(request.status)),
        timeZone: property?.timezone ?? 'Asia/Kolkata',
      };
    },
  );

  // One key per render, so both taps of a double-tap carry the same one (#8).
  const idempotencyKey = crypto.randomUUID();

  const now = new Date();
  const clockAt = (instant: Date) => formatClock(toClock(localTimeAt(instant, timeZone).minutes));

  /**
   * The strip. With one request moving it opens that request; with several,
   * "Your requests". The second line is only what the row knows: who has it
   * (a name only when routing has assigned one — never an invented person),
   * and the SLA target while it is still ahead.
   */
  const strip = (() => {
    if (!live.length) return null;
    if (live.length > 1) {
      return {
        href: `${base}/activity`,
        label: `${live.length} requests on their way`,
        detail: live.flatMap((request) => request.lines.map((line) => line.label)).join(' · '),
      };
    }
    const request = live[0]!;
    const what = request.lines.map((line) => line.label).join(' · ');
    const by = request.slaTargetAt && request.slaTargetAt > now
      ? `by ${clockAt(request.slaTargetAt)}`
      : null;
    return request.status === 'OPEN'
      ? {
        href: `${base}/service/${request.id}`,
        label: `${what} — asked for`,
        detail: by ? `Usually here ${by}` : 'Someone is coming up',
      }
      : {
        href: `${base}/service/${request.id}`,
        label: `${what} is on the way`,
        detail: [request.assignedStaffName, by].filter(Boolean).join(' · ') || 'Someone is on the way',
      };
  })();

  return (
    <main className={styles.shell}>
      <header className={styles.bar}>
        <Link href={`${base}/home`} className={styles.back} aria-label="Back to room home">
          <ChevronLeft size={22} strokeWidth={1.5} aria-hidden="true" />
        </Link>
      </header>

      <div className={styles.intro}>
        <h1 className={styles.title}>What can we bring?</h1>
        <p className={styles.lede}>Free, unless it shows a price.</p>
      </div>

      {strip ? (
        <Link href={strip.href} className={styles.strip}>
          <Check className={styles.stripIcon} size={20} strokeWidth={1.75} aria-hidden="true" />
          <span className={styles.stripBody}>
            <span className={styles.stripLabel}>{strip.label}</span>
            <span className={styles.stripDetail}>{strip.detail}</span>
          </span>
          <ChevronRight className={styles.stripChevron} size={18} strokeWidth={1.5} aria-hidden="true" />
        </Link>
      ) : null}

      {catalog.length ? (
        <AmenityForm
          qrCode={qrCode}
          idempotencyKey={idempotencyKey}
          catalog={catalog}
          shortlistIds={shortlist.map((card) => card.id)}
          roomNumber={session.roomNumber}
        />
      ) : (
        <p className={styles.empty}>
          Nothing is set up to request here yet. The front desk can help.
        </p>
      )}
    </main>
  );
}
