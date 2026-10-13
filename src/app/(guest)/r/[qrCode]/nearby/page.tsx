import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { withTenant } from '@/db';
import { resolveStaySession, GUEST_SESSION_COOKIE } from '@/modules/access';
import { findProperty } from '@/modules/identity';
import { listPlacesForProperty, planDay, describeTrip } from '@/modules/concierge';
import { localTimeAt } from '@/lib/clock';
import styles from './nearby.module.css';

/**
 * Plan my day.
 *
 * ─── What this is, and what it is not ──────────────────────────────────────
 *
 * It is the hotel's own list of the city, ordered into a day and opened at the
 * part of it the guest is standing in. Every place, every note and every
 * walking time comes out of `pois` through the same tenant-scoped read as
 * anything else on this screen — none of it is written into the page.
 *
 * It is NOT the finished concierge. P4 is unbuilt: there is no admin screen
 * for adding a place, the walking times are the GM's estimate rather than a
 * nightly refresh from a maps API, and a guest cannot yet keep a day of their
 * own — which is what `itineraries` and `itinerary_stops` are for. The screen
 * says all three out loud at the bottom instead of letting a visitor discover
 * it by tapping something that does nothing (D-069).
 *
 * ─── Not gated ─────────────────────────────────────────────────────────────
 *
 * CLAUDE.md #9, and `view_pois` is BROWSE — the lowest tier there is. Reading
 * where to get a coffee costs the hotel nothing, so it sits behind nothing.
 */
export const dynamic = 'force-dynamic';

export default async function NearbyScreen({
  params,
}: {
  params: Promise<{ qrCode: string }>;
}) {
  const { qrCode } = await params;
  const store = await cookies();
  const session = await resolveStaySession(store.get(GUEST_SESSION_COOKIE)?.value);

  if (!session) redirect(`/r/${encodeURIComponent(qrCode)}`);

  const base = `/r/${encodeURIComponent(qrCode)}`;

  const { property, places } = await withTenant(
    { tenantId: session.tenantId, propertyId: session.propertyId },
    async (tx) => ({
      property: await findProperty(tx, session.propertyId),
      places: await listPlacesForProperty(tx, { propertyId: session.propertyId }),
    }),
  );

  // The property's clock, never the server's — CLAUDE.md "Dates".
  const timeZone = property?.timezone ?? 'Asia/Kolkata';
  const hour = localTimeAt(new Date(), timeZone).minutes / 60;
  const sections = planDay(places, hour);

  return (
    <main className={styles.shell}>
      <header className={styles.bar}>
        <Link href={`${base}/home`} className={styles.back} aria-label="Back to room home">
          ←
        </Link>
        <h1 className={styles.barTitle}>Plan my day</h1>
      </header>

      {sections.length === 0 ? (
        /* A property whose GM has not filled this in. Says so plainly rather
           than showing an empty page that reads as broken. */
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>Nothing here yet</p>
          <p className={styles.emptyBody}>
            {property?.name ?? 'The hotel'} hasn’t added their list of the city
            yet. Ask at the desk — they will know where to send you.
          </p>
          <Link href={`${base}/service`} className={styles.emptyCta}>Message the desk</Link>
        </div>
      ) : (
        <>
          <p className={styles.lede}>
            Where we send our own friends, in the order the day happens.
            Walking times are from the front door.
          </p>

          {sections.map((section) => (
            <section key={section.part} className={styles.group}>
              <h2 className={styles.groupHeading} data-now={section.isNow}>
                {section.label}
                {/* The one that is happening now, marked rather than
                    reordered away — the rest of the day is still useful. */}
                {section.isNow ? <span className={styles.nowTag}>now</span> : null}
              </h2>

              <ul className={styles.list}>
                {section.places.map((place) => {
                  const trip = describeTrip(place);
                  return (
                    <li key={place.id} className={styles.place}>
                      <p className={styles.placeHead}>
                        <span className={styles.placeName}>{place.name}</span>
                        {trip ? <span className={`${styles.trip} tabular`}>{trip}</span> : null}
                      </p>

                      {place.editorialNote ? (
                        <p className={styles.note}>{place.editorialNote}</p>
                      ) : null}

                      {place.isPartner && place.partnerOffer ? (
                        <p className={styles.offer}>{place.partnerOffer}</p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}

          {/*
            The honest footer. Three things a guest would otherwise find out by
            looking for a button that is not there.
          */}
          <p className={styles.caveat}>
            This list is written by the hotel, not scraped from reviews. Times
            are their estimate on foot. Saving a day of your own is coming —
            for now, the desk will happily book any of it for you.
          </p>

          <Link href={`${base}/service`} className={styles.ask}>
            Ask the desk to arrange something
          </Link>
        </>
      )}
    </main>
  );
}
