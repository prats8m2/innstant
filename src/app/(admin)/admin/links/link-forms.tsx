'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { createLink, reprintLink, revokeLink, type LinkState } from './actions';
import styles from '../admin.module.css';

/**
 * Creating a property link, and the three things you do to one afterwards.
 *
 * ─── Why the code is shown here and nowhere else ───────────────────────────
 *
 * A link's public code is a capability: whoever has it can order from that
 * menu. It is deliberately NOT written to `event_log` (modules/visit/links),
 * because the audit trail is read by every staff member who can see the log,
 * and a code in it would outlive every revocation.
 *
 * So this screen is where it crosses back — once, in the response to the action
 * that minted it, and again from the list, which reads the live row. That is
 * the same arrangement as the staff invite token and the room sticker, and the
 * same reasoning.
 */

const KINDS = [
  {
    value: 'TABLE' as const,
    label: 'A table',
    blurb: 'A tent on one table. The order goes to that table and nobody types a number.',
  },
  {
    value: 'COUNTER' as const,
    label: 'The counter',
    blurb: 'A code at the till. Collected, and the kitchen calls a name.',
  },
  {
    value: 'ONLINE' as const,
    label: 'A link to send',
    blurb: 'For a bio, a story, a WhatsApp message. The customer picks collection or delivery.',
  },
];

export function CreateLinkForm({
  propertyId,
  outlets,
  origin,
}: {
  propertyId: string;
  outlets: readonly { id: string; name: string }[];
  origin: string | null;
}) {
  const [state, action] = useActionState<LinkState, FormData>(createLink, {});
  const [kind, setKind] = useState<'TABLE' | 'COUNTER' | 'ONLINE'>('TABLE');

  return (
    <form action={action} className={styles.stackedForm}>
      <input type="hidden" name="propertyId" value={propertyId} />

      <label className={styles.field}>
        <span className={styles.label}>Which menu</span>
        <select name="outletId" className={styles.input} required>
          {outlets.map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>
      </label>

      <fieldset className={styles.fieldset}>
        <legend className={styles.label}>What kind</legend>
        <div className={styles.checkColumn}>
          {KINDS.map((option) => (
            <label key={option.value} className={styles.check}>
              <input
                type="radio"
                name="kind"
                value={option.value}
                checked={kind === option.value}
                onChange={() => setKind(option.value)}
              />
              <span>
                <span className={styles.groupName}>{option.label}</span>
                <span className={styles.hint}>{option.blurb}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className={styles.field}>
        <span className={styles.label}>What staff call it</span>
        <input
          name="label"
          type="text"
          maxLength={60}
          required
          className={styles.input}
          placeholder={kind === 'TABLE' ? 'Terrace 4' : kind === 'COUNTER' ? 'Front till' : 'Instagram bio'}
        />
      </label>

      {/*
        Only for a table, and required there. The database says the same thing
        with `visit_links_table_label_ck` — a stray table on a delivery link
        would print "Table 4" on a delivery ticket.
      */}
      {kind === 'TABLE' ? (
        <label className={styles.field}>
          <span className={styles.label}>What the kitchen ticket says</span>
          <input
            name="tableLabel"
            type="text"
            maxLength={40}
            required
            className={styles.input}
            placeholder="Table 4"
          />
          <span className={styles.hint}>
            This is printed on every ticket from this tent. Write it the way a
            runner reads it, not the way the floor plan does.
          </span>
        </label>
      ) : null}

      {state.error ? <p className={styles.inlineError} role="alert">{state.error}</p> : null}
      {state.done ? <p className={styles.inlineDone}>{state.done}</p> : null}

      {state.publicCode ? (
        <LinkField code={state.publicCode} origin={origin} label="The new link" />
      ) : null}

      <CreateButton />
    </form>
  );
}

function CreateButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={styles.primary} disabled={pending}>
      {pending ? 'Creating…' : 'Create the link'}
    </button>
  );
}

/**
 * A link, copyable.
 *
 * ─── Why the origin can arrive null ────────────────────────────────────────
 *
 * The server builds it from `APP_URL`, never from the request: standalone binds
 * 0.0.0.0, so a URL derived from `request.url` behind a proxy is an internal
 * hostname. When `APP_URL` is unset the server sends null and this falls back
 * to `window.location.origin` — right whenever the guest surface shares the
 * domain, and at least reachable when it does not. Same arrangement as the room
 * sticker's `GuestLink`, and the same reason.
 */
export function LinkField({
  code,
  origin,
  label,
}: {
  code: string;
  origin: string | null;
  label: string;
}) {
  const [fallback, setFallback] = useState<string | null>(null);
  useEffect(() => setFallback(window.location.origin), []);

  // Derived every render, never cached in state: a reprint replaces `code` in
  // place, and a cached URL would keep showing the dead one after a revalidate.
  const base = origin ?? fallback;
  const url = base ? `${base}/p/${code}` : null;

  const [copied, setCopied] = useState<'idle' | 'copied' | 'manual'>('idle');

  async function copy() {
    if (!url) return;
    try {
      // Needs a secure context. A property running this on plain http over the
      // LAN has none and the call rejects, so the fallback is not hypothetical.
      await navigator.clipboard.writeText(url);
      setCopied('copied');
      window.setTimeout(() => setCopied('idle'), 2000);
    } catch {
      setCopied('manual');
    }
  }

  return (
    <span className={styles.guestLink}>
      <code className={styles.guestCode}>{code}</code>
      <button
        type="button"
        className={styles.secondary}
        onClick={copy}
        disabled={!url}
        aria-label={`Copy ${label}`}
      >
        {copied === 'copied' ? 'Copied' : 'Copy link'}
      </button>
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noreferrer noopener"
          className={styles.secondary}
          // Opening it here opens a REAL visit, exactly as a customer would.
          // That is the point: it is how somebody checks a tent works before
          // printing forty of them.
          title="Open this link in a new tab"
        >
          Open
        </a>
      ) : null}
      {copied === 'manual' && url ? (
        <input
          readOnly
          value={url}
          className={styles.guestLinkField}
          onFocus={(event) => event.currentTarget.select()}
          aria-label={label}
        />
      ) : null}
    </span>
  );
}

