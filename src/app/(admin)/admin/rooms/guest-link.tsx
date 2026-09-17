'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { reprintQrCode, type DeskState } from './actions';
import styles from '../admin.module.css';

/**
 * The link on the sticker, copyable from the desk — and reprintable.
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
  propertyId,
  roomId,
  roomNumber,
  publicCode,
  url,
  mayReprint,
  occupied,
}: {
  propertyId: string;
  roomId: string;
  roomNumber: string;
  publicCode: string;
  url: string | null;
  mayReprint: boolean;
  /** Only changes what the reprint control warns about, never whether it works. */
  occupied: boolean;
}) {
  /**
   * The origin, not the whole link. Reprinting replaces `publicCode` in place,
   * so anything that CACHED the assembled URL in state would keep showing the
   * dead one after a revalidate — the link and the code beside it would disagree
   * and the desk would print the wrong sticker. Deriving it on every render
   * makes that impossible.
   *
   * Set after mount only: `window` does not exist on the server, and rendering a
   * different href on the first client paint than the server sent is a hydration
   * mismatch.
   */
  const [origin, setOrigin] = useState<string | null>(null);
  useEffect(() => setOrigin(window.location.origin), []);

  const resolved = url ?? (origin ? `${origin}/r/${publicCode}` : null);

  const [state, setState] = useState<'idle' | 'copied' | 'manual'>('idle');
  const field = useRef<HTMLInputElement>(null);

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

      {mayReprint ? (
        <Reprint
          propertyId={propertyId}
          roomId={roomId}
          roomNumber={roomNumber}
          occupied={occupied}
        />
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

/**
 * Behind a disclosure rather than a bare button beside Copy link.
 *
 * Copy and Open are harmless and get pressed all day. This one kills the sticker
 * on the nightstand the moment it is pressed, and sitting it next to them at the
 * same weight is how a desk reaches for it by accident. The summary says what
 * happens; the button inside says it again.
 */
function Reprint({
  propertyId,
  roomId,
  roomNumber,
  occupied,
}: {
  propertyId: string;
  roomId: string;
  roomNumber: string;
  occupied: boolean;
}) {
  const [state, action] = useActionState<DeskState, FormData>(reprintQrCode, {});

  return (
    <details className={styles.roomForm}>
      <summary className={styles.disclosureHead}>Reprint</summary>
      <form action={action} className={styles.stackedForm}>
        <input type="hidden" name="propertyId" value={propertyId} />
        <input type="hidden" name="roomId" value={roomId} />

        <p className={styles.hint}>
          The sticker in {roomNumber} stops working straight away.{' '}
          {occupied
            /* Sessions bind to stay_id, never to the room or the code (#10), so
               this is true and worth saying — a desk that thinks a reprint signs
               the guest out will not use it on an occupied room, which is
               exactly the room whose code got photographed. */
            ? 'Whoever is in the room stays signed in on their phone — only a fresh scan needs the new one.'
            : 'Print the new one before the next guest arrives.'}
        </p>

        {state.error ? <p className={styles.inlineError} role="alert">{state.error}</p> : null}
        {state.done ? <p className={styles.inlineDone}>{state.done}</p> : null}

        <ReprintButton roomNumber={roomNumber} />
      </form>
    </details>
  );
}

function ReprintButton({ roomNumber }: { roomNumber: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={styles.secondary}
      disabled={pending}
      title={`Issue a new code for room ${roomNumber} and kill the old sticker`}
    >
      {pending ? '…' : 'Issue a new code'}
    </button>
  );
}
