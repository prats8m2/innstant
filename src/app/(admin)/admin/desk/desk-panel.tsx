'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { decideCheckout, type DeskCheckoutState } from '../checkouts/actions';
import { checkOutGuest, type DeskState } from '../rooms/actions';
import styles from './desk.module.css';

/**
 * One room, and everything open against it.
 *
 * Every string arrives formatted from the server: a client component importing
 * a value from a `modules/*` index drags `pg` into the browser bundle, and
 * money formatting belongs in one place (#5).
 */

export interface FolioLineView {
  id: string;
  date: string;
  description: string;
  amount: string;
}

export interface LateCheckoutView {
  id: string;
  /** When they want to leave, and when they are currently due out. */
  wants: string;
  dueOut: string;
  askedAt: string;
  agreedFee: string;
  effectiveFee: string;
  isFree: boolean;
}

export interface PanelPermissions {
  decide: boolean;
  overrideFee: boolean;
  checkOut: boolean;
  seeGuest: boolean;
}

interface LiveItem {
  id: string;
  title: string;
  meta: string;
  tone: 'accent' | 'attention' | 'critical';
}

export function DeskPanel({
  propertyId,
  room,
  stay,
  live,
  lateCheckout,
  folio,
  permissions,
}: {
  propertyId: string;
  room: { id: string; number: string; floorName: string; roomTypeName: string | null } | null;
  stay: {
    id: string;
    guestId: string;
    guestName: string;
    guestPhone: string | null;
    dueOut: string;
    nightsLeft: number;
  } | null;
  live: LiveItem[];
  lateCheckout: LateCheckoutView | null;
  folio: { lines: FolioLineView[]; total: string; settled: boolean } | null;
  permissions: PanelPermissions;
}) {
  if (!room) {
    return (
      <aside className={styles.panel}>
        <p className={styles.panelEmpty}>No rooms here yet.</p>
      </aside>
    );
  }

  return (
    <aside className={styles.panel} aria-label={`Room ${room.number}`}>
      <header className={styles.panelHead}>
        <div className={styles.panelWho}>
          <span className={`${styles.panelRoom} tabular`}>{room.number}</span>
          <div>
            <p className={styles.panelGuest}>{stay?.guestName ?? 'Vacant'}</p>
            <p className={styles.panelStay}>
              {stay
                ? `${room.floorName} · out ${stay.dueOut}${
                  stay.nightsLeft > 0
                    ? ` · ${stay.nightsLeft} ${stay.nightsLeft === 1 ? 'night' : 'nights'} left`
                    : ' · today'}`
                : `${room.floorName}${room.roomTypeName ? ` · ${room.roomTypeName}` : ''}`}
            </p>
          </div>
        </div>

        {stay ? (
          <div className={styles.panelActions}>
            {permissions.seeGuest ? (
              <Link href={`/admin/guests/${stay.guestId}`} className={styles.panelButton}>
                Guest profile
              </Link>
            ) : null}
            {permissions.checkOut ? (
              <CheckOut propertyId={propertyId} stayId={stay.id} room={room.number} />
            ) : null}
          </div>
        ) : null}
      </header>

      {lateCheckout ? (
        <LateCheckout
          propertyId={propertyId}
          request={lateCheckout}
          room={room.number}
          permissions={permissions}
        />
      ) : null}

      <section className={styles.panelSection}>
        <h3 className={styles.panelHeading}>Live in this room</h3>
        {live.length ? (
          <ul className={styles.liveList}>
            {live.map((item) => (
              <li key={item.id} className={styles.liveItem} data-tone={item.tone}>
                <span className={styles.liveDot} aria-hidden="true" />
                <span className={styles.liveTitle}>{item.title}</span>
                <span className={`${styles.liveMeta} tabular`}>{item.meta}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.quiet}>Nothing open. Quiet room.</p>
        )}
      </section>

      {stay ? (
        <section className={styles.panelSection}>
          <div className={styles.folioHead}>
            <h3 className={styles.panelHeading}>Folio</h3>
            <span className={styles.folioNote}>
              {folio?.settled ? 'Settled' : 'Unsettled · room and taxes at checkout'}
            </span>
          </div>

          {folio?.lines.length ? (
            <>
              <ul className={styles.folioList}>
                {folio.lines.map((line) => (
                  <li key={line.id} className={styles.folioLine}>
                    <span className={`${styles.folioDate} tabular`}>{line.date}</span>
                    <span className={styles.folioWhat}>{line.description}</span>
                    <span className={`${styles.folioAmount} tabular`}>{line.amount}</span>
                  </li>
                ))}
              </ul>
              <p className={styles.folioTotal}>
                <span className={styles.panelHeading}>Total so far</span>
                <span className={`${styles.folioSum} tabular`}>{folio.total}</span>
              </p>
            </>
          ) : (
            /* No folio is not the same as a zero balance — nothing has been
               charged to this room yet, and saying "₹0" would imply it had. */
            <p className={styles.quiet}>Nothing charged to this room yet.</p>
          )}
        </section>
      ) : null}
    </aside>
  );
}

/**
 * The one decision on this screen that is waiting for a human.
 *
 * Approving moves the checkout and posts the fee; declining tells the guest in
 * the app. Both write through `decideCheckoutRequest()`, which is the only
 * thing that may touch a `checkout_requests` row.
 *
 * ─── What the design has and this does not ─────────────────────────────────
 *
 * An "Undo" beside the decided result. There is no un-deciding in the machine:
 * approving posts a folio line and moves `scheduled_checkout_at`, and both are
 * events in `event_log` (#7) rather than fields to put back. A button that
 * appears to reverse a charge and does not is worse than no button, so the
 * decided state says what happened and stops.
 */
function LateCheckout({
  propertyId,
  request,
  room,
  permissions,
}: {
  propertyId: string;
  request: LateCheckoutView;
  room: string;
  permissions: PanelPermissions;
}) {
  const [state, action] = useActionState<DeskCheckoutState, FormData>(decideCheckout, {});
  const [overriding, setOverriding] = useState(false);
  const [fee, setFee] = useState('');

  if (state.done) {
    return (
      <div className={styles.decision} data-done="true">
        <p className={styles.decisionDone}>
          <span className={styles.liveDot} aria-hidden="true" />
          {state.done}
        </p>
      </div>
    );
  }

  return (
    <div className={styles.decision}>
      <div className={styles.decisionHead}>
        <h3 className={styles.panelHeading}>Needs a decision</h3>
        <span className={`${styles.decisionAsked} tabular`}>asked {request.askedAt}</span>
      </div>

      <p className={styles.decisionTitle}>Late checkout to {request.wants}</p>
      <p className={styles.decisionDetail}>
        Room {room} is due out {request.dueOut}. Approving moves the checkout and
        posts the fee to the folio.
      </p>

      {permissions.decide ? (
        <form action={action} className={styles.decisionForm}>
          <input type="hidden" name="propertyId" value={propertyId} />
          <input type="hidden" name="checkoutRequestId" value={request.id} />

          <div className={styles.feeRow}>
            <span className={styles.feeLabel}>Fee</span>
            {overriding && permissions.overrideFee ? (
              <>
                {/* Named `fee`, and BLANK means "charge what was agreed" while
                    "0" means waived — the action distinguishes them on the
                    string, not the number. */}
                <input
                  name="fee"
                  className={styles.feeInput}
                  value={fee}
                  onChange={(e) => setFee(e.target.value)}
                  inputMode="decimal"
                  placeholder={request.agreedFee}
                  aria-label="Charge a different fee"
                  autoComplete="off"
                />
                <button
                  type="button"
                  className={styles.feeWaive}
                  onClick={() => setFee('0')}
                >
                  Waive it
                </button>
              </>
            ) : (
              <>
                <span className={`${styles.feeAmount} tabular`}>{request.effectiveFee}</span>
                {permissions.overrideFee ? (
                  <button
                    type="button"
                    className={styles.feeWaive}
                    onClick={() => setOverriding(true)}
                  >
                    Charge something else
                  </button>
                ) : null}
              </>
            )}
          </div>

          {state.error ? <p className={styles.error} role="alert">{state.error}</p> : null}

          <div className={styles.decisionButtons}>
            <DecideButton to="DECLINED" label="Decline" />
            <DecideButton
              to="APPROVED"
              label={
                (overriding ? fee.trim() === '0' : request.isFree)
                  ? 'Approve · no charge'
                  : `Approve · charge ${overriding && fee.trim() ? fee.trim() : request.effectiveFee}`
              }
              primary
            />
          </div>
        </form>
      ) : (
        <p className={styles.quiet}>
          Somebody with checkout approval has to answer this one.
        </p>
      )}
    </div>
  );
}

/**
 * Two submit buttons, one form, `formAction`-free.
 *
 * The `to` rides as the button's own value so that which button was pressed is
 * part of the submitted data rather than something the handler infers.
 */
function DecideButton({
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
      className={primary ? styles.approve : styles.decline}
      disabled={pending}
    >
      {pending ? '…' : label}
    </button>
  );
}

function CheckOut({
  propertyId,
  stayId,
  room,
}: {
  propertyId: string;
  stayId: string;
  room: string;
}) {
  const [state, action] = useActionState<DeskState, FormData>(checkOutGuest, {});

  return (
    <form action={action} className={styles.checkOutForm}>
      <input type="hidden" name="propertyId" value={propertyId} />
      <input type="hidden" name="stayId" value={stayId} />
      <CheckOutButton room={room} />
      {state.error ? <span className={styles.error} role="alert">{state.error}</span> : null}
    </form>
  );
}

function CheckOutButton({ room }: { room: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={styles.panelButton} disabled={pending}>
      {pending ? '…' : `Check out ${room}`}
    </button>
  );
}
