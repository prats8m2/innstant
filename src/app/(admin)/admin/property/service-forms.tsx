'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import type { AdminOutletSettings } from '@/modules/catalog';
import { formatMoney, money, formatRateBps } from '@/lib/money';
import { saveOutletSettings, type OutletActionState } from './service-actions';
import styles from '../admin.module.css';

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

function SaveButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={styles.primary} disabled={pending}>
      {pending ? 'Saving…' : label}
    </button>
  );
}
