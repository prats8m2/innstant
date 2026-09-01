'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import type { RequestTypeCard } from '@/modules/requests';
import { formatMoney, money } from '@/lib/money';
import { sendRequests, verifyAndSend, type RequestActionState } from './actions';
import styles from './amenities.module.css';

/**
 * The list, and the pill that sends it.
 *
 * ─── Why the quantities are client state and the send is a form post ────────
 *
 * The steppers have to move without a round trip — tapping + three times on
 * hotel wifi and waiting each time is the difference between a usable screen
 * and one nobody finishes. So quantity is `useState`, and every row also
 * renders a hidden input, which means the whole screen still posts as one form
 * if JavaScript never arrives.
 *
 * There is no cart table behind this on purpose. A cart exists for food because
 * a guest browses a menu over several minutes; nobody browses towels.
 */
/**
 * The four categories, in the order a guest wants them.
 *
 * Twenty-two rows in one flat list is a 8,600-pixel screen — the reference draws
 * eight. The categories are already on every row (`request_types.category`), so
 * the headings cost nothing and the order is a product decision: the things
 * people ask for most, then the room, then what is broken, then what costs.
 */
const GROUPS = [
  { category: 'AMENITY', heading: 'Bring me' },
  { category: 'HOUSEKEEPING', heading: 'The room' },
  { category: 'MAINTENANCE', heading: 'Something is not working' },
  { category: 'SERVICE', heading: 'Services' },
] as const;

export function AmenityForm({
  qrCode,
  idempotencyKey,
  catalog,
  roomNumber,
}: {
  qrCode: string;
  idempotencyKey: string;
  catalog: RequestTypeCard[];
  roomNumber: string;
}) {
  const [state, action] = useActionState<RequestActionState, FormData>(sendRequests, {});
  const [quantities, setQuantities] = useState<Record<string, number>>({});

  const chosen = catalog
    .map((card) => ({ card, quantity: quantities[card.id] ?? 0 }))
    .filter(({ quantity }) => quantity > 0);

  const totalMinor = chosen.reduce(
    (sum, { card, quantity }) => sum + card.priceMinor * quantity,
    0,
  );
  const currency = catalog[0]?.currency ?? 'INR';

  if (state.escalation) {
    return (
      <VerifyPrompt
        qrCode={qrCode}
        roomNumber={roomNumber}
        initial={state}
      />
    );
  }

  const set = (id: string, next: number) =>
    setQuantities((current) => ({ ...current, [id]: Math.max(0, next) }));

  return (
    <form action={action} className={styles.form}>
      <input type="hidden" name="qrCode" value={qrCode} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

      <p className={styles.lede}>
        Ask for as much as you like. Anything with a price says so before you send it.
      </p>

      {GROUPS.map(({ category, heading }) => {
        const inGroup = catalog.filter((card) => card.category === category);
        if (!inGroup.length) return null;

        return (
        <section key={category} className={styles.group}>
          <h2 className={styles.groupHeading}>{heading}</h2>
          <ul className={styles.list}>
        {inGroup.map((card) => {
          const quantity = quantities[card.id] ?? 0;
          return (
            <li key={card.id} className={styles.row}>
              <span className={styles.rowHead}>
                <span className={styles.rowBody}>
                  <span className={styles.name}>{card.name}</span>
                  <span className={styles.eta}>Usually {card.slaMinutes} minutes</span>
                </span>
                <span className={card.isChargeable ? styles.price : styles.free}>
                  {card.isChargeable
                    ? formatMoney(money(card.priceMinor, card.currency))
                    : 'No charge'}
                </span>
              </span>

              {/* Posted whatever happens, so the screen works with no JS. */}
              <input type="hidden" name={`qty-${card.id}`} value={quantity} />

              <span className={styles.controls}>
                {card.allowsQuantity ? (
                  <span className={styles.stepper}>
                    <button
                      type="button"
                      className={styles.step}
                      onClick={() => set(card.id, quantity - 1)}
                      disabled={quantity === 0}
                      aria-label={`One fewer ${card.name}`}
                    >
                      −
                    </button>
                    <span className={`${styles.qty} tabular`} aria-live="polite">
                      {quantity}
                    </span>
                    <button
                      type="button"
                      className={styles.step}
                      onClick={() => set(card.id, Math.min(card.maxQuantity, quantity + 1))}
                      disabled={quantity >= card.maxQuantity}
                      aria-label={`One more ${card.name}`}
                    >
                      +
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    className={styles.toggle}
                    data-on={quantity > 0}
                    onClick={() => set(card.id, quantity > 0 ? 0 : 1)}
                    aria-pressed={quantity > 0}
                  >
                    {quantity > 0 ? 'Asked for' : 'Ask'}
                  </button>
                )}
              </span>
            </li>
          );
        })}
          </ul>
        </section>
        );
      })}

      <label className={styles.noteField}>
        <span className={styles.noteLabel}>Anything we should know?</span>
        <input
          name="guestNote"
          className={styles.note}
          maxLength={400}
          placeholder="Leave it by the door is fine"
        />
      </label>

      {state.error ? <p className={styles.error} role="alert">{state.error}</p> : null}

      {/*
        The pill. Idle it says the desk is awake; with something chosen it is the
        way to send, and it says what will be charged BEFORE the guest commits —
        which is the promise the line at the top makes.
      */}
      {chosen.length ? (
        <div className={styles.pillWrap}>
          <SendButton
            line={`${chosen.reduce((n, c) => n + c.quantity, 0)} to room ${roomNumber}`}
            charge={totalMinor > 0
              ? `${formatMoney(money(totalMinor, currency))} on your folio`
              : 'Nothing to pay'}
          />
        </div>
      ) : (
        <p className={styles.pillIdle}>
          <span className={styles.pillDot} aria-hidden="true" />
          Housekeeping is awake
        </p>
      )}
    </form>
  );
}

