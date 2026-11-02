'use client';

import { useActionState } from 'react';
import { Minus, Plus } from 'lucide-react';
import styles from './cart.module.css';

/**
 * The stepper for one line.
 *
 * A client component only for the error message and the pending state — the
 * controls themselves are plain submit buttons carrying their target quantity
 * as a value, so the whole thing works with JavaScript off. React just makes
 * the failure legible when it is on.
 *
 * Decrementing past one removes the line. There is no separate Remove
 * control: two buttons that both delete the line end up with the same
 * accessible name — "Remove Dal baati churma" — and a screen reader user
 * cannot tell which is which. The minus button says what it will do at the
 * quantity it is at.
 *
 * Shared by the room and the property link (D-079): each passes its own
 * `updateLineQuantity` and the hidden field it reads (`qrCode` or `code`).
 */
export interface LineEditResult {
  error?: string;
}

export type LineEditAction = (
  previous: LineEditResult,
  formData: FormData,
) => Promise<LineEditResult>;

export function LineControls({
  action: update,
  scope,
  cartItemId,
  quantity,
  name,
}: {
  action: LineEditAction;
  scope: { name: 'qrCode' | 'code'; value: string };
  cartItemId: string;
  quantity: number;
  name: string;
}) {
  const [state, action, pending] = useActionState<LineEditResult, FormData>(update, {});

  return (
    <>
      <form action={action} className={styles.stepper}>
        <input type="hidden" name={scope.name} value={scope.value} />
        <input type="hidden" name="cartItemId" value={cartItemId} />
        <button
          type="submit"
          name="quantity"
          value={quantity - 1}
          className={styles.step}
          aria-label={quantity === 1 ? `Remove ${name}` : `One fewer ${name}`}
          disabled={pending}
        >
          <Minus size={20} strokeWidth={1.5} aria-hidden="true" />
        </button>
        <span className={`${styles.count} tabular`} aria-label={`Quantity ${quantity}`}>
          {quantity}
        </span>
        <button
          type="submit"
          name="quantity"
          value={quantity + 1}
          className={styles.step}
          data-more
          aria-label={`One more ${name}`}
          disabled={pending || quantity >= 20}
        >
          <Plus size={20} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </form>

      {state.error ? (
        <p className={styles.lineError} role="alert">{state.error}</p>
      ) : null}
    </>
  );
}
