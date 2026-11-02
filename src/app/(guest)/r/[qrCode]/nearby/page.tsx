import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { withTenant } from '@/db';
import { resolveStaySession, GUEST_SESSION_COOKIE } from '@/modules/access';
import { findProperty } from '@/modules/identity';
import {
  listPlacesForProperty, planDay, describeTrip, PARTS,
  type PartOfDay, type PlannedPlace,
} from '@/modules/concierge';
import { localTimeAt, spellCount } from '@/lib/clock';
import styles from './nearby.module.css';

/**
 * Plan my day — Direction A's `GuestPlanDay` board.
 *
 * ─── What this is, and what it is not ──────────────────────────────────────
 *
 * It is the hotel's own list of the city, ordered into a day and opened at the
 * part of it the guest is standing in. Every place, every note and every
 * walking time comes out of `pois` through the same tenant-scoped read as
 * anything else on this screen — none of it is written into the page.
 *
 * The board's chips filter by time of day. The data has no time-of-day column;
 * it has a CATEGORY, and `planDay` already maps each category to a part of the
 * day (D-069) — so the chips are those parts, and only the ones that have a
 * place in them. A chip is a link (`?part=evening`), so it works with
 * JavaScript off and the back button undoes it.
 *
 * Left out of the board, because nothing behind them exists: the photos (no
 * image on a place), "Directions" and "See all on a map" (the read carries no
 * coordinates), and "Nobody paid to be on it" — a place can be a partner with
 * an offer, and when it is, the row says so.
 *
 * It is NOT the finished concierge. P4 is unbuilt: there is no admin screen
 * for adding a place, the walking times are the GM's estimate rather than a
 * nightly refresh from a maps API, and a guest cannot yet keep a day of their
 * own. The screen says so at the bottom instead of letting a visitor discover
 * it by tapping something that does nothing (D-069).
 *
 * ─── Not gated ─────────────────────────────────────────────────────────────
 *
 * CLAUDE.md #9, and `view_pois` is BROWSE — the lowest tier there is.
 */
export const dynamic = 'force-dynamic';

/** The chips' words — shorter than the section headings `planDay` gives. */
const CHIP: Record<PartOfDay, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  evening: 'Evening',
  night: 'After dark',
};

