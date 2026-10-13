'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { sendVisitOrder, type CartEditState } from './actions';
import styles from '../../../r/[qrCode]/cart/cart.module.css';
import own from './checkout.module.css';

/**
 * The one question this flow asks. D-079.
 *
 * ─── Why it is on the cart and not behind a step ───────────────────────────
 *
 * The room flow asks nothing until the guest taps send, and then asks exactly
 * one thing. The shape is deliberate (D-012) and it is kept here: the fields
 * are on the screen they are needed on, under the order they belong to, and
 * sending answers them and places the order in one tap.
 *
 * A separate "your details" step would be a second screen between a customer
 * and their dinner, and the thing that step would protect — a room charge —
 * does not exist on this path.
 *
 * ─── Why `fulfilment` is a radio and sometimes is not ──────────────────────
 *
 * A TABLE link already knows: the tent says which table, the visit carries it,
 * and asking would invite somebody to answer "delivery" from inside the
 * restaurant. A COUNTER link already knows too. Only an ONLINE link has a
 * genuine question, and only then does the control appear. `setVisitDetails()`
 * overrules a posted fulfilment for a dine-in visit regardless, because a form
 * is a suggestion.
 */
export function CheckoutForm({
  code,
  idempotencyKey,
  total,
  where,
  canChooseFulfilment,
  fulfilment,
  belowMinimum,
}: {
  code: string;
  idempotencyKey: string;
  total: string;
  /** "Table 4", "Takeaway", "Delivery" — what the ticket will say. */
  where: string;
  canChooseFulfilment: boolean;
  fulfilment: 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY';
  belowMinimum: boolean;
}) {
  const [state, action] = useActionState<CartEditState, FormData>(sendVisitOrder, {});
  const [mode, setMode] = useState(fulfilment);

  return (
    <form action={action} className={own.form}>
      <input type="hidden" name="code" value={code} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      {!canChooseFulfilment ? (
        <input type="hidden" name="fulfilment" value={fulfilment} />
      ) : null}

      {canChooseFulfilment ? (
        <fieldset className={own.modes}>
          <legend className={own.legend}>How are you getting it?</legend>
          {([
            ['TAKEAWAY', 'Collecting', 'You come to the counter'],
            ['DELIVERY', 'Delivery', 'We bring it to you'],
          ] as const).map(([value, label, sub]) => (
            <label key={value} className={own.mode} data-on={mode === value}>
              <input
                type="radio"
                name="fulfilment"
                value={value}
                checked={mode === value}
                onChange={() => setMode(value)}
                className={own.radio}
              />
              <span className={own.modeLabel}>{label}</span>
              <span className={own.modeSub}>{sub}</span>
            </label>
          ))}
        </fieldset>
      ) : null}

      <label className={own.field}>
        <span className={own.label}>Name</span>
        <input
          name="name"
          type="text"
          autoComplete="name"
          required
          maxLength={80}
          className={own.input}
          placeholder="What shall we call out?"
          aria-invalid={state.field === 'name' || undefined}
        />
      </label>

      <label className={own.field}>
        <span className={own.label}>Phone</span>
        <input
          name="phone"
          /* `tel`, not `number`: a phone number is not a quantity. It brings up
             the keypad, keeps a leading zero, and survives a +91. */
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          required
          maxLength={32}
          className={own.input}
          placeholder="So the kitchen can call"
          aria-invalid={state.field === 'phone' || undefined}
        />
      </label>

      {mode === 'DELIVERY' ? (
        <>
          <label className={own.field}>
            <span className={own.label}>Where to</span>
            <textarea
              name="address"
              required
              rows={3}
              maxLength={400}
              className={own.textarea}
              placeholder="Flat, building, street, landmark"
              aria-invalid={state.field === 'address' || undefined}
            />
          </label>
          <label className={own.field}>
            <span className={own.label}>Anything the rider should know</span>
            <input
              name="addressNotes"
              type="text"
              maxLength={280}
              className={own.input}
              placeholder="Gate code, which floor, ring twice"
            />
          </label>
        </>
      ) : null}

      {state.error ? (
        <p className={styles.warning} role="alert">{state.error}</p>
      ) : null}

      <SendButton total={total} where={where} belowMinimum={belowMinimum} />

      <p className={styles.folioNote}>
        {/* Said plainly, because the alternative is a customer expecting a
            card screen that does not exist. Online payment is not wired up —
            see D-079; when it is, it attaches to the order. */}
        You pay {mode === 'DELIVERY' ? 'the rider' : 'at the counter'}. Nothing is
        charged now.
      </p>
    </form>
  );
}

/**
 * Separate, because `useFormStatus` only reads a pending state from inside the
 * form it is submitting — a hook called in the component that renders the
 * `<form>` reads nothing.
 */
function SendButton({
  total, where, belowMinimum,
}: { total: string; where: string; belowMinimum: boolean }) {
  const { pending } = useFormStatus();

  return (
    <>
      <button
        type="submit"
        className={styles.send}
        disabled={pending || belowMinimum}
        data-pending={pending || undefined}
      >
        <span>{pending ? 'Sending…' : 'Send to the kitchen'}</span>
        <span className="tabular">{total}</span>
      </button>
      <p className={styles.sendSub}>{where}</p>
    </>
  );
}
