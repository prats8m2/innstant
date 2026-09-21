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
  shortlistIds,
  roomNumber,
}: {
  qrCode: string;
  idempotencyKey: string;
  catalog: RequestTypeCard[];
  /** The six the property's guests ask for most — see `shortlistForChips()`. */
  shortlistIds: string[];
  roomNumber: string;
}) {
  const [state, action] = useActionState<RequestActionState, FormData>(sendRequests, {});
  const [quantities, setQuantities] = useState<Record<string, number>>({});

  /** Resolved here rather than passed twice — the ids are the whole payload. */
  const shortlist = shortlistIds
    .map((id) => catalog.find((card) => card.id === id))
    .filter((card): card is RequestTypeCard => card !== undefined);

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
        Tap what you need. Everything is free unless it shows a price.
      </p>

      {/*
        The fast path. Most of the time a guest wants one of six things, and
        making them read twenty-two rows to find a towel is the whole problem
        with the screen this replaces.

        A chip is one tap = one of that thing. Tapping again adds another
        rather than removing it, because a guest reaching for "extra towels"
        twice means two towels — and the count on the chip, plus the same row
        further down, are both there to undo it.
      */}
      {shortlist.length ? (
        <section className={styles.quick}>
          <h2 className={styles.quickHeading}>Most asked for</h2>
          <ul className={styles.chips}>
            {shortlist.map((card) => {
              const quantity = quantities[card.id] ?? 0;
              return (
                <li key={card.id}>
                  <button
                    type="button"
                    className={styles.chip}
                    data-on={quantity > 0}
                    onClick={() => set(card.id, Math.min(card.maxQuantity, quantity + 1))}
                    aria-label={
                      quantity > 0
                        ? `${card.name}, ${quantity} asked for. Tap for one more.`
                        : `Ask for ${card.name}`
                    }
                  >
                    {card.name}
                    {quantity > 0 ? (
                      <span className={`${styles.chipCount} tabular`}>{quantity}</span>
                    ) : null}
                    {card.isChargeable ? (
                      <span className={styles.chipPrice}>
                        {formatMoney(money(card.priceMinor, card.currency))}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

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
            <li key={card.id} className={styles.row} data-chosen={quantity > 0}>
              {/*
                One line, not two.

                It was: name + "No charge" on the first line, "Usually 15
                minutes" + the control on the second. Twenty-two rows of that
                is three and a half phone screens, and twenty of them said "No
                charge" — the same non-fact, in caps, twenty times.

                Free rows now show NO price at all, which is what the line at
                the top promises, and the wait sits next to the name as small
                meta rather than owning a line of its own.
              */}
              <span className={styles.rowText}>
                <span className={styles.name}>{card.name}</span>
                <span className={styles.meta}>
                  {card.isChargeable ? (
                    <span className={styles.price}>
                      {formatMoney(money(card.priceMinor, card.currency))}
                    </span>
                  ) : null}
                  <span className={styles.eta}>{formatWait(card.slaMinutes)}</span>
                </span>
              </span>

              {/* Posted whatever happens, so the screen works with no JS. */}
              <input type="hidden" name={`qty-${card.id}`} value={quantity} />

              <span className={styles.rowControl}>
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

/**
 * "15 min", "4 hours". The wait, short enough to sit beside a name.
 *
 * It used to read "Usually 45 minutes" on its own line, which is a lot of
 * words for a number that only answers "should I bother". Laundry is 240
 * minutes, and "Usually 240 minutes" is a sum the guest has to do.
 */
function formatWait(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  return `${hours} hr${hours === 1 ? '' : 's'}`;
}
