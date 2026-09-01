'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { verifyForFolio, type FolioVerifyState } from './actions';
import styles from './stay.module.css';

/**
 * The one prompt, standing in for the bill until it is answered.
 *
 * Same four digits and the same tone as the cart's (D-012) — it says why it is
 * asking, it does not apologise, and it does not explain policy. The reason
 * differs and so does the sentence: on the cart the guest is about to spend
 * money, and here they are about to read what they already spent. A sticker on
 * a nightstand is photographable from the corridor, and this is the one screen
 * where the answer would be somebody else's business.
 *
 * No cancel button, for the reason the cart gives: the way out is the back
 * gesture, and a prominent "not now" beside a four-digit field is an invitation
 * to give up on a screen the guest deliberately opened.
 */
export function VerifyForFolio({ qrCode, roomNumber }: { qrCode: string; roomNumber: string }) {
  const [state, action] = useActionState<FolioVerifyState, FormData>(verifyForFolio, {});

  return (
    <form action={action} className={styles.verify}>
      <input type="hidden" name="qrCode" value={qrCode} />
      {/* Absent on the first submit — the action mints them and hands them back,
          so a second attempt lands on the same challenge and the attempt count
          means something. */}
      {state.challengeId ? (
        <input type="hidden" name="challengeId" value={state.challengeId} />
      ) : null}
      {state.escalationId ? (
        <input type="hidden" name="escalationId" value={state.escalationId} />
      ) : null}

      <p className={styles.verifyWhy}>
        Your bill is the one thing on here that is nobody else&rsquo;s business.
        The last four digits of the phone number on your booking, and it opens.
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
          aria-describedby={state.error ? 'folio-verify-error' : undefined}
        />
      </label>

      {state.error ? (
        <p id="folio-verify-error" className={styles.verifyError} role="alert">
          {state.error}
        </p>
      ) : null}

      <SubmitButton roomNumber={roomNumber} />

      <p className={styles.verifyAside}>
        Ask at the front desk if you would rather they opened it for you.
      </p>
    </form>
  );
}

function SubmitButton({ roomNumber }: { roomNumber: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={styles.verifyButton} disabled={pending}>
      {pending ? 'Checking…' : `Show me room ${roomNumber}’s bill`}
    </button>
  );
}
