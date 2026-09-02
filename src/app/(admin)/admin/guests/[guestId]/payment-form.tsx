'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { takePayment, type GuestProfileState } from '../actions';
import styles from '../../admin.module.css';

/**
 * The desk took the money.
 *
 * Somewhere else — a card machine, a cash drawer, a bank transfer. This records
 * it, which is what turns "checking out does not take the money" (D-035) into a
 * bill that closes.
 *
 * `idempotencyKey` is minted on the SERVER when this screen renders and passed
 * in, so both halves of a double-click carry the same one (#8). Generating it
 * here, or in the action, would produce a different key per click and take the
 * money twice — which on a card machine means a real second charge and a real
 * refund to arrange.
 */
export function TakePaymentForm({
  propertyId,
  stayId,
  guestId,
  idempotencyKey,
  methods,
  /** Pre-filled with what is owed: the common case is taking all of it. */
  suggestedAmount,
  balanceLabel,
}: {
  propertyId: string;
  stayId: string;
  guestId: string;
  idempotencyKey: string;
  methods: string[];
  suggestedAmount: string;
  balanceLabel: string;
}) {
  const [state, action] = useActionState<GuestProfileState, FormData>(takePayment, {});

  return (
    <details className={styles.typeForm}>
      <summary className={styles.disclosureHead}>Take a payment</summary>
      <form action={action} className={styles.stackedForm}>
        <input type="hidden" name="propertyId" value={propertyId} />
        <input type="hidden" name="stayId" value={stayId} />
        <input type="hidden" name="guestId" value={guestId} />
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

        <p className={styles.hint}>{balanceLabel}</p>

        <div className={styles.formGrid}>
          <label className={styles.field}>
            <span className={styles.label}>How much</span>
            <input
              name="amount"
              className={styles.input}
              inputMode="decimal"
              defaultValue={suggestedAmount}
              required
            />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>How it arrived</span>
            <select name="method" defaultValue="CARD" className={styles.input}>
              {methods.map((method) => (
                <option key={method} value={method}>{label(method)}</option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Reference, optional</span>
            <input
              name="reference"
              className={styles.input}
              maxLength={64}
              placeholder="4242"
            />
            {/* It ends up on the line the guest reads — "Card · 4242". */}
            <span className={styles.hint}>
              The last four of a card, or a UPI ref. The guest sees it on their bill.
            </span>
          </label>
        </div>

        {state.error ? <p className={styles.inlineError} role="alert">{state.error}</p> : null}
        {/*
          * Readable for a PARTIAL payment, where the form stays put and "₹518
          * still on the room" is the next thing the desk needs. A payment that
          * squares the bill unmounts this form — a settled bill offers none — so
          * the confirmation there is the folio above going to Settled, which is
          * the durable kind anyway.
          */}
        {state.done ? <p className={styles.inlineDone}>{state.done}</p> : null}

        <SubmitButton />
      </form>
    </details>
  );
}

function label(method: string): string {
  return {
    CASH: 'Cash',
    CARD: 'Card',
    UPI: 'UPI',
    BANK_TRANSFER: 'Bank transfer',
    OTHER: 'Something else',
  }[method] ?? method;
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={styles.primary} disabled={pending}>
      {pending ? 'Recording…' : 'Record the payment'}
    </button>
  );
}
