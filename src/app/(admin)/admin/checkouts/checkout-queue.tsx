'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { decideCheckout, type DeskCheckoutState } from './actions';
import ui from '../rooms/controls.module.css';
import l from './leaving.module.css';

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
  part = 'both',
}: {
  propertyId: string;
  open: DeskRequestView[];
  decided: DeskRequestView[];
  mayDecide: boolean;
  mayOverride: boolean;
  /** The Leaving page puts today's departures between the two (D-094). */
  part?: 'waiting' | 'answered' | 'both';
}) {
  return (
    <>
      {part === 'answered' ? null : (
      <section className={`${ui.card} ${l.section}`} aria-labelledby="late-waiting">
        <header className={l.sectionHead}>
          <h2 id="late-waiting" className={l.sectionTitle}>Late checkout · waiting <span className={`${l.sectionCount} tabular`}>{open.length}</span></h2>
          <p className={l.sectionBlurb}>Oldest first. Approving moves their checkout and puts the fee on the bill.</p>
        </header>

        {open.length ? (
          <ul className={l.rows}>
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
          <p className={l.sectionEmpty}>
            Nobody is waiting on an answer.
          </p>
        )}
      </section>
      )}

      {part !== 'waiting' && decided.length ? (
        <section className={`${ui.card} ${l.section}`} aria-labelledby="late-answered">
          <header className={l.sectionHead}>
            <h2 id="late-answered" className={l.sectionTitle}>Already answered</h2>
            <p className={l.sectionBlurb}>
              So a guest ringing down about one can be answered from this screen.
            </p>
          </header>
          <ul className={l.rows}>
            {decided.map((request) => (
              <li key={request.id} className={l.ask}>
                <span className={l.askWho}>
                  <span className={l.askName}>
                    Room <span className="tabular">{request.roomNumber}</span> · {request.guestName}
                  </span>
                  <span className={l.meta}>
                    {request.status === 'APPROVED'
                      ? <span className={ui.pill} data-tone="pos">Approved</span>
                      : <span className={ui.pill} data-tone="neutral">Declined</span>}
                    <span>
                      {request.status === 'APPROVED'
                        ? `out at ${request.wants}`
                        : `stayed at ${request.dueOut}`}
                    </span>
                    {request.declineReason ? <span className={l.reason}>“{request.declineReason}”</span> : null}
                  </span>
                </span>
                <span className={`${l.askFee} tabular`}>
                  {request.status === 'APPROVED' ? request.charged ?? request.agreed : <span className={l.askMuted}>—</span>}
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
    <li className={l.ask}>
      <span className={l.askWho}>
        <span className={l.askName}>
          Room <span className="tabular">{request.roomNumber}</span> · {request.guestName}
        </span>
        <span className={l.meta}>
          {request.isFree
            ? `leaving now · due out ${request.dueOut}`
            : `wants ${request.wants} · due out ${request.dueOut}`}
        </span>
      </span>

      <span className={`${l.askFee} tabular`}>{request.agreed}</span>

      {mayDecide ? (
        <form action={action} className={l.decide} data-fee={mayOverride && !request.isFree ? undefined : 'none'}>
          <input type="hidden" name="propertyId" value={propertyId} />
          <input type="hidden" name="checkoutRequestId" value={request.id} />

          {mayOverride && !request.isFree ? (
            <label className={ui.field}>
              <span className={ui.label}>Charge instead, ₹</span>
              <input
                name="fee"
                className={`${ui.input} tabular`}
                inputMode="decimal"
                placeholder={request.agreed.replace(/[^\d.]/g, '')}
                aria-label={`Charge something other than ${request.agreed}`}
              />
              {/* 0 is a waiver, and the action treats it as one. */}
              <span className={ui.hint}>Blank charges what they agreed. 0 waives it.</span>
            </label>
          ) : null}

          <label className={ui.field}>
            <span className={ui.label}>If you are saying no, why</span>
            <input
              name="declineReason"
              className={ui.input}
              maxLength={200}
              placeholder="The room is turning over for a 2pm arrival."
              aria-label="Reason, shown to the guest"
            />
          </label>

          <span className={l.decideButtons}>
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
            <p className={`${ui.error} ${l.decideError}`} role="alert">{state.error}</p>
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
      className={`${ui.btn} ${primary ? ui.primary : ''}`}
      disabled={pending}
    >
      {pending ? '…' : label}
    </button>
  );
}
