'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { sendOrder, type CartEditState } from './actions';
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
