'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import type { AdminCollection, AdminMenuCategory } from '@/modules/catalog';
import { saveCollection, removeCollection, type CollectionActionState } from './actions';
import styles from '../../admin.module.css';
import studio from '../studio.module.css';

/**
 * The collections editor.
 *
 * The guest menu's sections ARE these, in this order — so this screen is closer
 * to a running order than a settings page, and it says so rather than making a
 * GM guess why "After 10pm" is above "Chef Bhairav's table".
 *
 * Every form posts to a Server Action, so the screen works with JavaScript off.
 */
export interface CollectionStatus {
  /** "showing now", "later today · from 22:00", "ended 5 Nov"… */
  label: string;
  /** "Weekends · 11:00–15:30": the schedule in words. */
  schedule: string;
  live: boolean;
}

export function CollectionEditor({
  propertyId,
  outletId,
  collections,
  categories,
  /** Per collection, what a guest would see right now and why: computed on
   *  the server, in the property's timezone, with the same rule the guest
   *  menu uses (isCollectionLive, D-084). */
  statuses,
  /** The property's own today, `YYYY-MM-DD`, for "today only". */
  today,
}: {
  propertyId: string;
  outletId: string;
  collections: AdminCollection[];
  categories: AdminMenuCategory[];
  statuses: Record<string, CollectionStatus>;
  today: string;
}) {
  return (
    <>
      {collections.map((collection) => (
        // The id is the board's "Edit" link target (`#collection-…`).
        <section key={collection.id} id={`collection-${collection.id}`} className={styles.section}>
          <header className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>{collection.name}</h2>
            <span className={styles.collectionState}>
              {!collection.isActive
                ? 'switched off'
                : !collection.items.length
                  ? 'no dishes — a guest sees nothing'
                  : statuses[collection.id]?.label ?? ''}
            </span>
            <span className={styles.sectionActions}>
              <ArchiveCollection
                propertyId={propertyId}
                outletId={outletId}
                collectionId={collection.id}
              />
            </span>
          </header>

          <p className={styles.collectionSummary}>
            {collection.editorialNote ?? 'No line under it yet.'}
            {collection.items.length ? (
              <span className={styles.collectionCount}>
                {' · '}{collection.items.length}{' '}
                {collection.items.length === 1 ? 'dish' : 'dishes'}
              </span>
            ) : null}
            {statuses[collection.id] ? (
              <span className={styles.collectionCount}>
                {' · '}{statuses[collection.id]!.schedule}
              </span>
            ) : null}
          </p>

          {/*
            Collapsed by default. Three collections' worth of dish checkboxes is
            a five-thousand-pixel page, and a GM edits one at a time — the
            headings above are what they came to scan.
          */}
          <details className={styles.collectionDetails}>
            <summary className={styles.disclosureHead}>Edit {collection.name}</summary>
            <CollectionForm
              propertyId={propertyId}
              outletId={outletId}
              categories={categories}
              collection={collection}
              today={today}
            />
          </details>
        </section>
      ))}

      <details className={styles.newSection}>
        <summary className={styles.disclosureHead}>Add a collection</summary>
        <CollectionForm
          propertyId={propertyId}
          outletId={outletId}
          categories={categories}
          today={today}
        />
      </details>

      <p className={styles.footnote}>
        A collection is a view over dishes, not a copy of them: a dish can be in
        several — Laal maas is in two, which is the design — and archiving a
        collection takes nothing off the menu. A collection with no dishes in it
        is skipped entirely rather than drawn as an empty heading.
      </p>
    </>
  );
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

/**
 * The shapes a manager reaches for most. Each only fills the form; nothing is
 * saved until "Add the collection", so a preset is a starting point, not a
 * commitment. The dishes are always the manager's to tick.
 */
const PRESETS = [
  { label: 'Breakfast', name: 'Breakfast', from: '07:00', until: '10:30', days: EVERY_DAY, today: false },
  { label: 'Weekend brunch', name: 'Weekend brunch', from: '11:00', until: '15:30', days: [0, 6], today: false },
  { label: 'Today only', name: 'Today’s special', from: '', until: '', days: EVERY_DAY, today: true },
] as const;

function CollectionForm({
  propertyId,
  outletId,
  categories,
  collection,
  today,
}: {
  propertyId: string;
  outletId: string;
  categories: AdminMenuCategory[];
  collection?: AdminCollection;
  today: string;
}) {
  const [state, action] = useActionState<CollectionActionState, FormData>(saveCollection, {});
  const chosen = new Set(collection?.items.map((i) => i.id) ?? []);

  /*
   * The fields stay NATIVE and uncontrolled. Controlled, a time or date input
   * ignores a value set the way autofill and test tools set it (`.value =`,
   * which React's value tracker never sees), and the form posts the old one:
   * "22:00" typed in, nothing saved. A preset instead hands the fields new
   * defaults and re-mounts them under a new key.
   */
  const stored = {
    key: 0,
    name: collection?.name ?? '',
    from: collection?.availableFrom ?? '',
    until: collection?.availableUntil ?? '',
    days: collection?.daysOfWeek ?? EVERY_DAY,
    startsOn: collection?.startsOn ?? '',
    endsOn: collection?.endsOn ?? '',
  };
  const [preset, setFill] = useState<typeof stored | null>(null);
  // The server's latest until a preset is chosen: React resets a form to its
  // defaults after a successful save, and they must be what was just saved.
  const fill = preset ?? stored;

  return (
    <form action={action} className={styles.dishForm}>
      <input type="hidden" name="propertyId" value={propertyId} />
      <input type="hidden" name="outletId" value={outletId} />
      {collection ? (
        <input type="hidden" name="collectionId" value={collection.id} />
      ) : (
        <div className={studio.presets} role="group" aria-label="Start from">
          <span className={styles.label}>Start from</span>
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              className={studio.chip}
              onClick={() => setFill((current) => ({
                key: (current?.key ?? 0) + 1,
                name: preset.name,
                from: preset.from,
                until: preset.until,
                days: [...preset.days],
                startsOn: preset.today ? today : '',
                endsOn: preset.today ? today : '',
              }))}
            >
              {preset.label}
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
            maxLength={120}
            placeholder="After 10pm"
          />
          <span className={styles.hint}>
            This is a heading on the guest&rsquo;s menu, and a chip on the rail above it.
          </span>
        </label>

        <label className={`${styles.field} ${styles.wide}`}>
          <span className={styles.label}>The line underneath</span>
          <textarea
            name="editorialNote"
            className={styles.textarea}
            defaultValue={collection?.editorialNote ?? ''}
            maxLength={400}
            rows={2}
            placeholder="The kitchen is quieter. These still come out fast."
          />
          <span className={styles.hint}>
            Your own words. This is the one place the hotel gets to sound like itself.
          </span>
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Showing from</span>
          <input
            name="availableFrom"
            type="time"
            className={styles.timeInput}
            key={`from-${fill.key}`}
            defaultValue={fill.from}
          />
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Until</span>
          <input
            name="availableUntil"
            type="time"
            className={styles.timeInput}
            key={`until-${fill.key}`}
            defaultValue={fill.until}
          />
          <span className={styles.hint}>
            Both, or neither. 22:00 to 01:00 makes &ldquo;After 10pm&rdquo; literal.
          </span>
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
          <span className={styles.hint}>
            A late window belongs to the day it starts: Friday 22:00–01:00 is
            still Friday&rsquo;s at half past midnight.
          </span>
        </fieldset>

        <label className={styles.field}>
          <span className={styles.label}>First day</span>
          <input
            name="startsOn"
            type="date"
            className={styles.timeInput}
            key={`starts-${fill.key}`}
            defaultValue={fill.startsOn}
          />
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Last day</span>
          <input
            name="endsOn"
            type="date"
            className={styles.timeInput}
            key={`ends-${fill.key}`}
            defaultValue={fill.endsOn}
          />
          <span className={styles.hint}>
            Optional. Leave both empty to run it until you switch it off.
            It stops by itself after the last day, in the hotel&rsquo;s time.
          </span>
        </label>
      </div>

      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>What is in it</legend>
        <p className={styles.hint}>
          Ticked dishes appear under this heading, in the order they are listed here.
        </p>

        {categories.map((category) => (
          <div key={category.id} className={styles.checkGroup}>
            <p className={styles.checkGroupTitle}>{category.name}</p>
            <div className={styles.checkColumn}>
              {category.items.map((item) => (
                <label key={item.id} className={styles.check}>
                  <input
                    type="checkbox"
                    name="menuItemIds"
                    value={item.id}
                    defaultChecked={chosen.has(item.id)}
                  />
                  <span>
                    {item.name}
                    {item.isAvailable ? null : (
                      <em className={styles.offTag}> off tonight</em>
                    )}
                  </span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </fieldset>

      <label className={styles.check}>
        <input
          type="checkbox"
          name="isActive"
          defaultChecked={collection ? collection.isActive : true}
        />
        <span>Switched on</span>
      </label>

      {state.error ? <p className={styles.formError} role="alert">{state.error}</p> : null}
      {state.done ? <p className={styles.formDone}>{state.done}</p> : null}

      <div className={styles.formActions}>
        <SaveButton label={collection ? 'Save the collection' : 'Add the collection'} />
      </div>
    </form>
  );
}

function ArchiveCollection({
  propertyId,
  outletId,
  collectionId,
}: {
  propertyId: string;
  outletId: string;
  collectionId: string;
}) {
  const [state, action] = useActionState<CollectionActionState, FormData>(removeCollection, {});

  return (
    <form action={action} className={styles.inlineForm}>
      <input type="hidden" name="propertyId" value={propertyId} />
      <input type="hidden" name="outletId" value={outletId} />
      <input type="hidden" name="collectionId" value={collectionId} />
      <SubmitSecondary label="Archive" />
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