/**
 * Reprint and revoke, both behind a disclosure.
 *
 * Copy and Open are harmless and get pressed all day. These two kill a code
 * that may be printed on forty table tents, and sitting them at the same
 * weight is how somebody reaches for one by accident.
 */
export function LinkControls({
  propertyId,
  visitLinkId,
  label,
  origin,
  revoked,
}: {
  propertyId: string;
  visitLinkId: string;
  label: string;
  origin: string | null;
  revoked: boolean;
}) {
  const [reprintState, reprint] = useActionState<LinkState, FormData>(reprintLink, {});
  const [revokeState, revoke] = useActionState<LinkState, FormData>(revokeLink, {});

  if (revoked) return null;

  return (
    <>
      <details className={styles.disclosure}>
        <summary className={styles.disclosureHead}>Reprint</summary>
        <form action={reprint} className={styles.stackedForm}>
          <input type="hidden" name="propertyId" value={propertyId} />
          <input type="hidden" name="visitLinkId" value={visitLinkId} />
          <p className={styles.hint}>
            Every printed or posted copy of {label} stops working straight away.
            Anybody mid-order keeps their order — only a fresh open needs the new
            one.
          </p>
          {reprintState.error ? (
            <p className={styles.inlineError} role="alert">{reprintState.error}</p>
          ) : null}
          {reprintState.done ? <p className={styles.inlineDone}>{reprintState.done}</p> : null}
          {reprintState.publicCode ? (
            <LinkField code={reprintState.publicCode} origin={origin} label="The new link" />
          ) : null}
          <PendingButton idle="Issue a new code" busy="…" />
        </form>
      </details>

      <details className={styles.disclosure}>
        <summary className={styles.disclosureHead}>Revoke</summary>
        <form action={revoke} className={styles.stackedForm}>
          <input type="hidden" name="propertyId" value={propertyId} />
          <input type="hidden" name="visitLinkId" value={visitLinkId} />
          <p className={styles.hint}>
            {label} stops opening, permanently. Use this when a tent is gone
            rather than reprinted — a reprint is what you want if the table is
            still there.
          </p>
          {revokeState.error ? (
            <p className={styles.inlineError} role="alert">{revokeState.error}</p>
          ) : null}
          {revokeState.done ? <p className={styles.inlineDone}>{revokeState.done}</p> : null}
          <PendingButton idle="Revoke it" busy="…" />
        </form>
      </details>
    </>
  );
}

function PendingButton({ idle, busy }: { idle: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={styles.secondary} disabled={pending}>
      {pending ? busy : idle}
    </button>
  );
}
