'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  requestCheckout, withdrawCheckoutRequest, type CheckoutActionState,
} from './checkout-actions';
import styles from './stay.module.css';

/**
 * Leaving later, or earlier.
 *
 * The reference's own shape: a list of options, one of which lights up when
 * picked, and a sticky bar at the bottom carrying the action and the price. Pick
 * then confirm rather than one tap per option, because the price is the thing
 * being agreed to and a single tap on a row would agree to it by accident.
 *
 * The strings arrive as props. A client component that imported a `modules/*`
 * index would pull `pg` into the browser bundle, and only `pnpm build` catches
 * it.
 */
export interface OfferView {
  id: string;
  /** "Late checkout, 2pm" — said to a screen reader; the tile shows `time`. */
  title: string;
  /** "2pm", on the property's clock. */
  time: string;
  sub: string;
  /** Already formatted — the money rules live on the server (#5). */
  price: string;
  /** No fee — the board sets "on us" in the ready tone rather than as a price. */
  free: boolean;
  cta: string;
}

export function CheckoutOptions({
  qrCode,
  offers,
}: {
  qrCode: string;
  offers: OfferView[];
}) {
  const [state, action] = useActionState<CheckoutActionState, FormData>(requestCheckout, {});
  const [picked, setPicked] = useState<string | null>(null);
  const chosen = offers.find((offer) => offer.id === picked) ?? null;

  return (
    <form action={action} className={styles.options}>
      <input type="hidden" name="qrCode" value={qrCode} />
      {/* The tier id, never the amount: the server re-derives the fee from its
          own tiers, so a posted price cannot become an agreed price. */}
      <input type="hidden" name="choice" value={picked ?? ''} />

      <fieldset className={styles.optionSet}>
        <legend className={styles.optionsLegend}>Staying a little longer?</legend>

        {/* The board's two-up tiles: the hour, large, and what it costs. The
            full title is in the label for a screen reader; the hour is the
            same words drawn bigger, so it is hidden from one. */}
        <div className={styles.optionGrid}>
          {offers.map((offer) => (
            <label
              key={offer.id}
              className={styles.option}
              data-picked={offer.id === picked}
            >
              <input
                type="radio"
                name="pick"
                value={offer.id}
                checked={offer.id === picked}
                onChange={() => setPicked(offer.id)}
                className={styles.optionRadio}
              />
              <span className="sr-only">{offer.title}. </span>
              <span className={styles.optionTop}>
                <span className={`${styles.optionTime} tabular`} aria-hidden="true">{offer.time}</span>
                <span
                  className={`${styles.optionPrice} tabular`}
                  data-free={offer.free}
                >
                  {offer.price}
                </span>
              </span>
              <span className={styles.optionSub}>{offer.sub}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {state.error ? <p className={styles.optionError} role="alert">{state.error}</p> : null}
      {state.done ? <p className={styles.optionDone} role="status">{state.done}</p> : null}

      {chosen ? <ConfirmBar cta={chosen.cta} price={chosen.price} /> : null}
    </form>
  );
}

/**
 * The reference's sticky bar, and it appears only once something is picked —
 * a permanently visible primary button with nothing selected is a button that
 * teaches people it does nothing.
 */
function ConfirmBar({ cta, price }: { cta: string; price: string }) {
  const { pending } = useFormStatus();
  return (
    <div className={styles.confirmBar}>
      <button type="submit" className={styles.confirm} disabled={pending}>
        <span>{pending ? 'Asking…' : cta}</span>
        <span className={`${styles.confirmPrice} tabular`}>{price}</span>
      </button>
    </div>
  );
}

/**
 * Where a request that has been made stands.
 *
 * Replaces the options entirely rather than sitting above them: a guest who has
 * asked for 2pm and can still see a 6pm button next to it will press it, and the
 * one-open-request index would then refuse in a way that reads as a bug.
 */
export function PendingCheckout({
  qrCode,
  requestId,
  status,
  headline,
  detail,
  canWithdraw,
}: {
  qrCode: string;
  requestId: string;
  status: string;
  headline: string;
  detail: string;
  canWithdraw: boolean;
}) {
  const [state, action] = useActionState<CheckoutActionState, FormData>(
    withdrawCheckoutRequest, {},
  );

  return (
    <section className={styles.pending} data-status={status}>
      <p className={styles.pendingHeadline}>{headline}</p>
      <p className={styles.pendingDetail}>{detail}</p>

      {state.error ? <p className={styles.optionError} role="alert">{state.error}</p> : null}

      {canWithdraw ? (
        <form action={action}>
          <input type="hidden" name="qrCode" value={qrCode} />
          <input type="hidden" name="checkoutRequestId" value={requestId} />
          <WithdrawButton />
        </form>
      ) : null}
    </section>
  );
}

function WithdrawButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={styles.withdraw} disabled={pending}>
      {pending ? 'Withdrawing…' : 'Never mind'}
    </button>
  );
}

/**
 * "Check out now."
 *
 * Its own form and its own secondary treatment, below the folio, because it is
 * the one control here that ENDS something. Grouping it with the late-checkout
 * options would put "leave now" one mis-tap away from "stay until 6pm".
 */
export function CheckOutNow({ qrCode }: { qrCode: string }) {
  const [state, action] = useActionState<CheckoutActionState, FormData>(requestCheckout, {});

  return (
    <form action={action} className={styles.leaveNow}>
      <input type="hidden" name="qrCode" value={qrCode} />
      <input type="hidden" name="choice" value="NOW" />
      {state.error ? <p className={styles.optionError} role="alert">{state.error}</p> : null}
      {state.done ? <p className={styles.optionDone} role="status">{state.done}</p> : null}
      <LeaveButton />
    </form>
  );
}

function LeaveButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={styles.leaveButton} disabled={pending}>
      {pending ? 'Telling the desk…' : 'Check out now'}
    </button>
  );
}
