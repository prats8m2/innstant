'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { ArrowRight } from 'lucide-react';
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

      <label className={styles.noteField}>
        <span className={styles.eyebrow} aria-hidden="true">A note, if it helps</span>
        <input
          name="guestNote"
          className={styles.input}
          maxLength={400}
          placeholder="Optional"
          aria-label="Note for the person coming up"
        />
      </label>

      {state.error ? <p className={styles.error} role="alert">{state.error}</p> : null}

      <div className={styles.footer}>
        <CallButton />
      </div>
    </form>
  );
}

function CallButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={styles.call} disabled={pending}>
      <span>{pending ? 'Asking…' : 'Ask someone to come up'}</span>
      <ArrowRight size={20} strokeWidth={2} aria-hidden="true" />
    </button>
  );
}
