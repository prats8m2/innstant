'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import type { AdminMenu, AdminMenuItem } from '@/modules/catalog';
import { formatMoney, money } from '@/lib/money';
import {
  saveCategory, archiveCategory, toggleAvailability, archiveItem, toggleOutletOpen,
  type MenuActionState,
} from './actions';
import styles from '../admin.module.css';

export interface MenuPermissions {
  manage: boolean;
  pricing: boolean;
  availability: boolean;
}

/**
 * The editor.
 *
 * Every mutation on this screen is a `<form action={...}>` posting to a Server
 * Action — so the whole thing works with JavaScript off, and a hotel laptop
 * with a dead extension still has a usable menu editor. `useActionState` only
 * adds the message and the pending state on top.
 */
export function MenuEditor({
  propertyId,
  menu,
  permissions,
}: {
  propertyId: string;
  menu: AdminMenu;
  permissions: MenuPermissions;
}) {
  const currency = menu.outlet.currency;

  return (
    <>
      <header className={styles.pageHead}>
        <div>
          <h1 className={styles.title}>{menu.outlet.name}</h1>
          <p className={styles.lede}>
            {menu.categories.length} {menu.categories.length === 1 ? 'section' : 'sections'} ·{' '}
            {menu.categories.reduce((n, c) => n + c.items.length, 0)} dishes ·{' '}
            about {menu.outlet.prepTimeMinutes} minutes to the door
          </p>
        </div>

        {permissions.manage ? (
          <Link href="/admin/menu/collections" className={styles.secondary}>
            Collections
          </Link>
        ) : null}

        {permissions.manage && permissions.pricing ? (
          <Link href="/admin/menu/options" className={styles.secondary}>
            Option groups
          </Link>
        ) : null}

        {permissions.availability ? (
          <OutletSwitch
            propertyId={propertyId}
            outletId={menu.outlet.id}
            isAcceptingOrders={menu.outlet.isAcceptingOrders}
          />
        ) : null}
      </header>

      {menu.categories.map((category) => (
        <section key={category.id} className={styles.section}>
          <header className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>{category.name}</h2>
            {category.description ? (
              <p className={styles.sectionBlurb}>{category.description}</p>
            ) : null}

            <span className={styles.sectionActions}>
              {permissions.manage ? (
                <>
                  <RenameSection
                    propertyId={propertyId}
                    outletId={menu.outlet.id}
                    categoryId={category.id}
                    name={category.name}
                    description={category.description}
                  />
                  <ArchiveSection
                    propertyId={propertyId}
                    outletId={menu.outlet.id}
                    categoryId={category.id}
                    itemCount={category.items.length}
                  />
                </>
              ) : null}
            </span>
          </header>

          {category.items.length ? (
            <ul className={styles.dishes}>
              {category.items.map((item) => (
                <Dish
                  key={item.id}
                  propertyId={propertyId}
                  outletId={menu.outlet.id}
                  item={item}
                  permissions={permissions}
                />
              ))}
            </ul>
          ) : (
            <p className={styles.sectionEmpty}>Nothing in this section yet.</p>
          )}

          {permissions.manage ? (
            <Link
              href={`/admin/menu/new?category=${category.id}`}
              className={styles.addDish}
            >
              Add a dish to {category.name}
            </Link>
          ) : null}
        </section>
      ))}

      {/* Items whose section was archived under them. Invisible everywhere else,
          and still orderable by URL until someone deals with them. */}
      {menu.orphanedItems.length ? (
        <section className={styles.section}>
          <header className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>Without a section</h2>
            <p className={styles.sectionBlurb}>
              Their section was archived. A guest cannot browse to these, so give
              them a section or take them off the menu.
            </p>
          </header>
          <ul className={styles.dishes}>
            {menu.orphanedItems.map((item) => (
              <Dish
                key={item.id}
                propertyId={propertyId}
                outletId={menu.outlet.id}
                item={item}
                permissions={permissions}
              />
            ))}
          </ul>
        </section>
      ) : null}

      {permissions.manage ? (
        <NewSection propertyId={propertyId} outletId={menu.outlet.id} />
      ) : null}

      <p className={styles.footnote}>
        Prices are in {currency} and shown as {formatMoney(money(115000, currency))}. Nothing
        here is ever deleted — a dish taken off the menu stays on the receipts
        that sold it (D-008).
      </p>
    </>
  );
}

