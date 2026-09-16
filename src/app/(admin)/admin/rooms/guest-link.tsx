'use client';

import { useEffect, useRef, useState } from 'react';
import styles from '../admin.module.css';

/**
 * The link on the sticker, copyable from the desk.
 *
 * The code itself is printed on a QR sticker on the nightstand, and there was no
 * way to get at it without a database query — so a desk reprinting a sticker, or
 * sending a guest the link over WhatsApp because their camera will not focus,
 * had nowhere to go.
 *
 * ─── Why the URL can arrive null ───────────────────────────────────────────
 *
 * The server builds it from `APP_URL`, never from the request: standalone binds
 * 0.0.0.0, so a URL derived from `request.url` behind a proxy is an internal
 * hostname (the same trap that made every redirect relative). When `APP_URL` is
 * unset the server sends null and this falls back to `window.location.origin` —
 * the origin the admin is actually on, which is right whenever the guest surface
 * shares the domain, and is at least reachable when it does not.
 */
export function GuestLink({
  roomNumber,
  publicCode,
  url,
}: {
  roomNumber: string;
  publicCode: string;
  url: string | null;
}) {
  const [resolved, setResolved] = useState(url);
  const [state, setState] = useState<'idle' | 'copied' | 'manual'>('idle');
  const field = useRef<HTMLInputElement>(null);

  /**
   * Only after mount: `window` does not exist on the server, and rendering a
   * different href on the first client paint than the server sent is a
   * hydration mismatch.
   */
  useEffect(() => {
    if (!url) setResolved(`${window.location.origin}/r/${publicCode}`);
  }, [url, publicCode]);

  async function copy() {
    if (!resolved) return;
    try {
      /**
       * `navigator.clipboard` needs a secure context. A hotel running this on
       * plain http over the LAN has none, and the call rejects — so the failure
       * path is not hypothetical, and it falls back to showing the field
       * selected for a manual copy rather than silently doing nothing.
       */
      await navigator.clipboard.writeText(resolved);
      setState('copied');
      window.setTimeout(() => setState('idle'), 2000);
    } catch {
      setState('manual');
      // Selected, so the next keystroke is the copy they were trying to make.
      window.setTimeout(() => field.current?.select(), 0);
    }
  }

  return (
    <span className={styles.guestLink}>
      <code className={styles.guestCode}>{publicCode}</code>

      <button
        type="button"
        className={styles.secondary}
        onClick={copy}
        disabled={!resolved}
        aria-label={`Copy the guest link for room ${roomNumber}`}
      >
        {state === 'copied' ? 'Copied' : 'Copy link'}
      </button>

      {resolved ? (
        <a
          href={resolved}
          target="_blank"
          rel="noreferrer noopener"
          className={styles.secondary}
          // Opening it here mints a guest session for that room, exactly as a
          // scan would. That is the point: it is how a desk checks a sticker
          // works before printing forty of them.
          title={`Open room ${roomNumber}'s guest screen in a new tab`}
        >
          Open
        </a>
      ) : null}

      {/*
        * Shown only when the clipboard refused. Read-only and selected, which is
        * the whole job — a field somebody can edit would let them "correct" a
        * code and print a sticker that resolves to nothing.
        */}
      {state === 'manual' && resolved ? (
        <input
          ref={field}
          readOnly
          value={resolved}
          className={styles.guestLinkField}
          onFocus={(event) => event.currentTarget.select()}
          aria-label={`Guest link for room ${roomNumber}`}
        />
      ) : null}
    </span>
  );
}
