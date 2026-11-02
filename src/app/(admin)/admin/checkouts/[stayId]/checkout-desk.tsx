'use client';

import Link from 'next/link';
import { useActionState, useEffect, useId, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  AlertTriangle, Check, CheckCircle2, ChevronDown, Crown, Lock, MoreHorizontal, Printer,
} from 'lucide-react';
import { formatMoney, parseMoneyInput } from '@/lib/money';
import {
  addCharge, takePayment, adjust, refund, checkOut, type CheckoutState,
} from './actions';
import ui from '../../rooms/controls.module.css';
import c from './checkout.module.css';

/**
 * The checkout screen's client half (D-095, rebuilt to Direction A). Everything
 * arrives formatted; this only lays it out and posts the forms. Board:
 * `design/reference/direction-a/ConsoleCheckout.dc.html`.
 *
 * Three steps, said at the top: review the bill, take the payment, check out.
 * Check out unlocks at ₹0 due. Letting somebody leave owing is the manager's,
 * reached from the ⋯ menu, and still needs the reason (D-095).
 */
export interface CheckoutView {
  propertyId: string;
  stayId: string;
  status: 'in' | 'out';
  /** "Sun 1 Nov – Mon 16 Nov". */
  range: string;
  /** "Mon 11am". */
  dueShort: string;
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

/** How money arrives at a desk. UPI is what the guest pays to the hotel's own code — nothing is sent from here. */
const METHODS = [
  { value: 'CARD', label: 'Card', sub: 'Tap or insert on the card machine', reference: 'Last 4 digits' },
  { value: 'UPI', label: 'UPI', sub: 'They pay the hotel’s UPI code at the desk', reference: 'UPI reference' },
  { value: 'CASH', label: 'Cash', sub: 'Count it into the drawer', reference: 'Receipt number, if any' },
  { value: 'BANK_TRANSFER', label: 'Bank transfer', sub: null, reference: 'Transfer reference' },
  { value: 'OTHER', label: 'Other', sub: null, reference: 'What it was' },
] as const;

export function CheckoutDesk({ view }: { view: CheckoutView }) {
  const owes = view.totals.balanceMinor > 0;
  const owedBack = view.totals.balanceMinor < 0;
  const square = !owes && !owedBack;
  const editable = !view.settled;
  const leaving = view.status === 'in';
  const mayLeaveOwing = leaving && !square && view.permissions.checkOut && view.permissions.adjust;
  const [override, setOverride] = useState(false);
  const [tool, setTool] = useState<'charge' | 'discount' | null>(null);
  const reasonRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (override) reasonRef.current?.focus();
  }, [override]);

  const step = !leaving ? 4 : square ? 3 : 2;

  return (
    <div className={c.page} data-checkout={view.room.number}>
      <div className={c.topBar}>
        <nav aria-label="Breadcrumb" className={c.crumbs}>
          <Link href="/admin/checkouts" className={c.crumb}>Leaving</Link>
          <span aria-hidden="true" className={c.crumbSep}>/</span>
          <span aria-current="page" className={c.crumbHere}><span className="tabular">{view.room.number}</span> {view.guest.name}</span>
        </nav>
        <div className={c.topActions}>
          {view.hasBill ? (
            <a href={`/print/invoice/${view.stayId}`} target="_blank" rel="noreferrer" className={ui.btn}>
              <Printer size={16} strokeWidth={1.5} aria-hidden="true" /> Print invoice
            </a>
          ) : null}
          {view.permissions.seeGuest || mayLeaveOwing ? (
            <MoreMenu
              guestHref={view.permissions.seeGuest ? `/admin/guests/${view.guest.id}` : null}
              onLeaveOwing={mayLeaveOwing ? () => setOverride(true) : null}
            />
          ) : null}
        </div>
      </div>

      <div className={c.head}>
        <div className={c.headText}>
          <h1 className={c.title}>
            {leaving ? <>Check out room <span className="tabular">{view.room.number}</span></> : <>Bill for room <span className="tabular">{view.room.number}</span></>}
            {view.guest.isVip ? <span className={ui.pill} data-tone="accent"><Crown size={12} strokeWidth={1.75} aria-hidden="true" />VIP</span> : null}
          </h1>
          <p className={c.facts}>
            {[view.room.type, view.room.floor].filter(Boolean).join(' · ')} · {view.range} · <span className="tabular">{view.nights}</span> {view.nights === 1 ? 'night' : 'nights'} · {view.guests}
            {' · '}
            {view.left ? <>left <b>{view.left}</b></> : <>due out <b>{view.dueShort}</b></>}
          </p>
          {view.guest.notes ? <p className={c.notes}>{view.guest.notes}</p> : null}
        </div>
        {leaving ? (
          <ol aria-label="Checkout steps" className={c.steps}>
            <Step n={1} label="Review bill" state={step > 1 ? 'done' : 'current'} />
            <li aria-hidden="true" className={c.stepRule} />
            <Step n={2} label={owedBack ? 'Give money back' : 'Take payment'} state={step > 2 ? 'done' : step === 2 ? 'current' : 'todo'} />
            <li aria-hidden="true" className={c.stepRule} />
            <Step n={3} label="Check out" state={step === 3 ? 'current' : 'todo'} />
          </ol>
        ) : (
          <span className={ui.pill} data-tone="pos"><CheckCircle2 size={12} strokeWidth={1.75} aria-hidden="true" /> Checked out {view.left}</span>
        )}
      </div>

      <div className={c.body}>
        <section aria-label="Bill" className={`${ui.card} ${c.bill}`}>
          {view.sections.length === 0 ? (
            <p className={c.billEmpty}>Nothing on the bill yet.</p>
          ) : view.sections.map((section) => (
            <details key={section.key} className={c.section} data-section={section.key} open>
              <summary className={c.sectionHead}>
                <span className={c.sectionName}>
                  <ChevronDown size={14} strokeWidth={2} className={c.chevron} aria-hidden="true" />
                  {section.title}
                  <span className={c.sectionCount}>{section.lines.length} {section.lines.length === 1 ? 'item' : 'items'}</span>
                </span>
                <span className={`${c.sectionTotal} tabular`} data-credit={section.key === 'credits' ? 'true' : undefined}>{section.total}</span>
              </summary>
              <ul className={c.lines}>
                {section.lines.map((line) => (
                  <BillLine key={line.id} view={view} line={line} mayCorrect={editable && line.correctable && view.permissions.adjust} />
                ))}
              </ul>
            </details>
          ))}
          <div className={c.billTotal}>
            <span>Total for the stay</span>
            <span className={`${c.billTotalValue} tabular`}>{view.totals.charges}</span>
          </div>
        </section>

        <aside className={c.side} aria-label="Payment and checkout">
          {view.warnings.length && leaving ? (
            <div className={c.warnings} role="status">
              <p className={c.warningsTitle}><AlertTriangle size={16} strokeWidth={1.75} aria-hidden="true" /> Before they go</p>
              <ul>{view.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
            </div>
          ) : null}

          <section className={`${ui.card} ${c.money}`} aria-label="Balance">
            <dl className={c.ledger}>
              <div><dt>Total</dt><dd className="tabular">{view.totals.charges}</dd></div>
              {view.totals.tax || view.totals.serviceCharge ? (
                <div className={c.inner}>
                  <dt>includes {[view.totals.tax ? 'GST' : null, view.totals.serviceCharge ? 'service charge' : null].filter(Boolean).join(' and ')}</dt>
                  <dd className="tabular">{[view.totals.tax, view.totals.serviceCharge].filter(Boolean).join(' · ')}</dd>
                </div>
              ) : null}
              {view.payments.map((p) => (
                <div key={p.id} data-refund={p.isRefund ? 'true' : undefined} className={c.payment}>
                  <dt>{p.description} · {p.date}</dt>
                  <dd className="tabular">{p.isRefund ? `+${p.amount}` : `−${p.amount}`}</dd>
                </div>
              ))}
            </dl>

            <div className={c.balance} data-state={owes ? 'owes' : owedBack ? 'back' : 'square'}>
              <span className={c.balanceLabel}>
                {owes ? 'Balance due' : owedBack ? 'Owed back to the guest' : view.settled ? 'Settled' : 'Nothing to pay'}
              </span>
              <span className={`${c.balanceValue} tabular`}>{view.totals.balance}</span>
            </div>

            {editable && owes && view.permissions.settle ? <TakePayment key={view.totals.balanceInput} view={view} /> : null}
            {editable && owedBack && view.permissions.refund ? <Refund key={view.totals.owedBackInput} view={view} /> : null}
          </section>

          {editable && (view.permissions.charge || view.permissions.adjust) ? (
            <>
              <div className={c.toolButtons}>
                {view.permissions.charge ? (
                  <button type="button" className={ui.btn} aria-expanded={tool === 'charge'} onClick={() => setTool((t) => (t === 'charge' ? null : 'charge'))}>
                    Add a charge
                  </button>
                ) : null}
                {view.permissions.adjust ? (
                  <button type="button" className={ui.btn} aria-expanded={tool === 'discount'} onClick={() => setTool((t) => (t === 'discount' ? null : 'discount'))}>
                    Discount…
                  </button>
                ) : null}
              </div>
              {tool === 'charge' && view.permissions.charge ? <AddCharge view={view} onClose={() => setTool(null)} /> : null}
              {tool === 'discount' && view.permissions.adjust ? <Discount view={view} onClose={() => setTool(null)} /> : null}
            </>
          ) : null}

          {leaving && view.permissions.checkOut ? (
            <CheckOut
              view={view}
              square={square}
              override={override}
              mayOverride={mayLeaveOwing}
              onCancel={() => setOverride(false)}
              reasonRef={reasonRef}
            />
          ) : !leaving ? (
            <p className={c.left}>
              <CheckCircle2 size={16} strokeWidth={1.75} aria-hidden="true" /> Checked out {view.left}.
              {owes ? ' The balance stays on the bill until it is paid.' : ''}
            </p>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function Step({ n, label, state }: { n: number; label: string; state: 'done' | 'current' | 'todo' }) {
  return (
    <li className={c.step} data-state={state} aria-current={state === 'current' ? 'step' : undefined}>
      <span className={`${c.stepMark} tabular`}>
        {state === 'done' ? <Check size={12} strokeWidth={3} aria-hidden="true" /> : n}
      </span>
      {label}
      {state === 'done' ? <span className={ui.srOnly}> (done)</span> : null}
    </li>
  );
}

/**
 * The ⋯ menu: what is on this screen but not for every day. "Check out
 * anyway" lives here so it is never the button somebody reaches for by habit.
 */
function MoreMenu({ guestHref, onLeaveOwing }: { guestHref: string | null; onLeaveOwing: (() => void) | null }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    box.current?.querySelector<HTMLElement>('[data-item]')?.focus();
    const away = (event: MouseEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); box.current?.querySelector<HTMLElement>('button')?.focus(); }
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', key); };
  }, [open]);

  return (
    <div className={c.more} ref={box}>
      <button
        type="button"
        className={ui.btn}
        aria-expanded={open}
        aria-controls={id}
        aria-label="More"
        onClick={() => setOpen((o) => !o)}
      >
        <MoreHorizontal size={18} strokeWidth={1.5} aria-hidden="true" />
      </button>
      {open ? (
        <ul id={id} className={c.moreList}>
          {guestHref ? (
            <li><Link href={guestHref} className={c.moreItem} data-item>Guest profile</Link></li>
          ) : null}
          {onLeaveOwing ? (
            <li>
              <button type="button" className={c.moreItem} data-item data-tone="crit" onClick={() => { setOpen(false); onLeaveOwing(); }}>
                Check out anyway…
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
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
  if (state.error) return <p className={ui.error} role="alert">{state.error}</p>;
  if (state.done) return <p className={ui.done} role="status">{state.done}</p>;
  return null;
}

function Submit({ label, primary = false, danger = false, large = false }: { label: React.ReactNode; primary?: boolean; danger?: boolean; large?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={`${ui.btn} ${primary ? ui.primary : ''} ${danger ? ui.danger : ''} ${large ? ui.large : ''}`}
      disabled={pending}
    >
      {pending ? '…' : label}
    </button>
  );
}

/** "₹30,917" for what is typed, or null while it is not yet an amount. */
function amountLabel(input: string): string | null {
  try {
    const value = parseMoneyInput(input, 'INR');
    return value.amountMinor > 0 ? formatMoney(value) : null;
  } catch {
    return null;
  }
}

function MethodPicker({ name, value, onChange }: { name: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className={c.methods}>
      {METHODS.map((m) => (
        <label key={m.value} className={c.method} data-compact={m.sub ? undefined : 'true'}>
          <input type="radio" name={name} value={m.value} checked={value === m.value} onChange={() => onChange(m.value)} />
          <span className={c.methodText}>
            <span className={c.methodLabel}>{m.label}</span>
            {m.sub ? <span className={c.methodSub}>{m.sub}</span> : null}
          </span>
        </label>
      ))}
    </div>
  );
}

function TakePayment({ view }: { view: CheckoutView }) {
  const [state, action] = useActionState<CheckoutState, FormData>(takePayment, {});
  const [method, setMethod] = useState('CARD');
  // Starts at what is owed — taking all of it is the common case — and the
  // form is keyed to the balance, so after a part payment it starts at what
  // is left: a split is two of these in a row.
  const [amount, setAmount] = useState(view.totals.balanceInput);
  const shown = amountLabel(amount);
  const reference = METHODS.find((m) => m.value === method)?.reference ?? 'Reference';
  return (
    <form action={action} className={c.payForm} data-form="payment">
      <Hidden view={view} />
      <input type="hidden" name="idempotencyKey" value={view.paymentKey} />
      <fieldset className={c.fieldset}>
        <legend className={ui.lbl}>Take payment by</legend>
        <MethodPicker name="method" value={method} onChange={setMethod} />
      </fieldset>
      <div className={ui.grid2}>
        <label className={ui.field}>
          <span className={ui.label}>Amount</span>
          <span className={c.moneyInput}>
            <span className="tabular" aria-hidden="true">₹</span>
            <input name="amount" className="tabular" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </span>
        </label>
        <label className={ui.field}>
          <span className={ui.label}>{reference}</span>
          <input name="reference" className={ui.input} maxLength={80} />
        </label>
      </div>
      <p className={ui.hint}>Part payments are fine — take the next one the same way.</p>
      <Feedback state={state} />
      <Submit primary large label={<>Record payment{shown ? <> · <span className="tabular">{shown}</span></> : null}</>} />
    </form>
  );
}

function Refund({ view }: { view: CheckoutView }) {
  const [state, action] = useActionState<CheckoutState, FormData>(refund, {});
  const [method, setMethod] = useState('CASH');
  const [amount, setAmount] = useState(view.totals.owedBackInput);
  const shown = amountLabel(amount);
  return (
    <form action={action} className={c.payForm} data-form="refund">
      <Hidden view={view} />
      <input type="hidden" name="idempotencyKey" value={view.refundKey} />
      <fieldset className={c.fieldset}>
        <legend className={ui.lbl}>Give money back by</legend>
        <MethodPicker name="method" value={method} onChange={setMethod} />
      </fieldset>
      <div className={ui.grid2}>
        <label className={ui.field}>
          <span className={ui.label}>Amount</span>
          <span className={c.moneyInput}>
            <span className="tabular" aria-hidden="true">₹</span>
            <input name="amount" className="tabular" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </span>
        </label>
        <label className={ui.field}>
          <span className={ui.label}>Why</span>
          <input name="reason" className={ui.input} maxLength={160} required placeholder="Overpaid by card" />
        </label>
      </div>
      <Feedback state={state} />
      <Submit danger large label={<>Record the refund{shown ? <> · <span className="tabular">{shown}</span></> : null}</>} />
    </form>
  );
}

function CheckOut({ view, square, override, mayOverride, onCancel, reasonRef }: {
  view: CheckoutView;
  square: boolean;
  override: boolean;
  mayOverride: boolean;
  onCancel: () => void;
  reasonRef: React.RefObject<HTMLInputElement | null>;
}) {
  const [state, action] = useActionState<CheckoutState, FormData>(checkOut, {});

  if (state.done) return <p className={c.left}><CheckCircle2 size={16} strokeWidth={1.75} aria-hidden="true" /> {state.done}</p>;

  if (square) {
    return (
      <form action={action} className={c.checkoutForm} data-form="checkout">
        <Hidden view={view} />
        <Feedback state={state} />
        <Submit primary large label={<>Check out <span className="tabular">{view.room.number}</span></>} />
        <p className={ui.hint}>Frees the room, ends every session on their phone and marks the room to be made up.</p>
      </form>
    );
  }

  if (override && mayOverride) {
    return (
      <form action={action} className={`${c.checkoutForm} ${c.override}`} data-form="checkout">
        <Hidden view={view} />
        <p className={c.overrideTitle}>Check out with <span className="tabular">{view.totals.balance}</span> {view.totals.balanceMinor > 0 ? 'unpaid' : 'not given back'}</p>
        <label className={ui.field}>
          <span className={ui.label}>Why they can leave without settling</span>
          <input ref={reasonRef} name="unpaidReason" className={ui.input} maxLength={160} required placeholder="Billed to the company" />
          <span className={ui.hint}>Recorded with the departure, with your name, and listed under Left owing.</span>
        </label>
        <Feedback state={state} />
        <div className={c.overrideButtons}>
          <Submit danger label={<>Check out <span className="tabular">{view.room.number}</span> anyway</>} />
          <button type="button" className={ui.btn} onClick={onCancel}>Cancel</button>
        </div>
      </form>
    );
  }

  return (
    <div className={c.checkoutForm}>
      <button type="button" disabled className={c.locked} title={view.totals.balanceMinor > 0 ? 'Settle the balance first' : 'Give the money back first'}>
        <Lock size={14} strokeWidth={1.5} aria-hidden="true" /> Check out · unlocks at <span className="tabular">₹0</span> due
      </button>
      <p className={ui.hint}>
        {mayOverride
          ? 'Need to let a guest leave owing? Use “Check out anyway” in the ⋯ menu. It lands in Left owing with your name on it.'
          : 'Only a manager can let a guest leave without settling.'}
      </p>
    </div>
  );
}

const KINDS = [
  { value: 'ROOM', label: 'Room nights' },
  { value: 'MINIBAR', label: 'Minibar' },
  { value: 'LAUNDRY', label: 'Laundry' },
  { value: 'DAMAGE', label: 'Damage or loss' },
  { value: 'OTHER', label: 'Something else' },
];

function AddCharge({ view, onClose }: { view: CheckoutView; onClose: () => void }) {
  const [state, action] = useActionState<CheckoutState, FormData>(addCharge, {});
  const [kind, setKind] = useState('ROOM');
  return (
    <form action={action} className={`${ui.card} ${c.toolForm}`} aria-label="Add a charge">
      <p className={c.toolTitle}>Add a charge</p>
      <Hidden view={view} />
      <div className={ui.grid2}>
        <label className={ui.field}>
          <span className={ui.label}>What</span>
          <select name="kind" className={ui.input} value={kind} onChange={(e) => setKind(e.target.value)}>
            {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </label>
        <label className={ui.field}>
          <span className={ui.label}>Detail</span>
          <input name="detail" className={ui.input} maxLength={120} placeholder={kind === 'ROOM' ? 'Lake view, breakfast included' : 'Two sodas, one beer'} />
        </label>
      </div>
      <div className={ui.grid3}>
        <label className={ui.field}>
          <span className={ui.label}>{kind === 'ROOM' ? 'Nights' : 'Quantity'}</span>
          {/* Room nights start at the nights stayed. */}
          <input key={kind} name="quantity" type="number" min={1} max={365} className={`${ui.input} tabular`} defaultValue={kind === 'ROOM' ? view.nights : 1} required />
        </label>
        <label className={ui.field}>
          <span className={ui.label}>{kind === 'ROOM' ? 'Rate a night, ₹' : 'Price each, ₹'}</span>
          <input name="unitPrice" className={`${ui.input} tabular`} inputMode="decimal" required placeholder="6500" />
        </label>
        <label className={ui.field}>
          <span className={ui.label}>GST</span>
          <select key={kind} name="taxPercent" className={ui.input} defaultValue={kind === 'ROOM' ? '12' : kind === 'MINIBAR' ? '18' : '0'}>
            {['0', '5', '12', '18', '28'].map((t) => <option key={t} value={t}>{t === '0' ? 'None' : `${t}%`}</option>)}
          </select>
        </label>
      </div>
      <p className={ui.hint}>Tax goes on the bill as its own line under the charge.</p>
      <Feedback state={state} />
      <div className={c.overrideButtons}>
        <Submit label="Add to the bill" primary />
        <button type="button" className={ui.btn} onClick={onClose}>Close</button>
      </div>
    </form>
  );
}

function Discount({ view, onClose }: { view: CheckoutView; onClose: () => void }) {
  const [state, action] = useActionState<CheckoutState, FormData>(adjust, {});
  return (
    <form action={action} className={`${ui.card} ${c.toolForm}`} aria-label="Give a discount">
      <p className={c.toolTitle}>Give a discount</p>
      <Hidden view={view} />
      <div className={ui.grid2}>
        <label className={ui.field}>
          <span className={ui.label}>Amount off, ₹</span>
          <input name="amount" className={`${ui.input} tabular`} inputMode="decimal" required />
        </label>
        <label className={ui.field}>
          <span className={ui.label}>Why</span>
          <input name="reason" className={ui.input} maxLength={160} required placeholder="Noise from the renovation" />
        </label>
      </div>
      <p className={ui.hint}>The reason is printed on the bill.</p>
      <Feedback state={state} />
      <div className={c.overrideButtons}>
        <Submit label="Take it off" primary />
        <button type="button" className={ui.btn} onClick={onClose}>Close</button>
      </div>
    </form>
  );
}

type Line = CheckoutView['sections'][number]['lines'][number];

/**
 * One line of the bill. A manager can correct it — take some or all of it
 * off with a reason, printed on the bill — from a quiet control under the
 * amount; the form opens across the line.
 */
function BillLine({ view, line, mayCorrect }: { view: CheckoutView; line: Line; mayCorrect: boolean }) {
  const [open, setOpen] = useState(false);
  const formId = useId();
  return (
    <li className={c.line} data-credit={line.isCredit ? 'true' : undefined}>
      <span className={c.desc}>
        <span>{line.description}</span>
        <span className={c.detail}>{[line.date, line.detail].filter(Boolean).join(' · ')}</span>
      </span>
      <span className={c.amountCol}>
        <span className={`${c.amount} tabular`}>{line.amount}</span>
        {mayCorrect ? (
          <button
            type="button"
            className={c.correctHead}
            aria-expanded={open}
            aria-controls={formId}
            aria-label={`Correct ${line.description}`}
            onClick={() => setOpen((o) => !o)}
          >
            Correct
          </button>
        ) : null}
      </span>
      {mayCorrect && open ? <Correct id={formId} view={view} lineId={line.id} /> : null}
    </li>
  );
}

function Correct({ id, view, lineId }: { id: string; view: CheckoutView; lineId: string }) {
  const [state, action] = useActionState<CheckoutState, FormData>(adjust, {});
  return (
    <form id={id} action={action} className={`${ui.form} ${c.correctForm}`}>
      <Hidden view={view} />
      <input type="hidden" name="lineId" value={lineId} />
      <div className={ui.grid2}>
        <label className={ui.field}>
          <span className={ui.label}>Take off, ₹</span>
          <input name="amount" className={`${ui.input} tabular`} inputMode="decimal" required />
        </label>
        <label className={ui.field}>
          <span className={ui.label}>Why</span>
          <input name="reason" className={ui.input} maxLength={160} required placeholder="Charged twice" />
        </label>
      </div>
      <Feedback state={state} />
      <Submit label="Correct it" />
    </form>
  );
}
