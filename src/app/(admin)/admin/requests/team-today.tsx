import Link from 'next/link';
import q from './requests.module.css';
import { initials, ShiftMark } from './live-requests';

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
  /** "Housekeeping" — their first role here, for the card. */
  role: string | null;
  /** "Second, Rooftop" while clocked in; null when not. */
  floors: string | null;
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
      <section className={q.tableCard} aria-labelledby="who-has-what">
        <header className={q.cardHead}>
          <h2 id="who-has-what" className={q.h2}>Who has what</h2>
          <p className={q.blurb}>Everyone on shift, and anyone else holding a request.</p>
        </header>
        {people.length ? (
          <table className={q.teamTable}>
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
          <p className={q.empty}>Nobody is on shift and nobody is holding a request.</p>
        )}
      </section>

      <section className={q.tableCard} aria-labelledby="by-type">
        <header className={q.cardHead}>
          <h2 id="by-type" className={q.h2}>By what was asked for</h2>
          <p className={q.blurb}>Today. Slowest first — where the promise to guests is hardest to keep.</p>
        </header>
        {types.length ? (
          <table className={q.teamTable}>
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
          <p className={q.empty}>No requests yet today.</p>
        )}
      </section>
    </div>
  );
}

/**
 * The board's "Team on shift" strip under the live list: per person clocked
 * in, what they hold, what they finished today and how much of it inside the
 * promise. The same numbers as Team today, one card each.
 */
export function TeamOnShift({ people }: { people: PersonLoad[] }) {
  const on = people.filter((p) => p.onShift);
  return (
    <section className={q.teamStrip} aria-labelledby="team-on-shift">
      <div className={q.teamStripHead}>
        <h2 id="team-on-shift" className={q.h2}>Team on shift</h2>
        <Link href="/admin/requests?tab=team" className={q.more}>Team today →</Link>
      </div>
      {on.length ? (
        <ul className={q.teamCards}>
          {on.map((p) => {
            const rate = p.done ? Math.round((p.onTime / p.done) * 100) : null;
            const tone = rate === null ? undefined : rate >= 90 ? 'pos' : 'warn';
            return (
              <li key={p.id} className={q.teamCard} data-person={p.name}>
                <span className={q.teamWho}>
                  <span className={q.teamAvatar} aria-hidden="true">{initials(p.name)}</span>
                  <span className={q.teamText}>
                    <span className={q.personName}>{p.name} <ShiftMark onShift /></span>
                    <span className={q.personShift}>{[p.role, p.floors].filter(Boolean).join(' · ')}</span>
                  </span>
                </span>
                <span className={q.teamNums}>
                  <span>
                    Has <b className="tabular">{p.carrying}</b> · done <b className="tabular">{p.done}</b>
                    {p.late ? <> · <b className={`${q.lateNum} tabular`}>{p.late}</b> late</> : null}
                  </span>
                  <span className={`${q.rate} tabular`} data-tone={tone}>{rate === null ? '—' : `${rate}%`}</span>
                </span>
                <span className={q.bar} role="img" aria-label={rate === null ? 'Nothing finished yet' : `On time ${rate}%`}>
                  <span className={q.barFill} data-tone={tone} style={{ width: `${rate ?? 0}%` }} />
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className={q.empty}>Nobody is clocked in. Requests wait until somebody clocks in on their phone.</p>
      )}
    </section>
  );
}
