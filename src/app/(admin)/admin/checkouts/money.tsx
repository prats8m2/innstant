import Link from 'next/link';
import styles from '../admin.module.css';
import l from './leaving.module.css';

/**
 * The money half of the Leaving screen (D-097): what came in today, by how,
 * and who left owing. Server-rendered; every string arrives formatted.
 */
export interface CollectionView {
  method: string;
  taken: string;
  payments: number;
}

export function Collections({ rows, total, refunded }: { rows: CollectionView[]; total: string; refunded: string | null }) {
  return (
    <section className={styles.section} aria-labelledby="taken-today">
      <header className={styles.sectionHead}>
        <h2 id="taken-today" className={styles.sectionTitle}>Taken today</h2>
        <p className={styles.sectionBlurb}>What the drawer and the card machine should agree with.</p>
      </header>
      {rows.length ? (
        <div className={l.collections}>
          {rows.map((row) => (
            <div key={row.method} className={l.collection}>
              <span className={l.statLabel}>{row.method}</span>
              <span className={`${l.collectionValue} tabular`}>{row.taken}</span>
              <span className={l.statSub}>{row.payments} payment{row.payments === 1 ? '' : 's'}</span>
            </div>
          ))}
          <div className={l.collection} data-total="true">
            <span className={l.statLabel}>In total</span>
            <span className={`${l.collectionValue} tabular`}>{total}</span>
            <span className={l.statSub}>{refunded ? `after ${refunded} given back` : 'nothing given back'}</span>
          </div>
        </div>
      ) : (
        <p className={styles.sectionEmpty}>Nothing taken at the desk yet today.</p>
      )}
    </section>
  );
}

export interface OwingView {
  stayId: string;
  guestName: string;
  guestPhone: string | null;
  roomNumber: string;
  left: string;
  daysAgo: number;
  amount: string;
  reason: string | null;
}

export function LeftOwing({ rows }: { rows: OwingView[] }) {
  if (!rows.length) return null;
  return (
    <section className={styles.section} aria-labelledby="left-owing">
      <header className={styles.sectionHead}>
        <h2 id="left-owing" className={styles.sectionTitle}>Left owing</h2>
        <p className={styles.sectionBlurb}>Departures in the last 90 days with money still on the bill. Oldest first.</p>
      </header>
      <ul className={l.rows}>
        {rows.map((row) => (
          <li key={row.stayId} className={l.row} data-owing={row.roomNumber}>
            <span className={`${l.room} tabular`}>{row.roomNumber}</span>
            <span className={l.who}>
              <span className={l.name}>{row.guestName}</span>
              <span className={l.meta}>
                Left {row.left}{row.daysAgo > 0 ? ` · ${row.daysAgo} day${row.daysAgo === 1 ? '' : 's'} ago` : ' · today'}
                {row.guestPhone ? ` · ${row.guestPhone}` : ''}
                {row.reason ? <span className={l.reason}> · “{row.reason}”</span> : null}
              </span>
            </span>
            <span className={`${l.balance} tabular`} data-owes="true">{row.amount}</span>
            <span className={l.actions}>
              <Link href={`/admin/checkouts/${row.stayId}`} className={styles.secondary}>Collect</Link>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
