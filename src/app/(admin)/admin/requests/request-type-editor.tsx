'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import type { AdminRequestType, RequestCategory } from '@/modules/requests';
import type { PropertyRole } from '@/modules/identity';
import { formatMoney, money } from '@/lib/money';
import {
  saveRequestType, toggleRequestType, archiveType, type RequestTypeActionState,
} from './actions';
import styles from '../admin.module.css';

/**
 * The request catalog, editable.
 *
 * Same shape as the menu editor and for the same reasons: every mutation is a
 * `<form action={...}>` posting to a Server Action, so the screen works with
 * JavaScript off and `useActionState` only adds the message and the pending
 * state on top.
 *
 * Grouped by category because that is how the guest's amenities screen groups
 * them — a manager changing "Housekeeping" should be looking at the same four
 * headings the guest scrolls past.
 *
 * The constants and labels arrive as props rather than as imports: a client
 * component importing a VALUE from a `modules/*` index pulls the module's db
 * layer, `pg` follows it into the browser bundle, and the build fails with
 * `Can't resolve 'net'`. `import type` is erased and is fine.
 */
const CATEGORY_ORDER: readonly RequestCategory[] = [
  'AMENITY', 'HOUSEKEEPING', 'SERVICE', 'MAINTENANCE',
];

const CATEGORY_LABEL: Record<RequestCategory, string> = {
  AMENITY: 'Amenities',
  HOUSEKEEPING: 'Housekeeping',
  SERVICE: 'Service',
  MAINTENANCE: 'Maintenance',
};

/** #9, on screen. The one tap may not be priced — the form says so before it
 *  is tried, and `checkRequestTypeRules()` refuses it if it is. */
const UNPRICEABLE: readonly string[] = ['CALL_SERVICE'];

