'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import type { OutletHoursDay } from '@/modules/catalog';
import { saveOutletHours, type OutletActionState } from './service-actions';
import styles from '../admin.module.css';
import s from './settings.module.css';

/** Monday first: a hotel's week is read Monday to Sunday, and stored Sunday = 0. */
const ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
const NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

interface DayState {
  open: boolean;
  opensAt: string;
  closesAt: string;
}

/**
 * The kitchen's week (D-087 — moved here from "The kitchen" page).
 *
 * A switch per day, two times, and nothing else to tick. "Past midnight" is
 * worked out — a closing time at or before the opening time is the next day,
 * and the row says so in words — because the old separate box was the way a
 * 19:00–02:00 kitchen got stored as shut all evening. The server derives it
 * the same way, so the form and the save cannot disagree.
 *
 * The field names are the ones `saveOutletHours` has always read: an unticked
 * day posts nothing, which is how "closed on Tuesdays" is stored.
 */
export function HoursEditor({
  propertyId,
  outletId,
  hours,
}: {
  propertyId: string;
  outletId: string;
  hours: readonly OutletHoursDay[];
}) {
  const [state, action] = useActionState<OutletActionState, FormData>(saveOutletHours, {});
  const [week, setWeek] = useState<DayState[]>(() => NAMES.map((_, day) => {
    const found = hours.find((h) => h.dayOfWeek === day);
    return {
      open: Boolean(found),
      opensAt: found?.opensAt ?? '07:00',
      closesAt: found?.closesAt ?? '23:00',
    };
  }));

  const update = (day: number, patch: Partial<DayState>) => {
    setWeek((previous) => previous.map((d, i) => (i === day ? { ...d, ...patch } : d)));
  };

  const copyMondayToAll = () => {
    const monday = week[1]!;
    setWeek(() => NAMES.map(() => ({ ...monday })));
  };

  return (
    <form action={action}>
      <input type="hidden" name="propertyId" value={propertyId} />
      <input type="hidden" name="outletId" value={outletId} />

      <ul className={s.week}>
        {ORDER.map((day) => {
          const d = week[day]!;
          const name = NAMES[day]!;
          const nextDay = d.open && d.closesAt <= d.opensAt;
          return (
            <li key={day} className={s.day}>
              <span className={s.dayName}>{name}</span>
              <label className={s.switch}>
                <input
                  type="checkbox"
                  className={s.switchInput}
                  name={`open-${day}`}
                  checked={d.open}
                  onChange={(event) => update(day, { open: event.target.checked })}
                  aria-label={`Open on ${name}`}
                />
                {d.open ? 'Open' : 'Closed'}
              </label>
              {d.open ? (
                <span className={s.dayTimes}>
                  <input
                    type="time"
                    className={s.timeInput}
                    name={`opensAt-${day}`}
                    value={d.opensAt}
                    onChange={(event) => update(day, { opensAt: event.target.value })}
                    aria-label={`${name} opens at`}
                    required
                  />
                  <span className={s.dash} aria-hidden="true">to</span>
                  <input
                    type="time"
                    className={s.timeInput}
                    name={`closesAt-${day}`}
                    value={d.closesAt}
                    onChange={(event) => update(day, { closesAt: event.target.value })}
                    aria-label={`${name} closes at`}
                    required
                  />
                  {nextDay ? <span className={s.nextDay}>next day</span> : null}
                  <span className={`${s.dayLength} tabular`}>{lengthOf(d)}</span>
                </span>
              ) : (
                <span className={s.closedNote}>Guests cannot order on {name}s.</span>
              )}
            </li>
          );
        })}
      </ul>

      <div className={s.weekTools}>
        <button type="button" className={styles.secondary} onClick={copyMondayToAll}>
          Copy Monday to every day
        </button>
        <SaveButton />
        {state.error ? <span className={styles.inlineError} role="alert">{state.error}</span> : null}
        {state.done ? <span className={styles.inlineDone}>{state.done}</span> : null}
        <p className={`${styles.hint} ${s.hint}`}>
          The property&rsquo;s own clock. A kitchen that closes at 1am closes the next day — it says so beside the time.
        </p>
      </div>
    </form>
  );
}

/** "18h open", "7h 30m open" — how long the window is, crossing midnight or not. */
function lengthOf(day: DayState): string {
  const minutes = (clock: string) => {
    const [h, m] = clock.split(':').map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };
  let span = minutes(day.closesAt) - minutes(day.opensAt);
  if (span <= 0) span += 24 * 60;
  const hours = Math.floor(span / 60);
  const rest = span % 60;
  return `${hours}h${rest ? ` ${rest}m` : ''} open`;
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={styles.primary} disabled={pending}>
      {pending ? 'Saving…' : 'Save the hours'}
    </button>
  );
}
