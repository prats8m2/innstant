'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { adjustDishInOrder, type QuickAdjustState } from './actions';
import styles from '../../../r/[qrCode]/menu/menu.module.css';

/**
 * Add and remove, on the menu card, without opening the dish. The property-link
 * copy of the room flow's stepper (D-079).
 *
 * It exists separately for one reason: the action. `useActionState` binds a
 * component to ONE server action at import time, and the two flows resolve a
 * different session and scope to a different context. The markup and the
 * stylesheet are shared — this imports the room flow's `menu.module.css`
 * directly, because two copies of a stylesheet is how one of them quietly
 * stops matching the other.
 *
 * ─── Why this is a form and not an onClick ─────────────────────────────────
 *
 * The cart is a table, not client state — unlike the amenities screen, where
 * quantity lives in `useState` until the guest sends. So every tap here is a
 * write, and a write from our own UI is a Server Action (CLAUDE.md
 * "Conventions"). It also means the control keeps working with no JavaScript:
 * two buttons in a form, each posting its own direction.
 *
 * ─── Why the whole card is not the button ──────────────────────────────────
 *
 * The card is a link into the dish, and it stays one. A guest who wants the
 * chilli mild, a note on the order, or simply to read the description taps
 * the card; a guest who wants one more of what the kitchen makes taps the
 * plus. Collapsing those into one gesture would take the long way round away
 * to save a tap on the short one.
 */
export function DishStepper({
  code,
  menuItemId,
  quantity,
  dishName,
}: {
  code: string;
  menuItemId: string;
  /** How many of this dish are in the cart, across every variant of it. */
  quantity: number;
  dishName: string;
}) {
  const [state, action] = useActionState<QuickAdjustState, FormData>(adjustDishInOrder, {});

  return (
    <form action={action} className={styles.stepper} data-on={quantity > 0}>
      <input type="hidden" name="code" value={code} />
      <input type="hidden" name="menuItemId" value={menuItemId} />

      {quantity > 0 ? (
        <>
          <StepButton direction="remove" label={`One fewer ${dishName}`}>−</StepButton>
          <span className={`${styles.stepCount} tabular`} aria-live="polite">
            {quantity}
          </span>
        </>
      ) : null}

      <StepButton
        direction="add"
        label={quantity > 0 ? `One more ${dishName}` : `Add ${dishName} to your order`}
        primary={quantity === 0}
      >
        {quantity > 0 ? '+' : 'Add'}
      </StepButton>

      {/*
        Errors belong here rather than in a toast: the thing that failed is
        this dish, and "the kitchen has stopped taking orders" is only
        meaningful next to the dish somebody just tried to order.
      */}
      {state.error ? (
        <span className={styles.stepError} role="alert">{state.error}</span>
      ) : null}
    </form>
  );
}

function StepButton({
  direction,
  label,
  primary = false,
  children,
}: {
  direction: 'add' | 'remove';
  label: string;
  primary?: boolean;
  children: React.ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name="direction"
      value={direction}
      className={primary ? styles.stepAdd : styles.step}
      aria-label={label}
      /*
        Disabled while the form is in flight, both buttons. A guest double
        tapping plus on hotel wifi would otherwise queue two writes against a
        count they cannot see move yet — and unlike placing an order, which is
        protected by an idempotency key (#8), this one has no natural key to
        deduplicate on.
      */
      disabled={pending}
    >
      {children}
    </button>
  );
}
