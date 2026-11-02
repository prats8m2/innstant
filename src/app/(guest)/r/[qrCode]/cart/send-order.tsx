'use client';

import { useActionState, useEffect, useId, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { X } from 'lucide-react';
import { sendOrder, verifyAndSend, type CartEditState } from './actions';
import styles from './cart.module.css';

/**
 * The send button, and the one verification prompt behind it.
 *
 * `idempotencyKey` is minted on the server when this screen renders and passed
 * in, so both taps of a double-tap carry the SAME key (#8). Generating it here,
 * or in the action, would produce a different key per tap and would place two
 * orders — which is the exact failure the key exists to prevent.
 */
export function SendOrder({
  qrCode,
  idempotencyKey,
  total,
  roomNumber,
  deskPhone,
  /** The outlet has a minimum and this order is under it. */
  belowMinimum = false,
}: {
  qrCode: string;
  idempotencyKey: string;
  total: string;
  roomNumber: string;
  /** A `tel:` number for the front desk, or null — never invented. */
  deskPhone: string | null;
  belowMinimum?: boolean;
}) {
  const [state, action] = useActionState<CartEditState, FormData>(sendOrder, {});
  const [dismissed, setDismissed] = useState<string | null>(null);
  const reopenRef = useRef<HTMLButtonElement>(null);
  const closedOnce = useRef(false);

  const escalation = state.escalation ?? null;
  const promptOpen = escalation !== null && dismissed !== escalation.challengeId;

  // Closing the sheet hands focus back to the button that brings it back.
  useEffect(() => {
    if (!promptOpen && closedOnce.current) reopenRef.current?.focus();
  }, [promptOpen]);

  return (
    <>
      <div className={styles.sendBar}>
        {state.error ? (
          <p className={styles.notice} role="alert">{state.error}</p>
        ) : null}

        {escalation ? (
          /*
            The prompt was dismissed. Sending again re-opens the SAME challenge
            rather than starting another — the guest is answering one question,
            and the attempt count belongs to it.
          */
          <button
            ref={reopenRef}
            type="button"
            className={styles.send}
            onClick={() => setDismissed(null)}
          >
            <span>Send to the kitchen</span>
            <span className="tabular">{total}</span>
          </button>
        ) : (
          <form action={action}>
            <input type="hidden" name="qrCode" value={qrCode} />
            <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
            {/*
              Disabled, not hidden. A guest a few rupees short needs to see the
              button they are working towards — and the shortfall is printed
              above it. `placeOrder()` refuses regardless, so this is guidance
              rather than the rule.
            */}
            <SendButton total={total} disabled={belowMinimum} />
          </form>
        )}
      </div>

      {/* D-012: the one prompt in the product, and it appears HERE — at the
          first attempt to charge the room, not at the scan and not on the
          menu. */}
      {promptOpen ? (
        <VerifySheet
          qrCode={qrCode}
          total={total}
          roomNumber={roomNumber}
          deskPhone={deskPhone}
          initial={state}
          onClose={() => {
            closedOnce.current = true;
            setDismissed(escalation.challengeId);
          }}
        />
      ) : null}
    </>
  );
}

/**
 * The verification sheet (GuestCart.dc.html).
 *
 * Four digits, and then the order goes. It does not apologise, it does not
 * explain policy, and it says why it is asking — a guest who understands that
 * this protects THEIR folio answers it; a guest who is told "verification
 * required" closes the tab.
 *
 * The close button returns to the cart, which is unchanged; Send brings the
 * same question back. Nothing is lost by closing it, which is why it can be
 * offered.
 */
function VerifySheet({
  qrCode,
  total,
  roomNumber,
  deskPhone,
  initial,
  onClose,
}: {
  qrCode: string;
  total: string;
  roomNumber: string;
  deskPhone: string | null;
  initial: CartEditState;
  onClose: () => void;
}) {
  const [state, action] = useActionState<CartEditState, FormData>(verifyAndSend, initial);
  const escalation = state.escalation ?? initial.escalation!;
  const [digits, setDigits] = useState('');
  const titleId = useId();
  const whyId = useId();
  const errorId = useId();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div className={styles.scrim} aria-hidden="true" onClick={onClose} />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={whyId}
        className={styles.sheet}
      >
        <span className={styles.handle} aria-hidden="true" />

        <div className={styles.sheetHead}>
          <div className={styles.sheetLede}>
            <h2 id={titleId} className={styles.sheetTitle}>
              Charge to room <span className="tabular">{roomNumber}</span>
            </h2>
            <p id={whyId} className={styles.sheetWhy}>
              The last four digits of the phone number on your booking, so it
              only goes on your bill. We ask this once.
            </p>
          </div>
          <button type="button" className={styles.close} aria-label="Close" onClick={onClose}>
            <X size={22} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>

        <form action={action} className={styles.verify}>
          <input type="hidden" name="qrCode" value={qrCode} />
          <input type="hidden" name="challengeId" value={escalation.challengeId} />
          <input type="hidden" name="escalationId" value={escalation.escalationId} />
          <input type="hidden" name="idempotencyKey" value={escalation.idempotencyKey} />

          <DigitBoxes
            value={digits}
            onChange={setDigits}
            describedBy={state.error ? errorId : undefined}
          />

          {state.error ? (
            <p id={errorId} className={styles.verifyError} role="alert">{state.error}</p>
          ) : null}

          <p className={styles.help}>
            Not your phone, or changed numbers?{' '}
            {deskPhone ? (
              <a href={`tel:${deskPhone}`} className={styles.helpLink}>Call the desk</a>
            ) : (
              'The front desk can confirm it for you.'
            )}
          </p>

          <VerifyButton total={total} ready={digits.length === 4} />
        </form>
      </section>
    </>
  );
}

