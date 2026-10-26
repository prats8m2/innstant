'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Archive, Pencil, Trash2 } from 'lucide-react';
import {
  saveCategory, archiveCategory, archiveItem, toggleOutletOpen,
  type MenuActionState,
} from './actions';
import styles from '../admin.module.css';
import studio from './studio.module.css';

/**
 * The menu studio's small forms.
 *
 * Each is a `<form action={...}>` posting to a Server Action, as they were on
 * the editor the studio replaced, so renaming a section or closing the kitchen
 * still works on a laptop with JavaScript broken. The board's drag, price and
 * switch need JavaScript by nature; these do not, so they do not.
 *
 * They are drawn as icon buttons now, because a row carrying "Rename",
 * "Archive section", "Take off" and "Remove" as words was four buttons of
 * noise per row. Each keeps its words as its accessible name and its tooltip.
 */

export function RenameSection({
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
    <details className={studio.popover}>
      <summary className={studio.iconButton} aria-label={`Rename ${name}`} title="Rename">
        <Pencil size={16} strokeWidth={1.75} aria-hidden="true" />
      </summary>
      <form action={action} className={`${styles.stackedForm} ${studio.popoverPanel}`}>
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

export function ArchiveSection({
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
    <form action={action} className={studio.iconForm}>
      <input type="hidden" name="propertyId" value={propertyId} />
      <input type="hidden" name="outletId" value={outletId} />
      <input type="hidden" name="categoryId" value={categoryId} />
      <IconSubmit
        label="Archive section"
        title={
          itemCount
            ? `Move or remove its ${itemCount} dishes first`
            : 'Archive this empty section'
        }
      >
        <Archive size={16} strokeWidth={1.75} aria-hidden="true" />
      </IconSubmit>
      {state.error ? <span className={studio.formError} role="alert">{state.error}</span> : null}
    </form>
  );
}

export function ArchiveDish({
  propertyId,
  outletId,
  itemId,
  name,
}: {
  propertyId: string;
  outletId: string;
  itemId: string;
  name: string;
}) {
  const [state, action] = useActionState<MenuActionState, FormData>(archiveItem, {});

  return (
    <form
      action={action}
      className={studio.iconForm}
      // A small icon is easy to hit by accident, and there is no screen that
      // brings an archived dish back. One question, and only here.
      onSubmit={(event) => {
        if (!window.confirm(`Take ${name} off the menu for good? Past receipts keep it.`)) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="propertyId" value={propertyId} />
      <input type="hidden" name="outletId" value={outletId} />
      <input type="hidden" name="itemId" value={itemId} />
      <IconSubmit label="Remove" title={`Take ${name} off the menu for good`} danger>
        <Trash2 size={16} strokeWidth={1.75} aria-hidden="true" />
      </IconSubmit>
      {state.error ? <span className={studio.formError} role="alert">{state.error}</span> : null}
    </form>
  );
}

export function NewSection({ propertyId, outletId }: { propertyId: string; outletId: string }) {
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

export function OutletSwitch({
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

function IconSubmit({
  label,
  title,
  danger = false,
  children,
}: {
  label: string;
  title: string;
  danger?: boolean;
  children: React.ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={studio.iconButton}
      data-tone={danger ? 'danger' : undefined}
      aria-label={label}
      title={title}
      disabled={pending}
    >
      {children}
    </button>
  );
}
