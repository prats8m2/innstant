'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { decideCheckout, type DeskCheckoutState } from './actions';
import styles from '../admin.module.css';

/**
 * The queue, and the two buttons that empty it.
 *
 * Every string arrives formatted from the server: a client component importing a
 * value from a `modules/*` index drags `pg` into the browser bundle, and money
 * formatting belongs in one place (#5).
 */
export interface DeskRequestView {
  id: string;
  roomNumber: string;
  guestName: string;
  status: string;
  wants: string;
  dueOut: string;
  agreed: string;
  /** Set only when the desk charged something other than what was agreed. */
  charged: string | null;
  isFree: boolean;
  declineReason: string | null;
}

export function CheckoutQueue({
  propertyId,
  open,
  decided,
  mayDecide,
  mayOverride,
}: {
  propertyId: string;
  open: DeskRequestView[];
  decided: DeskRequestView[];
  mayDecide: boolean;
  mayOverride: boolean;
}) {
  return (
    <>
      <section className={styles.section}>
        <header className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Waiting</h2>
        </header>

        {open.length ? (
          <ul className={styles.dishes}>
            {open.map((request) => (
              <Waiting
                key={request.id}
                propertyId={propertyId}
                request={request}
                mayDecide={mayDecide}
                mayOverride={mayOverride}
              />
            ))}
          </ul>
        ) : (
          <p className={styles.sectionEmpty}>
            Nobody is waiting on an answer.
          </p>
        )}
      </section>

      {decided.length ? (
        <section className={styles.section}>
          <header className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>Already answered</h2>
            <p className={styles.sectionBlurb}>
              So a guest ringing down about one can be answered from this screen.
            </p>
          </header>
          <ul className={styles.dishes}>
            {decided.map((request) => (
              <li key={request.id} className={styles.dish}>
                <span className={styles.dishBody}>
                  <span className={styles.dishName}>
                    Room {request.roomNumber} · {request.guestName}
                  </span>
                  <span className={styles.dishFlags}>
                    {request.status === 'APPROVED'
                      ? `out at ${request.wants}`
                      : `stayed at ${request.dueOut}`}
                    {request.declineReason ? ` · “${request.declineReason}”` : null}
                  </span>
                </span>
                <span className={`${styles.dishPrice} tabular`}>
                  {request.status === 'APPROVED' ? request.charged ?? request.agreed : '—'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

function Waiting({
  propertyId,
  request,
  mayDecide,
  mayOverride,
}: {
  propertyId: string;
  request: DeskRequestView;
  mayDecide: boolean;
  mayOverride: boolean;
}) {
  const [state, action] = useActionState<DeskCheckoutState, FormData>(decideCheckout, {});

  return (
    <li className={`${styles.dish} ${styles.typeRow}`}>
      <span className={styles.dishBody}>
        <span className={styles.dishName}>
          Room {request.roomNumber} · {request.guestName}
        </span>
        <span className={styles.dishFlags}>
          {request.isFree
            ? `leaving now · due out ${request.dueOut}`
            : `wants ${request.wants} · due out ${request.dueOut}`}
        </span>
      </span>

      <span className={`${styles.dishPrice} tabular`}>{request.agreed}</span>

      {mayDecide ? (
        <form action={action} className={styles.checkoutDecide}>
          <input type="hidden" name="propertyId" value={propertyId} />
          <input type="hidden" name="checkoutRequestId" value={request.id} />

          {mayOverride && !request.isFree ? (
            <label className={styles.checkoutFee}>
              <span className={styles.label}>Charge instead</span>
              <input
                name="fee"
                className={styles.input}
                inputMode="decimal"
                placeholder={request.agreed.replace(/[^\d.]/g, '')}
                aria-label={`Charge something other than ${request.agreed}`}
              />
              {/* 0 is a waiver, and the action treats it as one. */}
              <span className={styles.hint}>Blank charges what they agreed. 0 waives it.</span>
            </label>
          ) : null}

          <label className={styles.checkoutReason}>
            <span className={styles.label}>If you are saying no, why</span>
            <input
              name="declineReason"
              className={styles.input}
              maxLength={200}
              placeholder="The room is turning over for a 2pm arrival."
              aria-label="Reason, shown to the guest"
            />
          </label>

          <span className={styles.checkoutButtons}>
            <Decide to="APPROVED" label="Approve" primary />
            <Decide to="DECLINED" label="Decline" />
          </span>

          {/*
            * An error keeps the row, so it has somewhere to be read. There is
            * deliberately no success message: a decided request LEAVES this
            * list for "Already answered" below, so a confirmation rendered in
            * here would unmount in the same tick it appeared. The row moving is
            * the feedback, and it is the durable kind — still true when the
            * desk looks back an hour later.
            */}
          {state.error ? (
            <p className={styles.inlineError} role="alert">{state.error}</p>
          ) : null}
        </form>
      ) : null}
    </li>
  );
}

/**
 * Two submit buttons on one form, each carrying its own `to`.
 *
 * `formAction` is not used: both decisions post the same fields to the same
 * action and differ by one value, and a named submit button is the plain HTML
 * way to say that. It also keeps the whole thing working with JavaScript off.
 */
function Decide({
  to,
  label,
  primary = false,
}: {
  to: 'APPROVED' | 'DECLINED';
  label: string;
  primary?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name="to"
      value={to}
      className={primary ? styles.primary : styles.secondary}
      disabled={pending}
    >
      {pending ? '…' : label}
    </button>
  );
}
