'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Check, Minus, Plus } from 'lucide-react';
import type { RequestTypeCard } from '@/modules/requests';
import { formatMoney, money } from '@/lib/money';
import { sendRequests, verifyAndSend, type RequestActionState } from './actions';
import styles from './amenities.module.css';

/**
 * The list, and the button that sends it.
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
 * The four categories, in the order a guest wants them: the things people ask
 * for most, then the room, then what is broken, then what costs.
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

  const count = chosen.reduce((n, c) => n + c.quantity, 0);
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
    <form action={action} className={styles.form} data-sending={chosen.length > 0}>
      <input type="hidden" name="qrCode" value={qrCode} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

      {/*
        The fast path (D-071). Most of the time a guest wants one of six
        things. A chip is one tap = one of that thing; tapping again adds
        another, and the row further down is there to undo it.

        Not on the board, which draws a short list; this property's list is
        twenty-odd rows, and these are what the chips are for. One scrolling
        line of them, so they cost the list a single row of height.
      */}
      {shortlist.length ? (
        <section className={styles.quick} aria-labelledby="most-asked">
          <h2 className={styles.eyebrow} id="most-asked">Most asked for</h2>
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
                      <span className={`${styles.chipPrice} tabular`}>
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
            <h2 className={styles.eyebrow}>{heading}</h2>
            <ul className={styles.list}>
              {inGroup.map((card) => (
                <Row
                  key={card.id}
                  card={card}
                  quantity={quantities[card.id] ?? 0}
                  onChange={(next) => set(card.id, next)}
                />
              ))}
            </ul>
          </section>
        );
      })}

      <label className={styles.noteField}>
        <span className={styles.eyebrow}>Anything we should know?</span>
        <input
          name="guestNote"
          className={styles.input}
          maxLength={400}
          placeholder="Leave it by the door is fine"
        />
      </label>

      {state.error ? <p className={styles.error} role="alert">{state.error}</p> : null}

      {/*
        The one button, pinned, once there is something to send. It says what
        will be charged BEFORE the guest commits — the promise the line at the
        top makes.
      */}
      {chosen.length ? (
        <div className={styles.footer}>
          {totalMinor > 0 ? (
            <p className={styles.footerCharge}>
              <span className="tabular">{formatMoney(money(totalMinor, currency))}</span>
              {' '}goes on your room bill
            </p>
          ) : null}
          <SendButton count={count} roomNumber={roomNumber} />
        </div>
      ) : null}
    </form>
  );
}

/**
 * One row: the name, what it costs and how long it takes, and its control.
 *
 * The board's stepper: a lone + until something is chosen, then − n +. A row
 * that cannot be counted (a wake-up call, cleaning the room) is a single +
 * that becomes a tick — pressed or not, the same button.
 */
function Row({
  card,
  quantity,
  onChange,
}: {
  card: RequestTypeCard;
  quantity: number;
  onChange: (next: number) => void;
}) {
  const atMax = quantity >= card.maxQuantity;
  const meta = [
    `Usually ${formatWait(card.slaMinutes)}`,
    card.allowsQuantity && card.maxQuantity > 1 && card.maxQuantity < 10
      ? `up to ${card.maxQuantity}`
      : null,
  ].filter(Boolean).join(' · ');

  return (
    <li className={styles.row} data-chosen={quantity > 0}>
      <span className={styles.rowText}>
        <span className={styles.name}>{card.name}</span>
        <span className={styles.meta}>
          {card.isChargeable ? (
            <>
              <span className={`${styles.price} tabular`}>
                {formatMoney(money(card.priceMinor, card.currency))}
              </span>
              {' · '}
            </>
          ) : null}
          {meta}
        </span>
      </span>

      {/* Posted whatever happens, so the screen works with no JS. */}
      <input type="hidden" name={`qty-${card.id}`} value={quantity} />

      {card.allowsQuantity ? (
        <span className={styles.stepper}>
          {quantity > 0 ? (
            <>
              <button
                type="button"
                className={styles.step}
                onClick={() => onChange(quantity - 1)}
                aria-label={`One fewer ${card.name}`}
              >
                <Minus size={20} strokeWidth={1.5} aria-hidden="true" />
              </button>
              <span className={`${styles.qty} tabular`} aria-live="polite">{quantity}</span>
            </>
          ) : null}
          <button
            type="button"
            className={styles.step}
            data-primary="true"
            onClick={() => onChange(Math.min(card.maxQuantity, quantity + 1))}
            disabled={atMax}
            aria-label={atMax ? `One more ${card.name}, limit reached` : `One more ${card.name}`}
          >
            <Plus size={20} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </span>
      ) : (
        <button
          type="button"
          className={styles.step}
          data-primary="true"
          data-on={quantity > 0}
          onClick={() => onChange(quantity > 0 ? 0 : 1)}
          aria-pressed={quantity > 0}
          aria-label={`Add ${card.name}`}
        >
          {quantity > 0
            ? <Check size={20} strokeWidth={1.75} aria-hidden="true" />
            : <Plus size={20} strokeWidth={1.5} aria-hidden="true" />}
        </button>
      )}
    </li>
  );
}

/**
 * "Send 2 · to room 214". The accessible name reads "Send 2 to room 214" — the
 * space between the halves is explicit, so the two spans do not run together.
 */
function SendButton({ count, roomNumber }: { count: number; roomNumber: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={styles.send} disabled={pending}>
      <span>{pending ? 'Sending…' : `Send ${count}`}</span>
      {' '}
      <span className={styles.sendTo}>
        to room <span className="tabular">{roomNumber}</span>
      </span>
    </button>
  );
}

/**
 * The one prompt, when the guest picked something that costs.
 *
 * Identical in shape to the cart's, deliberately: a guest who has answered this
 * once for dinner should recognise it, and there is exactly one of these in the
 * product (D-012). Drawn as Direction A's bottom-sheet card.
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

      <h2 className={styles.verifyTitle}>
        Charge to room <span className="tabular">{roomNumber}</span>
      </h2>
      <p className={styles.verifyWhy}>
        {initial.escalation?.total
          ? `${initial.escalation.total} goes on room ${roomNumber}.`
          : `This goes on room ${roomNumber}.`}
        {' '}The last four digits of the phone number on the booking, so we know it
        is you.
      </p>

      <input
        name="answer"
        className={`${styles.answer} tabular`}
        inputMode="numeric"
        autoComplete="off"
        maxLength={4}
        placeholder="····"
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
    <button type="submit" className={styles.send} data-centred="true" disabled={pending}>
      {pending ? 'Sending…' : 'Confirm and send'}
    </button>
  );
}

/**
 * "12 min", "4 hrs". The wait, short enough to sit under a name. "Usually 240
 * minutes" is a sum the guest has to do.
 */
function formatWait(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  return `${hours} hr${hours === 1 ? '' : 's'}`;
}
