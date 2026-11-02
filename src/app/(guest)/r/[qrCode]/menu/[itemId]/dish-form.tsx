'use client';

import Link from 'next/link';
import { useActionState, useMemo, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { ArrowRight, Check, Minus, Plus } from 'lucide-react';
import type { DishModifierGroup } from '@/modules/catalog';
import { formatMoney, money, type CurrencyCode } from '@/lib/money';
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
 * comes free with a div that looks like one. Direction A draws a one-choice
 * group ("Heat") as a row of equal boxes and a many-choice group ("Add to it")
 * as a list of ticks; the inputs underneath are the same.
 *
 * ─── One form, two flows ───────────────────────────────────────────────────
 *
 * The room and the property link (D-079) each have their own `addToOrder`,
 * because each resolves its own session. The page passes its action in, with
 * the one hidden field that action reads (`qrCode` or `code`) and where its
 * cart lives.
 */
export interface AddToOrderResult {
  /** Shown to the guest. Says what happened and what to do (CLAUDE.md). */
  error?: string;
  addedAt?: number;
}

export type AddToOrderAction = (
  previous: AddToOrderResult,
  formData: FormData,
) => Promise<AddToOrderResult>;

export function DishForm({
  action: add,
  scope,
  cartHref,
  dish,
  groups,
  currency,
  isOrderable,
  cart,
}: {
  action: AddToOrderAction;
  scope: { name: 'qrCode' | 'code'; value: string };
  cartHref: string;
  dish: { id: string; priceMinor: number };
  groups: DishModifierGroup[];
  currency: CurrencyCode;
  isOrderable: boolean;
  /** Null when the order is empty — then there is nothing to review. */
  cart: { itemCount: number; total: string } | null;
}) {
  const [state, formAction] = useActionState<AddToOrderResult, FormData>(add, {});

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

  const delta = (minor: number) =>
    `${minor > 0 ? '+' : '−'}${formatMoney(money(Math.abs(minor), currency))}`;

  return (
    <form action={formAction} className={styles.form}>
      <input type="hidden" name={scope.name} value={scope.value} />
      <input type="hidden" name="menuItemId" value={dish.id} />
      <input type="hidden" name="quantity" value={quantity} />
      {Object.values(selection).flat().map((optionId) => (
        <input key={optionId} type="hidden" name="modifierOptionIds" value={optionId} />
      ))}

      {groups.map((group) => {
        const single = group.maxSelections === 1;
        return (
          <fieldset key={group.id} className={styles.group}>
            <legend className={styles.legend}>{group.name}</legend>
            <div className={single ? styles.choices : styles.ticks}>
              {group.options.map((option) => {
                const checked = (selection[group.id] ?? []).includes(option.id);
                return (
                  <label
                    key={option.id}
                    className={single ? styles.choice : styles.tick}
                    data-checked={checked}
                    data-sold-out={!option.isAvailable}
                  >
                    <input
                      type={single ? 'radio' : 'checkbox'}
                      name={`group-${group.id}`}
                      className={styles.hiddenInput}
                      checked={checked}
                      disabled={!option.isAvailable}
                      onChange={(e) => pick(group, option.id, e.target.checked)}
                    />
                    {single ? null : (
                      <span className={styles.box} aria-hidden="true">
                        {checked ? <Check size={14} strokeWidth={2} /> : null}
                      </span>
                    )}
                    <span className={styles.optionName}>{option.name}</span>
                    {option.priceDeltaMinor !== 0 ? (
                      <span className={`${styles.optionPrice} tabular`}>
                        {delta(option.priceDeltaMinor)}
                      </span>
                    ) : null}
                  </label>
                );
              })}
            </div>
          </fieldset>
        );
      })}

      <label className={styles.noteField}>
        <span className={styles.legend}>Anything the kitchen should know</span>
        <textarea
          name="notes"
          rows={2}
          maxLength={280}
          className={styles.noteInput}
          placeholder="No coriander, please."
        />
      </label>

      {/* Pinned in the thumb zone (the board's foot): what happened, the way
          into the cart once there is one, then the count and the button. */}
      <div className={styles.bar}>
        {state.error ? (
          <p className={styles.error} role="alert">{state.error}</p>
        ) : null}
        {state.addedAt ? (
          <p className={styles.added} role="status">Added to your order.</p>
        ) : null}

        {/*
          The way into the cart, from the screen where things go INTO it. A
          link, not a button — the cart is a real route, and it must work with
          no JavaScript. Quieter than Add on purpose: the primary action on a
          dish screen is still adding the dish.
        */}
        {cart ? (
          <Link href={cartHref} className={styles.review}>
            <span>Review order</span>
            <span className={styles.reviewFacts}>
              <span className="tabular">
                {cart.itemCount} {cart.itemCount === 1 ? 'dish' : 'dishes'} · {cart.total}
              </span>
              <ArrowRight size={18} strokeWidth={1.5} aria-hidden="true" />
            </span>
          </Link>
        ) : null}

        <div className={styles.barRow}>
          <div className={styles.stepper} role="group" aria-label="How many">
            <button
              type="button"
              className={styles.step}
              aria-label="One fewer"
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              disabled={quantity <= 1}
            >
              <Minus size={20} strokeWidth={1.5} aria-hidden="true" />
            </button>
            <output className={`${styles.count} tabular`} aria-label="Quantity" aria-live="polite">
              {quantity}
            </output>
            <button
              type="button"
              className={styles.step}
              data-more
              aria-label="One more"
              onClick={() => setQuantity((q) => Math.min(20, q + 1))}
              disabled={quantity >= 20}
            >
              <Plus size={20} strokeWidth={1.5} aria-hidden="true" />
            </button>
          </div>

          <SubmitButton total={formatMoney(total)} disabled={!isOrderable} />
        </div>
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
      {disabled ? null : <span className="tabular">{total}</span>}
    </button>
  );
}
