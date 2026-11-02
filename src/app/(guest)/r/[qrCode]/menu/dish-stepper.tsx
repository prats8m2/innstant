'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Minus, Plus } from 'lucide-react';
import styles from './menu.module.css';

/**
 * Add and remove, on the menu card, without opening the dish.
 *
 * ─── Why this is a form and not an onClick ─────────────────────────────────
 *
 * The cart is a table, not client state — unlike the amenities screen, where
 * quantity lives in `useState` until the guest sends. So every tap here is a
 * write, and a write from our own UI is a Server Action (CLAUDE.md
 * "Conventions"). It also means the control keeps working with no JavaScript:
 * two buttons in a form, each posting its own direction.
 *
 * ─── One component, two flows ──────────────────────────────────────────────
 *
 * A room and a property link (D-079) resolve different sessions and scope to
 * different contexts, so each has its own action — `adjustDishInOrder` here,
 * the visit's in `/p/[code]/menu/actions.ts`. The page that renders the
 * stepper passes its own action in, together with the one hidden field that
 * action reads (`qrCode` or `code`). There used to be two copies of this file
 * that differed in exactly those two lines.
 *
 * ─── Why the whole card is not the button ──────────────────────────────────
 *
 * The card is a link into the dish, and it stays one. A guest who wants the
 * chilli mild, a note on the order, or simply to read the description taps
 * the card; a guest who wants one more of what the kitchen makes taps the
 * plus.
 */
export interface QuickAdjustResult {
  /** Shown on the card. Says what happened and what to do (CLAUDE.md). */
  error?: string;
}

export type QuickAdjustAction = (
  previous: QuickAdjustResult,
  formData: FormData,
) => Promise<QuickAdjustResult>;

export function DishStepper({
  action: adjust,
  scope,
  menuItemId,
  quantity,
  dishName,
}: {
  action: QuickAdjustAction;
  /** The hidden field the action reads its link from: `qrCode` or `code`. */
  scope: { name: 'qrCode' | 'code'; value: string };
  menuItemId: string;
  /** How many of this dish are in the cart, across every variant of it. */
  quantity: number;
  dishName: string;
}) {
  const [state, action] = useActionState<QuickAdjustResult, FormData>(adjust, {});

  return (
    <form action={action} className={styles.stepper} data-on={quantity > 0}>
      <input type="hidden" name={scope.name} value={scope.value} />
      <input type="hidden" name="menuItemId" value={menuItemId} />

      {quantity > 0 ? (
        <>
          <StepButton direction="remove" label={`One fewer ${dishName}`}>
            <Minus size={20} strokeWidth={1.5} aria-hidden="true" />
          </StepButton>
          <span className={`${styles.stepCount} tabular`} aria-live="polite">
            {quantity}
          </span>
        </>
      ) : null}

      <StepButton
        direction="add"
        label={quantity > 0 ? `One more ${dishName}` : `Add ${dishName} to your order`}
      >
        <Plus size={20} strokeWidth={1.5} aria-hidden="true" />
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
  children,
}: {
  direction: 'add' | 'remove';
  label: string;
  children: React.ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name="direction"
      value={direction}
      className={styles.step}
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
