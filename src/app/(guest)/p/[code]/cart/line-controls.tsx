'use client';

import { useActionState } from 'react';
import { updateLineQuantity, type CartEditState } from './actions';
import styles from '../../../r/[qrCode]/cart/cart.module.css';

/**
 * The stepper and the remove control for one line.
 *
 * A client component only for the error message and the pending state — the
 * controls themselves are plain submit buttons carrying their target quantity
 * as a value, so the whole thing works with JavaScript off. React just makes
 * the failure legible when it is on.
 *
 * Decrementing past one removes the line, exactly as the reference does it.
 * There is no separate Remove control: two buttons that both delete the line
 * end up with the same accessible name — "Remove Dal baati churma" — and a
 * screen reader user cannot tell which is which. The minus button says what it
 * will do at the quantity it is at.
 */
export function LineControls({
  code,
  cartItemId,
  quantity,
  lineTotal,
  name,
}: {
  code: string;
  cartItemId: string;
  quantity: number;
  lineTotal: string | null;
  name: string;
}) {
  const [state, action, pending] = useActionState<CartEditState, FormData>(
    updateLineQuantity,
    {},
  );

  return (
    <>
      <div className={styles.controls}>
        <form action={action} className={styles.stepper}>
          <input type="hidden" name="code" value={code} />
          <input type="hidden" name="cartItemId" value={cartItemId} />
          <button
            type="submit"
            name="quantity"
            value={quantity - 1}
            className={styles.step}
            aria-label={quantity === 1 ? `Remove ${name}` : `One fewer ${name}`}
            disabled={pending}
          >
            −
          </button>
          <span className={`${styles.count} tabular`} aria-label={`Quantity ${quantity}`}>
            {quantity}
          </span>
          <button
            type="submit"
            name="quantity"
            value={quantity + 1}
            className={styles.step}
            aria-label={`One more ${name}`}
            disabled={pending || quantity >= 20}
          >
            +
          </button>
        </form>

        {lineTotal ? <span className={`${styles.lineTotal} tabular`}>{lineTotal}</span> : null}
      </div>

      {state.error ? (
        <p className={styles.lineError} role="alert">{state.error}</p>
      ) : null}
    </>
  );
}