/* ── One dish ───────────────────────────────────────────────────────────── */

function Dish({
  propertyId,
  outletId,
  item,
  permissions,
}: {
  propertyId: string;
  outletId: string;
  item: AdminMenuItem;
  permissions: MenuPermissions;
}) {
  return (
    <li className={styles.dish} data-available={item.isAvailable}>
      <span className={styles.dishBody}>
        <span className={styles.dishName}>
          {permissions.manage ? (
            <Link href={`/admin/menu/${item.id}`} className={styles.dishLink}>
              {item.name}
            </Link>
          ) : (
            item.name
          )}
          {item.isAvailable ? null : <span className={styles.offTag}>off tonight</span>}
        </span>
        {item.description ? (
          <span className={styles.dishBlurb}>{item.description}</span>
        ) : null}
        {item.dietaryFlags.length ? (
          <span className={styles.dishFlags}>
            {item.dietaryFlags.map((f) => f.replace(/_/g, ' ').toLowerCase()).join(' · ')}
          </span>
        ) : null}
      </span>

      <span className={`${styles.dishPrice} tabular`}>
        {formatMoney(money(item.priceMinor, item.currency))}
      </span>

      <span className={styles.dishActions}>
        {permissions.availability ? (
          <AvailabilitySwitch
            propertyId={propertyId}
            outletId={outletId}
            item={item}
          />
        ) : null}
        {permissions.manage ? (
          <ArchiveDish propertyId={propertyId} outletId={outletId} item={item} />
        ) : null}
      </span>
    </li>
  );
}

/* ── The small forms ────────────────────────────────────────────────────── */

function AvailabilitySwitch({
  propertyId,
  outletId,
  item,
}: {
  propertyId: string;
  outletId: string;
  item: AdminMenuItem;
}) {
  const [state, action] = useActionState<MenuActionState, FormData>(toggleAvailability, {});

  return (
    <form action={action} className={styles.inlineForm}>
      <input type="hidden" name="propertyId" value={propertyId} />
      <input type="hidden" name="outletId" value={outletId} />
      <input type="hidden" name="itemId" value={item.id} />
      <input type="hidden" name="isAvailable" value={String(!item.isAvailable)} />
      <SubmitButton
        label={item.isAvailable ? 'Take off' : 'Put back on'}
        title={
          item.isAvailable
            ? `Hide ${item.name} from the guest menu tonight`
            : `Show ${item.name} again`
        }
      />
      {state.error ? <span className={styles.inlineError} role="alert">{state.error}</span> : null}
    </form>
  );
}

function ArchiveDish({
  propertyId,
  outletId,
  item,
}: {
  propertyId: string;
  outletId: string;
  item: AdminMenuItem;
}) {
  const [state, action] = useActionState<MenuActionState, FormData>(archiveItem, {});

  return (
    <form action={action} className={styles.inlineForm}>
      <input type="hidden" name="propertyId" value={propertyId} />
      <input type="hidden" name="outletId" value={outletId} />
      <input type="hidden" name="itemId" value={item.id} />
      <SubmitButton label="Remove" title={`Take ${item.name} off the menu for good`} />
      {state.error ? <span className={styles.inlineError} role="alert">{state.error}</span> : null}
    </form>
  );
}

function ArchiveSection({
  propertyId,
  outletId,
  categoryId,
  itemCount,
}: {
  propertyId: string;
  outletId: string;
  categoryId: string;
  itemCount: number;
}) {
  const [state, action] = useActionState<MenuActionState, FormData>(archiveCategory, {});

  return (
    <form action={action} className={styles.inlineForm}>
      <input type="hidden" name="propertyId" value={propertyId} />
      <input type="hidden" name="outletId" value={outletId} />
      <input type="hidden" name="categoryId" value={categoryId} />
      <SubmitButton
        label="Archive section"
        title={
          itemCount
            ? `Move or remove its ${itemCount} dishes first`
            : 'Archive this empty section'
        }
      />
      {state.error ? <span className={styles.inlineError} role="alert">{state.error}</span> : null}
    </form>
  );
}

