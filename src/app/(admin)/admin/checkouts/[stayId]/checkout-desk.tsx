'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertTriangle, Crown, Printer, CheckCircle2 } from 'lucide-react';
import {
  addCharge, takePayment, adjust, refund, checkOut, type CheckoutState,
} from './actions';
import styles from '../../admin.module.css';
import c from './checkout.module.css';

/**
 * The checkout screen's client half (D-095). Everything arrives formatted;
 * this only lays it out and posts the forms.
 */
export interface CheckoutView {
  propertyId: string;
  stayId: string;
  status: 'in' | 'out';
  guest: { id: string; name: string; phone: string | null; email: string | null; isVip: boolean; notes: string | null };
  room: { number: string; floor: string; type: string | null };
  arrived: string;
  due: string;
  left: string | null;
  nights: number;
  guests: string;
  hasBill: boolean;
  settled: boolean;
  sections: Array<{
    key: string;
    title: string;
    total: string;
    lines: Array<{ id: string; date: string; description: string; detail: string | null; amount: string; isCredit: boolean; correctable: boolean }>;
  }>;
  payments: Array<{ id: string; date: string; description: string; amount: string; isRefund: boolean }>;
  totals: {
    charges: string;
    tax: string | null;
    serviceCharge: string | null;
    paid: string;
    balance: string;
    balanceMinor: number;
    balanceInput: string;
    owedBackInput: string;
  };
  warnings: string[];
  permissions: {
    charge: boolean; settle: boolean; adjust: boolean; refund: boolean;
    checkOut: boolean; seeGuest: boolean; seeBill: boolean;
  };
  paymentKey: string;
  refundKey: string;
}

const METHODS = [
  { value: 'CARD', label: 'Card' },
  { value: 'UPI', label: 'UPI' },
  { value: 'CASH', label: 'Cash' },
  { value: 'BANK_TRANSFER', label: 'Bank transfer' },
  { value: 'OTHER', label: 'Other' },
];