export default async function NearbyScreen({
  params,
  searchParams,
}: {
  params: Promise<{ qrCode: string }>;
  searchParams: Promise<{ part?: string | string[] }>;
}) {
  const { qrCode } = await params;
  const { part: rawPart } = await searchParams;
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

  // A part from the URL counts only if it is one of ours AND has a place in it;
  // anything else is the whole list rather than an empty screen.
  const requested = typeof rawPart === 'string' ? rawPart : null;
  const active = sections.find((section) => section.part === requested)?.part ?? null;

  // Numbered across the whole day, so "03" means the same place in every chip.
  const ordered: { place: PlannedPlace; part: PartOfDay; isNow: boolean; n: number }[] = [];
  for (const section of sections) {
    for (const place of section.places) {
      ordered.push({ place, part: section.part, isNow: section.isNow, n: ordered.length + 1 });
    }
  }
  const shown = active ? ordered.filter((entry) => entry.part === active) : ordered;
  const [first, ...rest] = shown;
  const total = ordered.length;

  return (
    <main className={styles.shell}>
      <header className={styles.bar}>
        <Link href={`${base}/home`} className={styles.back} aria-label="Back to room home">
          <ChevronLeft size={22} strokeWidth={1.5} aria-hidden="true" />
        </Link>
      </header>

      {total === 0 ? (
        /* A property whose GM has not filled this in. Says so plainly rather
           than showing an empty page that reads as broken. */
        <div className={styles.empty}>
          <span className={styles.emptyArch} aria-hidden="true" />
          <h1 className={styles.emptyTitle}>Nothing here yet</h1>
          <p className={styles.emptyBody}>
            {property?.name ?? 'The hotel'} hasn’t added their list of the city
            yet. Ask at the desk — they will know where to send you.
          </p>
          <Link href={`${base}/service`} className={styles.ask}>Message the desk</Link>
        </div>
      ) : (
        <>
          <div className={styles.intro}>
            <h1 className={styles.title}>
              {countWord(total)} {total === 1 ? 'place' : 'places'} we vouch for
            </h1>
            <p className={styles.lede}>
              Where we send our own friends, in the order the day happens.
              Walking times are from the front door.
            </p>
          </div>

          {/* Only worth drawing when there is more than one part to choose. */}
          {sections.length > 1 ? (
            <nav aria-label="Time of day" className={styles.chips}>
              <Link
                href={`${base}/nearby`}
                className={styles.chip}
                aria-current={active === null ? 'page' : undefined}
                scroll={false}
              >
                All {countWord(total).toLowerCase()}
              </Link>
              {PARTS.filter((part) => sections.some((section) => section.part === part)).map((part) => (
                <Link
                  key={part}
                  href={`${base}/nearby?part=${part}`}
                  className={styles.chip}
                  aria-current={active === part ? 'page' : undefined}
                  scroll={false}
                >
                  {CHIP[part]}
                  {sections.find((section) => section.part === part)?.isNow ? (
                    <span className={styles.chipNow}>· now</span>
                  ) : null}
                </Link>
              ))}
            </nav>
          ) : null}

          <div className={styles.list}>
            {first ? (
              <article className={styles.feature}>
                <div className={styles.featureTop}>
                  <span className={`${styles.number} tabular`}>{pad(first.n)}</span>
                  <span className={styles.partTag} data-now={first.isNow}>
                    {first.isNow ? 'Now' : CHIP[first.part]}
                  </span>
                </div>
                <div className={styles.featureHead}>
                  <h2 className={styles.featureName}>{first.place.name}</h2>
                  <Trip place={first.place} />
                </div>
                {first.place.editorialNote ? (
                  <p className={styles.featureNote}>{first.place.editorialNote}</p>
                ) : null}
                {first.place.isPartner && first.place.partnerOffer ? (
                  <p className={styles.offer}>{first.place.partnerOffer}</p>
                ) : null}
                <Link href={`${base}/service`} className={styles.featureAsk}>
                  Ask the desk to arrange it
                </Link>
              </article>
            ) : null}

            {rest.length ? (
              <ul className={styles.rows}>
                {rest.map(({ place, part, isNow, n }) => (
                  <li key={place.id}>
                    <article className={styles.row}>
                      <span className={styles.rowHead}>
                        <h2 className={styles.rowName}>{place.name}</h2>
                        <span className={`${styles.rowNumber} tabular`}>{pad(n)}</span>
                      </span>
                      {place.editorialNote ? (
                        <p className={styles.rowNote}>{place.editorialNote}</p>
                      ) : null}
                      {place.isPartner && place.partnerOffer ? (
                        <p className={styles.offer}>{place.partnerOffer}</p>
                      ) : null}
                      <span className={styles.rowMeta}>
                        <Trip place={place} />
                        {active ? null : (
                          <>
                            <span aria-hidden="true">·</span>
                            <span data-now={isNow} className={styles.rowPart}>
                              {isNow ? 'Now' : CHIP[part]}
                            </span>
                          </>
                        )}
                      </span>
                    </article>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          {/*
            The honest footer. Three things a guest would otherwise find out by
            looking for a button that is not there.
          */}
          <div className={styles.foot}>
            <p className={styles.caveat}>
              This list is written by the hotel, not scraped from reviews. Times
              are their estimate. Saving a day of your own is coming — for now,
              the desk will happily book any of it for you.
            </p>
            <Link href={`${base}/service`} className={styles.ask}>
              Ask the desk to arrange something
            </Link>
          </div>
        </>
      )}
    </main>
  );
}

/** "8 min walk", "25 min drive" — or nothing rather than a guess. */
function Trip({ place }: { place: PlannedPlace }) {
  const trip = describeTrip(place);
  if (!trip) return null;
  const [minutes, ...words] = trip.split(' ');
  return (
    <span className={styles.trip}>
      <span className="tabular">{minutes}</span> {words.join(' ')}
    </span>
  );
}

/**
 * "Twelve places we vouch for" — the board spells the count in its Marcellus
 * headline. `spellCount` stops at ten; a curated list rarely runs past twenty,
 * and past that the figure is clearer than the word.
 */
const TEENS = ['Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen', 'Twenty'];

function countWord(n: number): string {
  return n > 10 && n <= 20 ? TEENS[n - 11]! : spellCount(n);
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
