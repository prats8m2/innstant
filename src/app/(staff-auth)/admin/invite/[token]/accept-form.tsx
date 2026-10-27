'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { acceptInviteAction, type AcceptState } from './actions';
import styles from '../../login/login.module.css';

export function AcceptForm({ token, email }: { token: string; email: string }) {
  const [state, action] = useActionState<AcceptState, FormData>(acceptInviteAction, {});

  return (
    <form action={action} className={styles.form}>
      <input type="hidden" name="token" value={token} />

      <label className={styles.field}>
        <span className={styles.label}>Email</span>
        {/* Shown, not editable: it is the account this link belongs to, and it
            is what they will type to sign in from tomorrow. A browser password
            manager needs to see it to save the pair. */}
        <input
          name="email"
          type="email"
          value={email}
          readOnly
          autoComplete="username"
          className={styles.input}
        />
      </label>

      <label className={styles.field}>
        <span className={styles.label}>Choose a password</span>
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          required
          autoFocus
          minLength={12}
          className={styles.input}
        />
      </label>

      <label className={styles.field}>
        <span className={styles.label}>Again</span>
        <input
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          className={styles.input}
        />
      </label>

      {state.error ? <p className={styles.error} role="alert">{state.error}</p> : null}

      <SubmitButton />
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={styles.submit} disabled={pending}>
      {pending ? 'Setting it…' : 'Set my password'}
    </button>
  );
}
