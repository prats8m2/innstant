'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import type { AdminMenuCategory, AdminOffer } from '@/modules/catalog';
import { saveOffer, removeOffer, type OfferActionState } from './actions';
import styles from '../../admin.module.css';
import studio from '../studio.module.css';

/**
 * The offers editor (D-085).
 *
 * Automatic only, by the owner's choice: no codes. A guest ordering while an
 * offer is live simply pays less, and sees why. Never stacked: if two are
 * live for one dish, the bigger discount applies.
 *
 * Every form posts to a Server Action, and the time and date fields are
 * native and uncontrolled (see the collections editor for why).
 */

export interface OfferStatus {
  /** "showing now", "later today · from 15:00", "ended 5 Nov"… */
  label: string;
  live: boolean;
  /** "Weekdays · 15:00–18:00". */
  schedule: string;
  /** "20% off". */
  amount: string;
  /** "Whole menu", "Section: Sweets", "Laal maas". */
  target: string;
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

/** Starting points. Each only fills the form; nothing saves until Add. */
const PRESETS = [
  { label: 'Happy hour', name: 'Happy hour', amount: '20', from: '15:00', until: '18:00', days: [1, 2, 3, 4, 5], today: false },
  { label: 'Today only', name: 'Today’s offer', amount: '10', from: '', until: '', days: EVERY_DAY, today: true },
  { label: 'Weekends', name: 'Weekend treat', amount: '15', from: '', until: '', days: [0, 6], today: false },
] as const;

export function OfferEditor({
  propertyId,
  outletId,
  offers,
  statuses,
  categories,
  today,
}: {
  propertyId: string;
  outletId: string;
  offers: AdminOffer[];
  statuses: Record<string, OfferStatus>;
  categories: AdminMenuCategory[];
  today: string;
}) {
  return (
    <>
      {offers.length === 0 ? (
        <p className={styles.sectionEmpty}>
          No offers yet. A happy hour is a good first one: start from it below.
        </p>
      ) : null}

      {offers.map((offer) => {
        const status = statuses[offer.id]!;
        return (
          <section key={offer.id} id={`offer-${offer.id}`} className={styles.section}>
            <header className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>{offer.name}</h2>
              <span className={styles.collectionState} data-live={status.live || undefined}>
                {offer.isActive ? status.label : 'switched off'}
              </span>
              <span className={styles.sectionActions}>
                <ArchiveOffer propertyId={propertyId} outletId={outletId} offerId={offer.id} />
              </span>
            </header>
            <p className={styles.collectionSummary}>
              <strong>{status.amount}</strong>
              <span className={styles.collectionCount}>{' · '}{status.target}</span>
              <span className={styles.collectionCount}>{' · '}{status.schedule}</span>
            </p>
            <details className={styles.collectionDetails}>
              <summary className={styles.disclosureHead}>Edit {offer.name}</summary>
              <OfferForm
                propertyId={propertyId}
                outletId={outletId}
                categories={categories}
                offer={offer}
                today={today}
              />
            </details>
          </section>
        );
      })}

      <details className={styles.newSection} open={offers.length === 0 || undefined}>
        <summary className={styles.disclosureHead}>Add an offer</summary>
        <OfferForm propertyId={propertyId} outletId={outletId} categories={categories} today={today} />
      </details>

      <p className={styles.footnote}>
        Offers come off the dish&rsquo;s own price, not its extras, and never take
        it below zero. If two are live for one dish, the guest gets the bigger
        discount, never both. A receipt keeps the offer&rsquo;s name and the price
        before it, even after the offer ends.
      </p>
    </>
  );
}

function OfferForm({
  propertyId,
  outletId,
  categories,
  offer,
  today,
}: {
  propertyId: string;
  outletId: string;
  categories: AdminMenuCategory[];
  offer?: AdminOffer;
  today: string;
}) {
  const [state, action] = useActionState<OfferActionState, FormData>(saveOffer, {});

  const stored = {
    key: 0,
    name: offer?.name ?? '',
    amount: offer
      ? offer.kind === 'PERCENT'
        ? String((offer.percentBps ?? 0) / 100)
        : String((offer.amountMinor ?? 0) / 100)
      : '',
    from: offer?.availableFrom ?? '',
    until: offer?.availableUntil ?? '',
    days: offer?.daysOfWeek ?? EVERY_DAY,
    startsOn: offer?.startsOn ?? '',
    endsOn: offer?.endsOn ?? '',
  };
  const [preset, setPreset] = useState<typeof stored | null>(null);
  const fill = preset ?? stored;

  // Which target picker shows. A radio, so a click (or a test's check()) is
  // what changes it, which React does see.
  const [scope, setScope] = useState(offer?.scope ?? 'MENU');
  const [kind, setKind] = useState(offer?.kind ?? 'PERCENT');

  return (
    <form action={action} className={styles.dishForm}>
      <input type="hidden" name="propertyId" value={propertyId} />
      <input type="hidden" name="outletId" value={outletId} />
      {offer ? <input type="hidden" name="offerId" value={offer.id} /> : (
        <div className={studio.presets} role="group" aria-label="Start from">
          <span className={styles.label}>Start from</span>
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              className={studio.chip}
              onClick={() => {
                setScope('MENU');
                setKind('PERCENT');
                setPreset((current) => ({
                  key: (current?.key ?? 0) + 1,
                  name: p.name,
                  amount: p.amount,
                  from: p.from,
                  until: p.until,
                  days: [...p.days],
                  startsOn: p.today ? today : '',
                  endsOn: p.today ? today : '',
                }));
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      <div className={styles.formGrid}>
        <label className={`${styles.field} ${styles.wide}`}>
          <span className={styles.label}>Name</span>
          <input
            key={`name-${fill.key}`}
            name="name"
            className={styles.input}
            defaultValue={fill.name}
            required
            maxLength={80}
            placeholder="Happy hour"
          />
          <span className={styles.hint}>A guest sees this on the receipt, so say it plainly.</span>
        </label>

        <fieldset className={`${styles.fieldset} ${styles.wide}`}>
          <legend className={styles.legend}>What it is on</legend>
          <div className={studio.days}>
            {([['MENU', 'The whole menu'], ['CATEGORY', 'One section'], ['DISH', 'One dish']] as const)
              .map(([value, label]) => (
                <label key={value} className={studio.dayToggle}>
                  <input
                    type="radio"
                    name="scope"
                    value={value}
                    checked={scope === value}
                    onChange={() => setScope(value)}
                  />
                  <span>{label}</span>
                </label>
              ))}
          </div>
          {scope === 'CATEGORY' ? (
            <select name="categoryId" className={styles.input} defaultValue={offer?.categoryId ?? ''} required>
              <option value="" disabled>Pick a section</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          ) : null}
          {scope === 'DISH' ? (
            <select name="menuItemId" className={styles.input} defaultValue={offer?.menuItemId ?? ''} required>
              <option value="" disabled>Pick a dish</option>
              {categories.map((c) => (
                <optgroup key={c.id} label={c.name}>
                  {c.items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                </optgroup>
              ))}
            </select>
          ) : null}
        </fieldset>

        <fieldset className={`${styles.fieldset} ${styles.wide}`}>
          <legend className={styles.legend}>How much comes off</legend>
          <div className={studio.days}>
            {([['PERCENT', '% off'], ['AMOUNT', '₹ off']] as const).map(([value, label]) => (
              <label key={value} className={studio.dayToggle}>
                <input
                  type="radio"
                  name="kind"
                  value={value}
                  checked={kind === value}
                  onChange={() => setKind(value)}
                />
                <span>{label}</span>
              </label>
            ))}
            <input
              key={`amount-${fill.key}`}
              name="amount"
              className={`${styles.input} ${studio.amountInput}`}
              inputMode="decimal"
              defaultValue={fill.amount}
              required
              aria-label={kind === 'PERCENT' ? 'Percentage off' : 'Rupees off'}
              placeholder={kind === 'PERCENT' ? '20' : '100'}
            />
          </div>
          <span className={styles.hint}>
            {kind === 'PERCENT'
              ? '20 is 20% off the dish’s own price. Its extras keep their price.'
              : 'Rupees off each dish it is on. Never takes a dish below zero.'}
          </span>
        </fieldset>

        <label className={styles.field}>
          <span className={styles.label}>From</span>
          <input key={`from-${fill.key}`} name="availableFrom" type="time" className={styles.timeInput} defaultValue={fill.from} />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Until</span>
          <input key={`until-${fill.key}`} name="availableUntil" type="time" className={styles.timeInput} defaultValue={fill.until} />
          <span className={styles.hint}>Both, or neither for all day.</span>
        </label>

        <fieldset className={`${styles.fieldset} ${styles.wide}`}>
          <legend className={styles.legend}>Which days</legend>
          <div className={studio.days}>
            {DAY_LABELS.map((label, day) => (
              <label key={label} className={studio.dayToggle}>
                <input
                  key={`day-${day}-${fill.key}`}
                  type="checkbox"
                  name="daysOfWeek"
                  value={day}
                  defaultChecked={fill.days.includes(day)}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <label className={styles.field}>
          <span className={styles.label}>First day</span>
          <input key={`starts-${fill.key}`} name="startsOn" type="date" className={styles.timeInput} defaultValue={fill.startsOn} />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Last day</span>
          <input key={`ends-${fill.key}`} name="endsOn" type="date" className={styles.timeInput} defaultValue={fill.endsOn} />
          <span className={styles.hint}>Optional. It ends by itself after the last day.</span>
        </label>
      </div>

      <label className={styles.check}>
        <input type="checkbox" name="isActive" defaultChecked={offer ? offer.isActive : true} />
        <span>Switched on</span>
      </label>

      {state.error ? <p className={styles.formError} role="alert">{state.error}</p> : null}
      {state.done ? <p className={styles.formDone}>{state.done}</p> : null}

      <div className={styles.formActions}>
        <SaveButton label={offer ? 'Save the offer' : 'Add the offer'} />
      </div>
    </form>
  );
}

function ArchiveOffer({ propertyId, outletId, offerId }: { propertyId: string; outletId: string; offerId: string }) {
  const [state, action] = useActionState<OfferActionState, FormData>(removeOffer, {});
  return (
    <form action={action} className={styles.inlineForm}>
      <input type="hidden" name="propertyId" value={propertyId} />
      <input type="hidden" name="outletId" value={outletId} />
      <input type="hidden" name="offerId" value={offerId} />
      <SubmitSecondary label="End it" />
      {state.error ? <span className={styles.inlineError} role="alert">{state.error}</span> : null}
    </form>
  );
}

function SaveButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={styles.primary} disabled={pending}>
      {pending ? 'Saving…' : label}
    </button>
  );
}

function SubmitSecondary({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={styles.secondary} disabled={pending}>
      {pending ? '…' : label}
    </button>
  );
}
