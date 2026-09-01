'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { cancelRequest, type ServiceCallState } from '../actions';
import styles from '../service.module.css';

/**
 * "Never mind."
 *
 * Offered for as long as the request is live, because a guest who found their
 * own towels while a runner was on the stairs is the common case — see the
 * request state machine, where CANCELLED is reachable from every live state.
 */
export function CancelRequest({
  qrCode,
  requestId,
}: {
  qrCode: string;
  requestId: string;
}) {
  const [state, action] = useActionState<ServiceCallState, FormData>(cancelRequest, {});

  return (
    <form action={action} className={styles.cancelForm}>
      <input type="hidden" name="qrCode" value={qrCode} />
      <input type="hidden" name="requestId" value={requestId} />
      <CancelButton />
      {state.error ? <p className={styles.error} role="alert">{state.error}</p> : null}
    </form>
  );
}

function CancelButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={styles.cancel} disabled={pending}>
      {pending ? '…' : 'Actually, never mind'}
    </button>
  );
}
