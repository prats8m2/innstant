'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { enterDemo, type DemoNameState } from './actions';
import styles from './demo.module.css';

export function NameForm() {
  const [state, action] = useActionState<DemoNameState, FormData>(enterDemo, {});

  return (
    <form action={action} className={styles.form}>
      <label className={styles.label} htmlFor="demo-name">
        Your first name
      </label>
      <input
        id="demo-name"
        name="name"
        className={styles.input}
        placeholder="Priya"
        autoComplete="given-name"
        autoFocus
        maxLength={60}
        required
        aria-describedby={state.error ? 'demo-name-error' : undefined}
      />
      {state.error ? (
        <p id="demo-name-error" className={styles.error} role="alert">
          {state.error}
        </p>
      ) : null}
      <Submit />
    </form>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={styles.submit} disabled={pending}>
      {pending ? 'Opening the room…' : 'Open the room'}
    </button>
  );
}
