import styles from '../admin.module.css';
import q from './requests.module.css';
import { ShiftMark } from './live-requests';

/**
 * Who is carrying what, and how today has gone (D-097).
 *
 * The live list answers "what is waiting"; this answers the manager's next
 * two questions — is the work spread fairly across the people on shift, and
 * which kind of request is the hotel slow at. On time means inside the
 * promise the request type made the guest, the same rule as the live view.
 */
export interface PersonLoad {
  id: string;
  name: string;
  onShift: string | null;
  carrying: number;
  late: number;
  done: number;
  onTime: number;
  averageMinutes: number | null;
}

export interface TypeLoad {
  label: string;
  openNow: number;
  lateNow: number;
  done: number;
  onTime: number;
  averageMinutes: number | null;
}

const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : '—');

export function TeamToday({ people, types }: { people: PersonLoad[]; types: TypeLoad[] }) {
  return (
    <div className={q.team}>
      <section className={`${styles.section} ${q.list}`} aria-labelledby="who-has-what">
        <header className={styles.sectionHead}>
          <h2 id="who-has-what" className={styles.sectionTitle}>Who has what</h2>
          <p className={styles.sectionBlurb}>Everyone on shift, and anyone else holding a request.</p>
        </header>
        {people.length ? (
          <table className={q.table}>
            <thead>
              <tr><th>Person</th><th className={q.num}>Has now</th><th className={q.num}>Late</th><th className={q.num}>Done today</th><th className={q.num}>On time</th><th className={q.num}>Avg minutes</th></tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.id} data-person={p.name}>
                  <td>
                    <span className={q.assignee}>
                      <ShiftMark onShift={!!p.onShift} />
                      <span className={q.personName}>{p.name}</span>
                    </span>
                    <span className={q.personShift}>{p.onShift ?? 'not clocked in'}</span>
                  </td>
                  <td className={`${q.num} tabular`} data-heavy={p.carrying >= 4 || undefined}>{p.carrying}</td>
                  <td className={`${q.num} tabular`} data-late={p.late > 0 || undefined}>{p.late}</td>
                  <td className={`${q.num} tabular`}>{p.done}</td>
                  <td className={`${q.num} tabular`}>{pct(p.onTime, p.done)}</td>
                  <td className={`${q.num} tabular`}>{p.averageMinutes ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className={styles.sectionEmpty}>Nobody is on shift and nobody is holding a request.</p>
        )}
      </section>

      <section className={`${styles.section} ${q.list}`} aria-labelledby="by-type">
        <header className={styles.sectionHead}>
          <h2 id="by-type" className={styles.sectionTitle}>By what was asked for</h2>
          <p className={styles.sectionBlurb}>Today. Slowest first — where the promise to guests is hardest to keep.</p>
        </header>
        {types.length ? (
          <table className={q.table}>
            <thead>
              <tr><th>Request</th><th className={q.num}>Open now</th><th className={q.num}>Late now</th><th className={q.num}>Done today</th><th className={q.num}>On time</th><th className={q.num}>Avg minutes</th></tr>
            </thead>
            <tbody>
              {types.map((t) => (
                <tr key={t.label}>
                  <td>{t.label}</td>
                  <td className={`${q.num} tabular`}>{t.openNow}</td>
                  <td className={`${q.num} tabular`} data-late={t.lateNow > 0 || undefined}>{t.lateNow}</td>
                  <td className={`${q.num} tabular`}>{t.done}</td>
                  <td className={`${q.num} tabular`}>{pct(t.onTime, t.done)}</td>
                  <td className={`${q.num} tabular`}>{t.averageMinutes ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className={styles.sectionEmpty}>No requests yet today.</p>
        )}
      </section>
    </div>
  );
}