/**
 * Renaming a section, in place.
 *
 * A `<details>` rather than a modal: it is a native disclosure, it works with
 * JavaScript off, and the form inside is the same one that creates a section.
 */
function RenameSection({
  propertyId,
  outletId,
  categoryId,
  name,
  description,
}: {
  propertyId: string;
  outletId: string;
  categoryId: string;
  name: string;
  description: string | null;
}) {
  const [state, action] = useActionState<MenuActionState, FormData>(saveCategory, {});

  return (
    <details className={styles.disclosure}>
      <summary className={styles.disclosureHead}>Rename</summary>
      <form action={action} className={styles.stackedForm}>
        <input type="hidden" name="propertyId" value={propertyId} />
        <input type="hidden" name="outletId" value={outletId} />
        <input type="hidden" name="categoryId" value={categoryId} />
        <label className={styles.field}>
          <span className={styles.label}>Section name</span>
          <input name="name" defaultValue={name} className={styles.input} required maxLength={120} />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>One line under it, optional</span>
          <input
            name="description"
            defaultValue={description ?? ''}
            className={styles.input}
            maxLength={400}
          />
        </label>
        {state.error ? <p className={styles.inlineError} role="alert">{state.error}</p> : null}
        <SubmitButton label="Save section" primary />
      </form>
    </details>
  );
}

function NewSection({ propertyId, outletId }: { propertyId: string; outletId: string }) {
  const [state, action] = useActionState<MenuActionState, FormData>(saveCategory, {});

  return (
    <details className={styles.newSection}>
      <summary className={styles.disclosureHead}>Add a section</summary>
      <form action={action} className={styles.stackedForm}>
        <input type="hidden" name="propertyId" value={propertyId} />
        <input type="hidden" name="outletId" value={outletId} />
        <label className={styles.field}>
          <span className={styles.label}>Section name</span>
          <input
            name="name"
            className={styles.input}
            required
            maxLength={120}
            placeholder="Breakfast"
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>One line under it, optional</span>
          <input
            name="description"
            className={styles.input}
            maxLength={400}
            placeholder="Until 10.30, in the room or on the terrace."
          />
        </label>
        {state.error ? <p className={styles.inlineError} role="alert">{state.error}</p> : null}
        <SubmitButton label="Add section" primary />
      </form>
    </details>
  );
}

function OutletSwitch({
  propertyId,
  outletId,
  isAcceptingOrders,
}: {
  propertyId: string;
  outletId: string;
  isAcceptingOrders: boolean;
}) {
  const [state, action] = useActionState<MenuActionState, FormData>(toggleOutletOpen, {});

  return (
    <form action={action} className={styles.outletSwitch}>
      <input type="hidden" name="propertyId" value={propertyId} />
      <input type="hidden" name="outletId" value={outletId} />
      <input type="hidden" name="isAcceptingOrders" value={String(!isAcceptingOrders)} />
      <span className={styles.outletState} data-open={isAcceptingOrders}>
        {isAcceptingOrders ? 'Taking orders' : 'Closed to orders'}
      </span>
      <SubmitButton
        label={isAcceptingOrders ? 'Close the kitchen' : 'Open the kitchen'}
        title="Stops or resumes new orders now, without touching the hours"
      />
      {state.error ? <span className={styles.inlineError} role="alert">{state.error}</span> : null}
      {state.done ? <span className={styles.inlineDone}>{state.done}</span> : null}
    </form>
  );
}

function SubmitButton({
  label,
  title,
  primary = false,
}: {
  label: string;
  title?: string;
  primary?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={primary ? styles.primary : styles.secondary}
      title={title}
      disabled={pending}
    >
      {pending ? '…' : label}
    </button>
  );
}