export function RequestTypeEditor({
  propertyId,
  types,
  roles,
  mayManage,
}: {
  propertyId: string;
  types: AdminRequestType[];
  roles: PropertyRole[];
  mayManage: boolean;
}) {
  const live = types.filter((type) => type.isActive).length;
  const chargeable = types.filter((type) => type.isChargeable).length;

  return (
    <>
      <header className={styles.pageHead}>
        <div>
          <h1 className={styles.title}>What guests can ask for</h1>
          <p className={styles.lede}>
            {live} of {types.length} on the guest&rsquo;s list ·{' '}
            {chargeable === 0
              ? 'all of them free'
              : `${chargeable} that ${chargeable === 1 ? 'costs' : 'cost'} something`}
          </p>
        </div>
      </header>

      {CATEGORY_ORDER.map((category) => {
        const inCategory = types.filter((type) => type.category === category);
        return (
          <section key={category} className={styles.section}>
            <header className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>{CATEGORY_LABEL[category]}</h2>
              <p className={styles.sectionBlurb}>
                {BLURBS[category]}
              </p>
            </header>

            {inCategory.length ? (
              <ul className={styles.dishes}>
                {inCategory.map((type) => (
                  <RequestTypeRow
                    key={type.id}
                    propertyId={propertyId}
                    type={type}
                    roles={roles}
                    mayManage={mayManage}
                  />
                ))}
              </ul>
            ) : (
              <p className={styles.sectionEmpty}>Nothing in this group yet.</p>
            )}
          </section>
        );
      })}

      {mayManage ? <NewRequestType propertyId={propertyId} roles={roles} /> : null}

      <p className={styles.footnote}>
        The minutes are two things at once: the promise a guest reads on the card
        and the deadline the SLA sweep escalates against. Shortening one shortens
        the other. Nothing here is deleted — a type taken off stays on the
        requests that used it, which snapshot their own label (#6).
      </p>
    </>
  );
}

const BLURBS: Record<RequestCategory, string> = {
  AMENITY: 'Things brought up to the room.',
  HOUSEKEEPING: 'Work done in the room.',
  SERVICE: 'Somebody comes, or something is arranged.',
  MAINTENANCE: 'Something is broken. These are the ones that take a photo.',
};

/* ── One type ───────────────────────────────────────────────────────────── */

function RequestTypeRow({
  propertyId,
  type,
  roles,
  mayManage,
}: {
  propertyId: string;
  type: AdminRequestType;
  roles: PropertyRole[];
  mayManage: boolean;
}) {
  const routedTo = roles.find((role) => role.key === type.routeToRoleKey);

  return (
    <li className={`${styles.dish} ${styles.typeRow}`} data-muted={!type.isActive}>
      <span className={styles.dishBody}>
        <span className={styles.dishName}>
          {type.name}
          {type.isActive ? null : <span className={styles.offTag}>off the list</span>}
        </span>
        {type.description ? (
          <span className={styles.dishBlurb}>{type.description}</span>
        ) : null}

        <span className={styles.dishFlags}>
          <span className="tabular">{type.slaMinutes} min</span>
          {' · '}
          {/* The routing role, with its headcount. A role nobody holds is the
              quiet failure this whole screen exists to make visible: routing
              works perfectly and nobody is ever assigned. */}
          <RouteNote roleKey={type.routeToRoleKey} role={routedTo} />
          {type.allowsQuantity ? ` · up to ${type.maxQuantity}` : null}
          {type.allowsPhoto ? ' · photo' : null}
          {type.allowsNote ? null : ' · no note'}
          {type.liveCount ? ` · ${type.liveCount} open now` : null}
        </span>
      </span>

      <span className={`${styles.dishPrice} tabular`}>
        {type.isChargeable ? formatMoney(money(type.priceMinor, type.currency)) : 'Free'}
      </span>

      {/*
        * One trailing cell, in the order a manager reaches for them: the thing
        * they came to do, then the switch, then the one that removes it. The
        * edit form opens anchored to the row rather than inside it.
        */}
      {mayManage ? (
        <span className={styles.rowEnd}>
          <EditType propertyId={propertyId} type={type} roles={roles} />
          <ActiveSwitch propertyId={propertyId} type={type} />
          <ArchiveTypeButton propertyId={propertyId} type={type} />
        </span>
      ) : null}
    </li>
  );
}

function RouteNote({ roleKey, role }: { roleKey: string; role: PropertyRole | undefined }) {
  if (!role) {
    return (
      <span className={styles.routeBroken}>
        goes to {roleKey}, which is not a role here
      </span>
    );
  }
  if (role.staffCount === 0) {
    return (
      <span className={styles.routeBroken}>
        goes to {role.name}, and nobody holds it
      </span>
    );
  }
  return <>goes to {role.name}</>;
}

/* ── The forms ──────────────────────────────────────────────────────────── */

function ActiveSwitch({ propertyId, type }: { propertyId: string; type: AdminRequestType }) {
  const [state, action] = useActionState<RequestTypeActionState, FormData>(toggleRequestType, {});

  return (
    <form action={action} className={styles.inlineForm}>
      <input type="hidden" name="propertyId" value={propertyId} />
      <input type="hidden" name="requestTypeId" value={type.id} />
      <input type="hidden" name="isActive" value={String(!type.isActive)} />
      <SubmitButton
        label={type.isActive ? 'Take off' : 'Put back'}
        title={
          type.isActive
            ? `Stop offering ${type.name}. Reversible, and open requests carry on.`
            : `Offer ${type.name} again`
        }
      />
      {state.error ? <span className={styles.inlineError} role="alert">{state.error}</span> : null}
    </form>
  );
}

function ArchiveTypeButton({ propertyId, type }: { propertyId: string; type: AdminRequestType }) {
  const [state, action] = useActionState<RequestTypeActionState, FormData>(archiveType, {});

  return (
    <form action={action} className={styles.inlineForm}>
      <input type="hidden" name="propertyId" value={propertyId} />
      <input type="hidden" name="requestTypeId" value={type.id} />
      <SubmitButton
        label="Remove"
        danger
        title={
          type.liveCount
            ? `Finish its ${type.liveCount} open ${type.liveCount === 1 ? 'request' : 'requests'} first`
            : `Take ${type.name} off for good`
        }
      />
      {state.error ? <span className={styles.inlineError} role="alert">{state.error}</span> : null}
    </form>
  );
}

function EditType({
  propertyId,
  type,
  roles,
}: {
  propertyId: string;
  type: AdminRequestType;
  roles: PropertyRole[];
}) {
  const [state, action] = useActionState<RequestTypeActionState, FormData>(saveRequestType, {});

  return (
    <details className={styles.typeForm}>
      <summary className={styles.disclosureHead}>Edit this</summary>
      <form action={action} className={styles.stackedForm}>
        <input type="hidden" name="propertyId" value={propertyId} />
        <input type="hidden" name="requestTypeId" value={type.id} />
        <Fields type={type} roles={roles} />
        {state.error ? <p className={styles.inlineError} role="alert">{state.error}</p> : null}
        {state.done ? <p className={styles.inlineDone}>{state.done}</p> : null}
        <SubmitButton label="Save" primary />
      </form>
    </details>
  );
}

function NewRequestType({ propertyId, roles }: { propertyId: string; roles: PropertyRole[] }) {
  const [state, action] = useActionState<RequestTypeActionState, FormData>(saveRequestType, {});

  return (
    <details className={styles.newSection}>
      <summary className={styles.disclosureHead}>Add something guests can ask for</summary>
      <form action={action} className={styles.stackedForm}>
        <input type="hidden" name="propertyId" value={propertyId} />
        <Fields type={null} roles={roles} />
        {state.error ? <p className={styles.inlineError} role="alert">{state.error}</p> : null}
        {state.done ? <p className={styles.inlineDone}>{state.done}</p> : null}
        <SubmitButton label="Add it" primary />
      </form>
    </details>
  );
}

/**
 * One set of fields, for both the edit and the create.
 *
 * `key` is deliberately absent. It is minted from the name once and never
 * changes: code finds `CALL_SERVICE` by it, and a key that moved when somebody
 * fixed a typo would break the one-tap screen with no error anywhere.
 */
function Fields({ type, roles }: { type: AdminRequestType | null; roles: PropertyRole[] }) {
  const unpriceable = type !== null && UNPRICEABLE.includes(type.key);

  return (
    <>
      <label className={styles.field}>
        <span className={styles.label}>What a guest sees</span>
        <input
          name="name"
          defaultValue={type?.name ?? ''}
          className={styles.input}
          required
          maxLength={120}
          placeholder="Extra towels"
        />
        {type ? (
          <span className={styles.hint}>
            Renaming is safe — the key stays <code>{type.key}</code>.
          </span>
        ) : null}
      </label>

      <label className={styles.field}>
        <span className={styles.label}>One line under it, optional</span>
        <input
          name="description"
          defaultValue={type?.description ?? ''}
          className={styles.input}
          maxLength={400}
          placeholder="Fresh from the linen room."
        />
      </label>

      <div className={styles.formGrid}>
        <label className={styles.field}>
          <span className={styles.label}>Group</span>
          <select
            name="category"
            defaultValue={type?.category ?? 'AMENITY'}
            className={styles.input}
          >
            {CATEGORY_ORDER.map((category) => (
              <option key={category} value={category}>{CATEGORY_LABEL[category]}</option>
            ))}
          </select>
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Promise, in minutes</span>
          <input
            name="slaMinutes"
            type="number"
            min={1}
            max={480}
            defaultValue={type?.slaMinutes ?? 15}
            className={styles.input}
            required
          />
          <span className={styles.hint}>
            The guest reads it, and the sweep escalates against it.
          </span>
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Price, blank for free</span>
          <input
            name="price"
            defaultValue={type && type.priceMinor ? String(type.priceMinor / 100) : ''}
            className={styles.input}
            inputMode="decimal"
            placeholder="0"
            disabled={unpriceable}
          />
          <span className={styles.hint}>
            {unpriceable
              ? 'Calling for service stays free — a price on it would ask the guest to verify who they are before anyone came up.'
              : 'Anything with a price asks the guest to confirm who they are, once.'}
          </span>
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Goes to</span>
          <select
            name="routeToRoleKey"
            defaultValue={type?.routeToRoleKey ?? 'HOUSEKEEPING'}
            className={styles.input}
            required
          >
            {roles.map((role) => (
              <option key={role.key} value={role.key}>
                {role.name}
                {role.staffCount === 0 ? ' — nobody holds this' : ` — ${role.staffCount}`}
              </option>
            ))}
          </select>
          <span className={styles.hint}>
            Whoever is clocked in, holds this role, and covers the floor.
          </span>
        </label>
      </div>

      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>What the guest may add</legend>
        <div className={styles.checkColumn}>
          <label className={styles.check}>
            <input
              type="checkbox"
              name="allowsQuantity"
              defaultChecked={type?.allowsQuantity ?? false}
            />
            <span>More than one at a time</span>
          </label>

          <label className={styles.field}>
            <span className={styles.label}>The most they may ask for</span>
            <input
              name="maxQuantity"
              type="number"
              min={1}
              max={20}
              defaultValue={type?.maxQuantity ?? 1}
              className={styles.input}
            />
            <span className={styles.hint}>Ignored unless the box above is ticked.</span>
          </label>

          <label className={styles.check}>
            <input type="checkbox" name="allowsNote" defaultChecked={type?.allowsNote ?? true} />
            <span>A note (&ldquo;by the door is fine&rdquo;)</span>
          </label>

          <label className={styles.check}>
            <input type="checkbox" name="allowsPhoto" defaultChecked={type?.allowsPhoto ?? false} />
            <span>A photo — worth it for anything broken</span>
          </label>
        </div>
      </fieldset>
    </>
  );
}

function SubmitButton({
  label,
  title,
  primary = false,
  danger = false,
}: {
  label: string;
  title?: string;
  primary?: boolean;
  /** Takes something off for good. */
  danger?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={danger ? styles.danger : primary ? styles.primary : styles.secondary}
      title={title}
      disabled={pending}
    >
      {pending ? '…' : label}
    </button>
  );
}
