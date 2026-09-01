'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { callForService, type ServiceCallState } from './actions';
import styles from './service.module.css';

/**
 * The note and the button.
 *
 * A plain form post — the whole screen works with JavaScript off, and the note
 * is optional because requiring a reason is exactly what "no reason needed"
 * rules out.
 */
export function CallForService({
  qrCode,
  idempotencyKey,
}: {
  qrCode: string;
  idempotencyKey: string;
}) {
  const [state, action] = useActionState<ServiceCallState, FormData>(callForService, {});

  return (
    <form action={action} className={styles.form}>
      <input type="hidden" name="qrCode" value={qrCode} />
      {/* Minted when the screen rendered, so a double-tap sends one person (#8). */}
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

      <input
        name="guestNote"
        className={styles.note}
        maxLength={400}
        placeholder="Add a note, if it helps"
        aria-label="Note for the person coming up"
      />

      {state.error ? <p className={styles.error} role="alert">{state.error}</p> : null}

      <CallButton />
    </form>
  );
}

function CallButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={styles.call} disabled={pending}>
      {pending ? 'Asking…' : 'Ask someone to come up'}
    </button>
  );
}