export function CheckoutDesk({ view }: { view: CheckoutView }) {
  const owes = view.totals.balanceMinor > 0;
  const owedBack = view.totals.balanceMinor < 0;
  const editable = !view.settled;

  return (
    <div className={c.page} data-checkout={view.room.number}>
      <header className={c.head}>
        <Link href="/admin/checkouts" className={c.back}>← Leaving</Link>
        <div className={c.headMain}>
          <span className={`${c.roomBadge} tabular`}>{view.room.number}</span>
          <div className={c.headText}>
            <h1 className={c.title}>
              {view.guest.name}
              {view.guest.isVip ? <span className={c.vip}><Crown size={14} aria-hidden="true" /> VIP</span> : null}
            </h1>
            <p className={c.sub}>
              {view.room.type ?? 'Room'} · {view.room.floor} · {view.guests} · {view.nights} night{view.nights === 1 ? '' : 's'}
            </p>
            <p className={c.sub}>
              Arrived {view.arrived} · {view.left ? `Left ${view.left}` : `Due out ${view.due}`}
            </p>
          </div>
          <div className={c.headActions}>
            {view.permissions.seeGuest ? (
              <Link href={`/admin/guests/${view.guest.id}`} className={styles.secondary}>Guest profile</Link>
            ) : null}
            {view.hasBill ? (
              <a href={`/print/invoice/${view.stayId}`} target="_blank" rel="noreferrer" className={styles.secondary}>
                <Printer size={16} aria-hidden="true" /> Invoice
              </a>
            ) : null}
          </div>
        </div>
        {view.guest.notes ? <p className={c.notes}>{view.guest.notes}</p> : null}
      </header>

      <div className={c.body}>
        <section className={c.bill} aria-label="The bill">
          {view.sections.length === 0 ? (
            <p className={styles.sectionEmpty}>Nothing on the bill yet.</p>
          ) : view.sections.map((section) => (
            <div key={section.key} className={c.section} data-section={section.key}>
              <h2 className={c.sectionTitle}>
                {section.title}
                <span className={`${c.sectionTotal} tabular`}>{section.total}</span>
              </h2>
              <ul className={c.lines}>
                {section.lines.map((line) => (
                  <li key={line.id} className={c.line} data-credit={line.isCredit}>
                    <span className={`${c.date} tabular`}>{line.date}</span>
                    <span className={c.desc}>
                      {line.description}
                      {line.detail ? <span className={c.detail}>{line.detail}</span> : null}
                    </span>
                    <span className={`${c.amount} tabular`}>{line.amount}</span>
                    {editable && line.correctable && view.permissions.adjust ? (
                      <Correct view={view} lineId={line.id} description={line.description} />
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {view.payments.length ? (
            <div className={c.section} data-section="payments">
              <h2 className={c.sectionTitle}>Payments</h2>
              <ul className={c.lines}>
                {view.payments.map((p) => (
                  <li key={p.id} className={c.line} data-refund={p.isRefund}>
                    <span className={`${c.date} tabular`}>{p.date}</span>
                    <span className={c.desc}>{p.description}</span>
                    <span className={`${c.amount} tabular`}>{p.isRefund ? `+${p.amount}` : `−${p.amount}`}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {editable && (view.permissions.charge || view.permissions.adjust) ? (
            <div className={c.tools}>
              {view.permissions.charge ? <AddCharge view={view} /> : null}
              {view.permissions.adjust ? <Discount view={view} /> : null}
            </div>
          ) : null}
        </section>

        <aside className={c.summary} aria-label="Summary">
          {view.warnings.length && view.status === 'in' ? (
            <div className={c.warnings} role="status">
              <p className={c.warningsTitle}><AlertTriangle size={16} aria-hidden="true" /> Before they go</p>
              <ul>{view.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
            </div>
          ) : null}

          <dl className={c.totals}>
            <div><dt>Charges</dt><dd className="tabular">{view.totals.charges}</dd></div>
            {view.totals.serviceCharge ? <div className={c.inner}><dt>of which service charge</dt><dd className="tabular">{view.totals.serviceCharge}</dd></div> : null}
            {view.totals.tax ? <div className={c.inner}><dt>of which GST</dt><dd className="tabular">{view.totals.tax}</dd></div> : null}
            <div><dt>Paid</dt><dd className="tabular">−{view.totals.paid}</dd></div>
          </dl>

          <div className={c.balance} data-state={owes ? 'owes' : owedBack ? 'back' : 'square'}>
            <span className={c.balanceLabel}>{owes ? 'Balance due' : owedBack ? 'Owed back to the guest' : view.settled ? 'Settled' : 'Nothing to pay'}</span>
            <span className={`${c.balanceValue} tabular`}>{view.totals.balance}</span>
          </div>

          {editable && owes && view.permissions.settle ? <TakePayment view={view} /> : null}
          {editable && owedBack && view.permissions.refund ? <Refund view={view} /> : null}

          {view.status === 'in' && view.permissions.checkOut ? (
            <CheckOut view={view} owes={owes || owedBack} />
          ) : view.status === 'out' ? (
            <p className={c.left}>
              <CheckCircle2 size={16} aria-hidden="true" /> Checked out {view.left}.
              {owes ? ' The balance stays on the bill until it is paid.' : ''}
            </p>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function Hidden({ view }: { view: CheckoutView }) {
  return (
    <>
      <input type="hidden" name="propertyId" value={view.propertyId} />
      <input type="hidden" name="stayId" value={view.stayId} />
    </>
  );
}

function Feedback({ state }: { state: CheckoutState }) {
  if (state.error) return <p className={styles.inlineError} role="alert">{state.error}</p>;
  if (state.done) return <p className={styles.inlineDone}>{state.done}</p>;
  return null;
}

function Submit({ label, primary = false, danger = false }: { label: string; primary?: boolean; danger?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={primary ? styles.primary : styles.secondary} data-danger={danger || undefined} disabled={pending}>
      {pending ? '…' : label}
    </button>
  );
}

function TakePayment({ view }: { view: CheckoutView }) {
  const [state, action] = useActionState<CheckoutState, FormData>(takePayment, {});
  return (
    <form action={action} className={c.card} data-form="payment">
      <h3 className={c.cardTitle}>Take a payment</h3>
      <Hidden view={view} />
      <input type="hidden" name="idempotencyKey" value={view.paymentKey} />
      <div className={c.row2}>
        <label className={styles.field}>
          <span className={styles.label}>Amount, ₹</span>
          {/* Keyed to the balance, so after a part payment it starts at what
              is left — split payments are two of these in a row. */}
          <input key={view.totals.balanceInput} name="amount" className={styles.input} inputMode="decimal" defaultValue={view.totals.balanceInput} required />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>How</span>
          <select name="method" className={styles.input} defaultValue="CARD">
            {METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </label>
      </div>
      <label className={styles.field}>
        <span className={styles.label}>Reference</span>
        <input name="reference" className={styles.input} maxLength={80} placeholder="Last 4 digits, UPI ref, receipt no." />
      </label>
      <p className={styles.hint}>Part payments are fine — take the next one the same way.</p>
      <Feedback state={state} />
      <Submit label="Record the payment" primary />
    </form>
  );
}

function Refund({ view }: { view: CheckoutView }) {
  const [state, action] = useActionState<CheckoutState, FormData>(refund, {});
  return (
    <form action={action} className={c.card} data-form="refund">
      <h3 className={c.cardTitle}>Give money back</h3>
      <Hidden view={view} />
      <input type="hidden" name="idempotencyKey" value={view.refundKey} />
      <div className={c.row2}>
        <label className={styles.field}>
          <span className={styles.label}>Amount, ₹</span>
          <input key={view.totals.owedBackInput} name="amount" className={styles.input} inputMode="decimal" defaultValue={view.totals.owedBackInput} required />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>How</span>
          <select name="method" className={styles.input} defaultValue="CASH">
            {METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </label>
      </div>
      <label className={styles.field}>
        <span className={styles.label}>Why</span>
        <input name="reason" className={styles.input} maxLength={160} required placeholder="Overpaid by card" />
      </label>
      <Feedback state={state} />
      <Submit label="Record the refund" primary />
    </form>
  );
}

function CheckOut({ view, owes }: { view: CheckoutView; owes: boolean }) {
  const [state, action] = useActionState<CheckoutState, FormData>(checkOut, {});
  const [override, setOverride] = useState(false);

  if (state.done) return <p className={c.left}><CheckCircle2 size={16} aria-hidden="true" /> {state.done}</p>;

  return (
    <form action={action} className={c.card} data-form="checkout">
      <Hidden view={view} />
      {owes ? (
        <>
          <p className={styles.hint}>
            {view.totals.balanceMinor > 0
              ? `Take the ${view.totals.balance} first, and the button below checks them out and closes the bill.`
              : `Give the ${view.totals.balance} back first, then check them out.`}
          </p>
          {view.permissions.adjust ? (
            override ? (
              <label className={styles.field}>
                <span className={styles.label}>Why they can leave without settling</span>
                <input name="unpaidReason" className={styles.input} maxLength={160} required placeholder="Billed to the company" autoFocus />
                <span className={styles.hint}>Recorded with the departure, and listed under unpaid departures.</span>
              </label>
            ) : (
              <button type="button" className={c.linkButton} onClick={() => setOverride(true)}>
                Check out without settling (manager)
              </button>
            )
          ) : null}
        </>
      ) : null}
      <Feedback state={state} />
      {!owes || override ? (
        <Submit label={owes ? `Check out ${view.room.number} with the balance open` : `Check out ${view.room.number}`} primary={!owes} danger={owes} />
      ) : null}
    </form>
  );
}

const KINDS = [
  { value: 'ROOM', label: 'Room nights' },
  { value: 'MINIBAR', label: 'Minibar' },
  { value: 'LAUNDRY', label: 'Laundry' },
  { value: 'DAMAGE', label: 'Damage or loss' },
  { value: 'OTHER', label: 'Something else' },
];

function AddCharge({ view }: { view: CheckoutView }) {
  const [state, action] = useActionState<CheckoutState, FormData>(addCharge, {});
  const [kind, setKind] = useState('ROOM');
  return (
    <details className={c.tool}>
      <summary className={c.toolHead}>Add a charge</summary>
      <form action={action} className={c.toolForm}>
        <Hidden view={view} />
        <div className={c.row2}>
          <label className={styles.field}>
            <span className={styles.label}>What</span>
            <select name="kind" className={styles.input} value={kind} onChange={(e) => setKind(e.target.value)}>
              {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Detail</span>
            <input name="detail" className={styles.input} maxLength={120} placeholder={kind === 'ROOM' ? 'Lake view, breakfast included' : 'Two sodas, one beer'} />
          </label>
        </div>
        <div className={c.row3}>
          <label className={styles.field}>
            <span className={styles.label}>{kind === 'ROOM' ? 'Nights' : 'Quantity'}</span>
            {/* Room nights start at the nights stayed. */}
            <input key={kind} name="quantity" type="number" min={1} max={365} className={styles.input} defaultValue={kind === 'ROOM' ? view.nights : 1} required />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>{kind === 'ROOM' ? 'Rate a night, ₹' : 'Price each, ₹'}</span>
            <input name="unitPrice" className={styles.input} inputMode="decimal" required placeholder="6500" />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>GST</span>
            <select key={kind} name="taxPercent" className={styles.input} defaultValue={kind === 'ROOM' ? '12' : kind === 'MINIBAR' ? '18' : '0'}>
              {['0', '5', '12', '18', '28'].map((t) => <option key={t} value={t}>{t === '0' ? 'None' : `${t}%`}</option>)}
            </select>
          </label>
        </div>
        <p className={styles.hint}>Tax goes on the bill as its own line under the charge.</p>
        <Feedback state={state} />
        <Submit label="Add to the bill" primary />
      </form>
    </details>
  );
}

function Discount({ view }: { view: CheckoutView }) {
  const [state, action] = useActionState<CheckoutState, FormData>(adjust, {});
  return (
    <details className={c.tool}>
      <summary className={c.toolHead}>Give a discount</summary>
      <form action={action} className={c.toolForm}>
        <Hidden view={view} />
        <div className={c.row2}>
          <label className={styles.field}>
            <span className={styles.label}>Amount off, ₹</span>
            <input name="amount" className={styles.input} inputMode="decimal" required />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Why</span>
            <input name="reason" className={styles.input} maxLength={160} required placeholder="Noise from the renovation" />
          </label>
        </div>
        <p className={styles.hint}>The reason is printed on the bill.</p>
        <Feedback state={state} />
        <Submit label="Take it off" />
      </form>
    </details>
  );
}

function Correct({ view, lineId, description }: { view: CheckoutView; lineId: string; description: string }) {
  const [state, action] = useActionState<CheckoutState, FormData>(adjust, {});
  return (
    <details className={c.correct}>
      <summary className={c.correctHead} aria-label={`Correct ${description}`}>Correct</summary>
      <form action={action} className={c.toolForm}>
        <Hidden view={view} />
        <input type="hidden" name="lineId" value={lineId} />
        <div className={c.row2}>
          <label className={styles.field}>
            <span className={styles.label}>Take off, ₹</span>
            <input name="amount" className={styles.input} inputMode="decimal" required />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Why</span>
            <input name="reason" className={styles.input} maxLength={160} required placeholder="Charged twice" />
          </label>
        </div>
        <Feedback state={state} />
        <Submit label="Correct it" />
      </form>
    </details>
  );
}
