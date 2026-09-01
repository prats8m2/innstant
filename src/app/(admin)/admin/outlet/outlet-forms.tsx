'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import type { AdminOutletSettings } from '@/modules/catalog';
import { formatMoney, money, formatRateBps } from '@/lib/money';
import { saveOutletSettings, saveOutletHours, type OutletActionState } from './actions';
import styles from '../admin.module.css';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * What the kitchen charges.
 *
 * Rates are typed as percentages and stored as basis points; amounts are typed
 * in rupees and stored as minor units. Both conversions happen server-side, in
 * one place (`parseRateBps` / `parseMoneyInput`) — a form that did the maths in
 * the browser would be a second place for #5 to be broken.
 */
export function OutletSettingsForm({
  propertyId,
  outlet,
}: {
  propertyId: string;
  outlet: AdminOutletSettings;
}) {
  const [state, action] = useActionState<OutletActionState, FormData>(saveOutletSettings, {});
  const rupees = (minor: number) => (minor % 100 === 0 ? String(minor / 100) : (minor / 100).toFixed(2));

  return (
    <form action={action} className={styles.dishForm}>
      <input type="hidden" name="propertyId" value={propertyId} />
      <input type="hidden" name="outletId" value={outlet.id} />

      <div className={styles.formGrid}>
        <label className={`${styles.field} ${styles.wide}`}>
          <span className={styles.label}>Name</span>
          <input
            name="name"
            className={styles.input}
            defaultValue={outlet.name}
            required
            maxLength={120}
          />
          <span className={styles.hint}>
            The guest sees this at the top of the menu.
          </span>
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Tax</span>
          <input
            name="taxRate"
            className={styles.input}
            defaultValue={formatRateBps(outlet.taxRateBps)}
            inputMode="decimal"
          />
          <span className={styles.hint}>Percent — 5, or 5.5. Applied to the subtotal.</span>
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Service charge</span>
          <input
            name="serviceChargeRate"
            className={styles.input}
            defaultValue={formatRateBps(outlet.serviceChargeBps)}
            inputMode="decimal"
          />
          <span className={styles.hint}>Percent. Shown to the guest as its own line.</span>
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Delivery fee</span>
          <input
            name="deliveryFee"
            className={styles.input}
            defaultValue={rupees(outlet.deliveryFeeMinor)}
            inputMode="decimal"
          />
          <span className={styles.hint}>
            Rupees. 0 for none — {formatMoney(money(0, outlet.currency))} does not appear on a bill.
          </span>
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Minimum order</span>
          <input
            name="minimumOrder"
            className={styles.input}
            defaultValue={rupees(outlet.minimumOrderMinor)}
            inputMode="decimal"
          />
          <span className={styles.hint}>Rupees. 0 for no minimum.</span>
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Minutes to the door</span>
          <input
            name="prepTimeMinutes"
            className={styles.input}
            type="number"
            min={1}
            max={240}
            defaultValue={outlet.prepTimeMinutes}
            required
          />
          <span className={styles.hint}>
            The promise a guest reads while they wait. Be honest rather than quick.
          </span>
        </label>
      </div>

      {state.error ? <p className={styles.formError} role="alert">{state.error}</p> : null}
      {state.done ? <p className={styles.formDone}>{state.done}</p> : null}

      <div className={styles.formActions}>
        <SaveButton label="Save what it charges" />
      </div>
    </form>
  );
}

/**
 * When it is open.
 *
 * All seven days post together, and an unticked day posts nothing — which is
 * how "closed on Tuesdays" is stored (there is no `is_closed` column, and
 * `00:00`–`00:00` would be a lie the open-state logic has to guess about).
 */
export function OutletHoursForm({
  propertyId,
  outlet,
}: {
  propertyId: string;
  outlet: AdminOutletSettings;
}) {
  const [state, action] = useActionState<OutletActionState, FormData>(saveOutletHours, {});
  const byDay = new Map(outlet.hours.map((h) => [h.dayOfWeek, h]));

  return (
    <form action={action} className={styles.hoursForm}>
      <input type="hidden" name="propertyId" value={propertyId} />
      <input type="hidden" name="outletId" value={outlet.id} />

      <table className={styles.hoursTable}>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Open</th>
            <th scope="col">From</th>
            <th scope="col">Until</th>
            <th scope="col">Past midnight</th>
          </tr>
        </thead>
        <tbody>
          {DAYS.map((day, dayOfWeek) => {
            const hours = byDay.get(dayOfWeek);
            return (
              <tr key={day}>
                <th scope="row" className={styles.hoursDay}>{day}</th>
                <td>
                  <input
                    type="checkbox"
                    name={`open-${dayOfWeek}`}
                    defaultChecked={Boolean(hours)}
                    aria-label={`Open on ${day}`}
                  />
                </td>
                <td>
                  <input
                    name={`opensAt-${dayOfWeek}`}
                    type="time"
                    className={styles.timeInput}
                    defaultValue={hours?.opensAt ?? '07:00'}
                    aria-label={`${day} opens at`}
                  />
                </td>
                <td>
                  <input
                    name={`closesAt-${dayOfWeek}`}
                    type="time"
                    className={styles.timeInput}
                    defaultValue={hours?.closesAt ?? '23:00'}
                    aria-label={`${day} closes at`}
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    name={`crossesMidnight-${dayOfWeek}`}
                    defaultChecked={hours?.crossesMidnight ?? false}
                    aria-label={`${day} closes after midnight`}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <p className={styles.hint}>
        Times are the property&rsquo;s own clock. A kitchen open until 1am closes
        <em> past midnight</em> — tick that column, or the day reads as closed.
      </p>

      {state.error ? <p className={styles.formError} role="alert">{state.error}</p> : null}
      {state.done ? <p className={styles.formDone}>{state.done}</p> : null}

      <div className={styles.formActions}>
        <SaveButton label="Save the hours" />
      </div>
    </form>
  );
}

function SaveButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={styles.primary} disabled={pending}>
      {pending ? 'Saving…' : label}
    </button>
  );
}