function SendButton({ line, charge }: { line: string; charge: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={styles.send} disabled={pending}>
      <span className={styles.sendBody}>
        <span className={styles.sendLine}>{pending ? 'Sending…' : `Send ${line}`}</span>
        <span className={styles.sendCharge}>{charge}</span>
      </span>
      <span className={styles.sendArrow} aria-hidden="true">→</span>
    </button>
  );
}

/**
 * The one prompt, when the guest picked something that costs.
 *
 * Identical in shape to the cart's, deliberately: a guest who has answered this
 * once for dinner should recognise it, and there is exactly one of these in the
 * product (D-012).
 */
function VerifyPrompt({
  qrCode,
  roomNumber,
  initial,
}: {
  qrCode: string;
  roomNumber: string;
  initial: RequestActionState;
}) {
  const [state, action] = useActionState<RequestActionState, FormData>(verifyAndSend, initial);
  const escalation = state.escalation ?? initial.escalation!;

  return (
    <form action={action} className={styles.verify}>
      <input type="hidden" name="qrCode" value={qrCode} />
      <input type="hidden" name="challengeId" value={escalation.challengeId} />
      <input type="hidden" name="escalationId" value={escalation.escalationId} />
      <input type="hidden" name="idempotencyKey" value={escalation.idempotencyKey} />
      <input type="hidden" name="payload" value={escalation.payload} />

      <p className={styles.verifyWhy}>
        {initial.escalation?.total
          ? `${initial.escalation.total} goes on room ${roomNumber}.`
          : `This goes on room ${roomNumber}.`}
        {' '}The last four digits of the phone number on the booking, so we know it
        is you.
      </p>

      <input
        name="answer"
        className={styles.answer}
        inputMode="numeric"
        autoComplete="off"
        maxLength={4}
        placeholder="1111"
        aria-label="Last four digits of the booking phone number"
        autoFocus
      />

      {state.error ? <p className={styles.error} role="alert">{state.error}</p> : null}

      <ConfirmButton />
    </form>
  );
}

function ConfirmButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={styles.send} disabled={pending}>
      <span className={styles.sendBody}>
        <span className={styles.sendLine}>{pending ? 'Sending…' : 'Confirm and send'}</span>
      </span>
    </button>
  );
}
