'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import styles from './stay.module.css';

/**
 * The board's Copy button beside the Wi-Fi password. Says so for two seconds;
 * silent where the clipboard is refused, because the password is still on
 * the screen to read.
 */
export function CopyValue({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={styles.copy}
      aria-label={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        } catch {
          // A browser that refuses the clipboard still shows the password.
        }
      }}
    >
      {copied
        ? <Check size={15} strokeWidth={1.5} aria-hidden="true" />
        : <Copy size={15} strokeWidth={1.5} aria-hidden="true" />}
      <span>{copied ? 'Copied' : 'Copy'}</span>
    </button>
  );
}
