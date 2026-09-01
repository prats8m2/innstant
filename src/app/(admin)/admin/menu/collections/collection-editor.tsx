'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import type { AdminCollection, AdminMenuCategory } from '@/modules/catalog';
import { saveCollection, removeCollection, type CollectionActionState } from './actions';
import styles from '../../admin.module.css';

/**
 * The collections editor.
 *
 * The guest menu's sections ARE these, in this order — so this screen is closer
 * to a running order than a settings page, and it says so rather than making a
 * GM guess why "After 10pm" is above "Chef Bhairav's table".
 *
 * Every form posts to a Server Action, so the screen works with JavaScript off.
 */
export function CollectionEditor({
  propertyId,
  outletId,
  collections,
  categories,
  /** What a guest would see right now — computed on the server, in the
   *  property's timezone, so it is the same answer the menu gives. */
  showingNow,
}: {
  propertyId: string;
  outletId: string;
  collections: AdminCollection[];
  categories: AdminMenuCategory[];
  showingNow: readonly string[];
}) {
  return (
    <>
      {collections.map((collection) => (
        <section key={collection.id} className={styles.section}>
          <header className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>{collection.name}</h2>
            <span className={styles.collectionState}>
              {!collection.isActive
                ? 'switched off'
                : !collection.items.length
                  ? 'no dishes — a guest sees nothing'
                  : showingNow.includes(collection.id)
                    ? 'showing now'
                    : 'outside its window'}
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
            {collection.availableFrom && collection.availableUntil ? (
              <span className={styles.collectionCount}>
                {' · '}{collection.availableFrom}–{collection.availableUntil}
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

function CollectionForm({
  propertyId,
  outletId,
  categories,
  collection,
}: {
  propertyId: string;
  outletId: string;
  categories: AdminMenuCategory[];
  collection?: AdminCollection;
}) {
  const [state, action] = useActionState<CollectionActionState, FormData>(saveCollection, {});
  const chosen = new Set(collection?.items.map((i) => i.id) ?? []);

  return (
    <form action={action} className={styles.dishForm}>
      <input type="hidden" name="propertyId" value={propertyId} />
      <input type="hidden" name="outletId" value={outletId} />
      {collection ? (
        <input type="hidden" name="collectionId" value={collection.id} />
      ) : null}

      <div className={styles.formGrid}>
        <label className={`${styles.field} ${styles.wide}`}>
          <span className={styles.label}>Name</span>
          <input
            name="name"
            className={styles.input}
            defaultValue={collection?.name ?? ''}
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
            defaultValue={collection?.availableFrom ?? ''}
          />
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Until</span>
          <input
            name="availableUntil"
            type="time"
            className={styles.timeInput}
            defaultValue={collection?.availableUntil ?? ''}
          />
          <span className={styles.hint}>
            Both, or neither. 22:00 to 01:00 makes &ldquo;After 10pm&rdquo; literal.
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
