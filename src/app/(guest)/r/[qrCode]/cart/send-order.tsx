'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { sendOrder, verifyAndSend, type CartEditState } from './actions';
import styles from './cart.module.css';

/**
 * The send button.
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
}: {
  qrCode: string;
  idempotencyKey: string;
  total: string;
  roomNumber: string;
}) {
  const [state, action] = useActionState<CartEditState, FormData>(sendOrder, {});

  // D-012: the one prompt in the product, and it appears HERE — at the first
  // attempt to charge the room, not at the scan and not on the menu.
  if (state.escalation) {
    return (
      <VerifyPrompt
        qrCode={qrCode}
        total={total}
        roomNumber={roomNumber}
        initial={state}
      />
    );
  }

  return (
    <form action={action}>
      <input type="hidden" name="qrCode" value={qrCode} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

      {state.error ? (
        <p className={styles.warning} role="alert">{state.error}</p>
      ) : null}

      <SendButton total={total} roomNumber={roomNumber} />
    </form>
  );
}

/**
 * The verification prompt.
 *
 * Four digits, and then the order goes. It does not apologise, it does not
 * explain policy, and it says why it is asking — a guest who understands that
 * this protects THEIR folio answers it; a guest who is told "verification
 * required" closes the tab.
 *
 * There is no cancel button by design: the way out is the browser's back
 * gesture, and the cart is still there when they return. A prominent "not now"
 * next to a four-digit field is an invitation to abandon the order.
 */
function VerifyPrompt({
  qrCode,
  total,
  roomNumber,
  initial,
}: {
  qrCode: string;
  total: string;
  roomNumber: string;
  initial: CartEditState;
}) {
  const [state, action] = useActionState<CartEditState, FormData>(verifyAndSend, initial);
  const escalation = state.escalation ?? initial.escalation!;

  return (
    <form action={action} className={styles.verify}>
      <input type="hidden" name="qrCode" value={qrCode} />
      <input type="hidden" name="challengeId" value={escalation.challengeId} />
      <input type="hidden" name="escalationId" value={escalation.escalationId} />
      <input type="hidden" name="idempotencyKey" value={escalation.idempotencyKey} />

      <p className={styles.verifyWhy}>
        Charging {total} to room {roomNumber}. The last four digits of the phone
        number on your booking, so it only goes on your bill.
      </p>

      <label className={styles.verifyLabel}>
        <span className={styles.verifyLabelText}>Last four digits</span>
        <input
          name="answer"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          pattern="[0-9]*"
          maxLength={4}
          required
          autoFocus
          className={`${styles.verifyInput} tabular`}
          aria-describedby={state.error ? 'verify-error' : undefined}
        />
      </label>

      {state.error ? (
        <p id="verify-error" className={styles.warning} role="alert">{state.error}</p>
      ) : null}

      <VerifyButton total={total} />
    </form>
  );
}

function VerifyButton({ total }: { total: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={styles.send} disabled={pending}>
      {pending ? 'Checking…' : `Confirm and send · ${total}`}
    </button>
  );
}

function SendButton({ total, roomNumber }: { total: string; roomNumber: string }) {
  // useFormStatus must be inside the form — hence the split.
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={styles.send} disabled={pending}>
      {pending ? 'Sending…' : `Send to the kitchen · ${total}`}
      <span className={styles.sendSub}>Charged to room {roomNumber}</span>
    </button>
  );
}
