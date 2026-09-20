'use client';

import Link from 'next/link';
import { useActionState, useMemo, useState } from 'react';
import { useFormStatus } from 'react-dom';
import type { DishModifierGroup } from '@/modules/catalog';
import { formatMoney, money, type CurrencyCode } from '@/lib/money';
import { addToOrder, type AddToOrderState } from './actions';
import styles from './dish.module.css';

/**
 * The orderable part of the dish screen: modifiers, quantity, note, and the
 * button that says what it will cost.
 *
 * Client-side because the button total has to move as you choose — that number
 * is the whole reason the screen is not a static page. Everything it decides is
 * re-decided on the server in `addToCart()`; this is presentation.
 *
 * Modifiers are real radio and checkbox inputs under styled labels, not
 * buttons with `aria-checked`. A radio group is arrow-keyable, announces its
 * name and position, and posts its value without JavaScript — none of which
 * comes free with a div that looks like one.
 */
export function DishForm({
  qrCode,
  dish,
  groups,
  currency,
  isOrderable,
  cart,
}: {
  qrCode: string;
  dish: { id: string; priceMinor: number };
  groups: DishModifierGroup[];
  currency: CurrencyCode;
  isOrderable: boolean;
  /** Null when the order is empty — then there is nothing to review. */
  cart: { itemCount: number; total: string } | null;
}) {
  const [state, formAction] = useActionState<AddToOrderState, FormData>(addToOrder, {});

  const [selection, setSelection] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(
      groups.map((g) => [g.id, g.options.filter((o) => o.isDefault).map((o) => o.id)]),
    ),
  );
  const [quantity, setQuantity] = useState(1);

  const modifiersMinor = useMemo(() => {
    const chosen = new Set(Object.values(selection).flat());
    return groups
      .flatMap((g) => g.options)
      .filter((o) => chosen.has(o.id))
      .reduce((sum, o) => sum + o.priceDeltaMinor, 0);
  }, [groups, selection]);

  const total = money((dish.priceMinor + modifiersMinor) * quantity, currency);

  const pick = (group: DishModifierGroup, optionId: string, checked: boolean) => {
    setSelection((prev) => {
      const current = prev[group.id] ?? [];
      if (group.maxSelections === 1) return { ...prev, [group.id]: [optionId] };
      const next = checked
        ? [...current, optionId].slice(-group.maxSelections)
        : current.filter((id) => id !== optionId);
      return { ...prev, [group.id]: next };
    });
  };

  return (
    <form action={formAction} className={styles.form}>
      <input type="hidden" name="qrCode" value={qrCode} />
      <input type="hidden" name="menuItemId" value={dish.id} />
      {Object.values(selection).flat().map((optionId) => (
        <input key={optionId} type="hidden" name="modifierOptionIds" value={optionId} />
      ))}

      {groups.map((group) => (
        <fieldset key={group.id} className={styles.group}>
          <legend className={styles.groupLabel}>{group.name}</legend>
          <div className={styles.chips}>
            {group.options.map((option) => {
              const checked = (selection[group.id] ?? []).includes(option.id);
              return (
                <label
                  key={option.id}
                  className={styles.chip}
                  data-checked={checked}
                  data-sold-out={!option.isAvailable}
                >
                  <input
                    type={group.maxSelections === 1 ? 'radio' : 'checkbox'}
                    name={`group-${group.id}`}
                    className={styles.chipInput}
                    checked={checked}
                    disabled={!option.isAvailable}
                    onChange={(e) => pick(group, option.id, e.target.checked)}
                  />
                  <span>{option.name}</span>
                  {option.priceDeltaMinor !== 0 ? (
                    <span className={`${styles.chipPrice} tabular`}>
                      {option.priceDeltaMinor > 0 ? '+' : '−'}
                      {formatMoney(money(Math.abs(option.priceDeltaMinor), currency))}
                    </span>
                  ) : null}
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}

      <div className={styles.quantity}>
        <span className={styles.groupLabel} id="how-many">How many</span>
        <div className={styles.stepper} role="group" aria-labelledby="how-many">
          <button
            type="button"
            className={styles.step}
            aria-label="One fewer"
            onClick={() => setQuantity((q) => Math.max(1, q - 1))}
            disabled={quantity <= 1}
          >
            −
          </button>
          <output className={`${styles.count} tabular`} aria-label="Quantity">{quantity}</output>
          <button
            type="button"
            className={styles.step}
            aria-label="One more"
            onClick={() => setQuantity((q) => Math.min(20, q + 1))}
            disabled={quantity >= 20}
          >
            +
          </button>
        </div>
        <input type="hidden" name="quantity" value={quantity} />
      </div>

      <label className={styles.noteLabel}>
        <span className={styles.groupLabel}>Anything the kitchen should know</span>
        <textarea
          name="notes"
          rows={2}
          maxLength={280}
          className={styles.note}
          placeholder="No coriander, please."
        />
      </label>

      {state.error ? (
        <p className={styles.error} role="alert">{state.error}</p>
      ) : null}
      {state.addedAt ? (
        <p className={styles.added} role="status">Added to your order.</p>
      ) : null}

      <div className={styles.addBar}>
        {/*
          The way into the cart, from the screen where things go INTO it.

          Adding a dish used to leave a guest on this screen with a line of
          text saying it had worked and no way to see what they had built —
          the only route to the cart was back to the menu and then the pill at
          the bottom of it. Two navigations to answer "what have I ordered so
          far", on the screen where the question occurs to you.

          It lives inside the pinned bar rather than as a second floating pill,
          because this screen already pins one thing and two bars stacked at a
          thumb is how the wrong one gets tapped. Secondary styling on purpose:
          the primary action on a dish screen is still adding the dish.

          A link, not a button — the cart is a real route, and it must work
          with no JavaScript, which is also why it sits outside the submit.
        */}
        {cart ? (
          <Link href={`/r/${encodeURIComponent(qrCode)}/cart`} className={styles.review}>
            <span className={`${styles.reviewCount} tabular`}>{cart.itemCount}</span>
            <span className={styles.reviewLabel}>Review order</span>
            <span className={`${styles.reviewTotal} tabular`}>{cart.total}</span>
            <span className={styles.reviewArrow} aria-hidden="true">→</span>
          </Link>
        ) : null}

        <SubmitButton total={formatMoney(total)} disabled={!isOrderable} />
      </div>
    </form>
  );
}

function SubmitButton({ total, disabled }: { total: string; disabled: boolean }) {
  // `useFormStatus` has to be in a child of the form — that is the whole reason
  // this is its own component.
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={styles.add} disabled={disabled || pending}>
      <span>{disabled ? 'Off the menu tonight' : pending ? 'Adding…' : 'Add to order'}</span>
      {disabled ? null : <span className={`${styles.addTotal} tabular`}>{total}</span>}
    </button>
  );
}