/**
 * Four boxes, one input.
 *
 * The boxes are drawn; the field is a single real `<input name="answer">`
 * laid over them, transparent. That is what keeps everything a four-input
 * widget has to re-implement working for free: one label, the numeric
 * keypad, paste of all four digits at once, backspace stepping back, the
 * phone's own autofill — and the same `answer` field the action has always
 * read. The box after the last digit is drawn as the caret.
 */
function DigitBoxes({
  value,
  onChange,
  describedBy,
}: {
  value: string;
  onChange: (next: string) => void;
  describedBy?: string;
}) {
  const id = useId();
  const [focused, setFocused] = useState(false);

  // The caret always lives at the end: the boxes have no way to show it
  // anywhere else, so a tap in the middle must not put it there.
  const toEnd = (el: HTMLInputElement) => {
    const end = el.value.length;
    if (el.selectionStart !== end || el.selectionEnd !== end) el.setSelectionRange(end, end);
  };

  return (
    <div className={styles.digits}>
      <label htmlFor={id} className={styles.srOnly}>Last four digits</label>
      <input
        id={id}
        name="answer"
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        required
        autoFocus
        className={styles.digitInput}
        value={value}
        aria-describedby={describedBy}
        onChange={(e) => {
          const raw = e.target.value.replace(/\D/g, '');
          // A pasted whole number ("+91 98290 01111") means its last four; a
          // fifth digit typed into a full box is ignored. No `maxLength`: it
          // would cut a paste before it could be read.
          onChange(raw.length > 4 && raw.length - value.length > 1 ? raw.slice(-4) : raw.slice(0, 4));
        }}
        onFocus={(e) => {
          setFocused(true);
          toEnd(e.currentTarget);
        }}
        onBlur={() => setFocused(false)}
        onSelect={(e) => toEnd(e.currentTarget)}
      />
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className={`${styles.digit} tabular`}
          aria-hidden="true"
          data-filled={i < value.length}
          data-active={focused && i === Math.min(value.length, 3) && value.length < 4}
        >
          {value[i] ?? ''}
        </span>
      ))}
    </div>
  );
}

function VerifyButton({ total, ready }: { total: string; ready: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={styles.send} disabled={pending || !ready}>
      <span>{pending ? 'Checking…' : 'Confirm and send'}</span>
      <span className="tabular">{total}</span>
    </button>
  );
}

function SendButton({ total, disabled = false }: { total: string; disabled?: boolean }) {
  // useFormStatus must be inside the form — hence the split.
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={styles.send}
      disabled={pending || disabled}
      // `:disabled` alone would give this the pending cursor, which says
      // "loading" when the truth is "not yet".
      data-blocked={disabled && !pending}
    >
      <span>{pending ? 'Sending…' : 'Send to the kitchen'}</span>
      <span className="tabular">{total}</span>
    </button>
  );
}
