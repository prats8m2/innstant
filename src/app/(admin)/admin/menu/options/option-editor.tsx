'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import type { AdminModifierGroupDetail, AdminModifierOption } from '@/modules/catalog';
import { formatMoney, money } from '@/lib/money';
import {
  saveGroup, saveOption, removeGroup, removeOption, type OptionActionState,
} from './actions';
import styles from '../../admin.module.css';

/**
 * Option groups and what they cost.
 *
 * A group is SHARED — "Chilli" is one row carried by seven dishes — so every
 * heading here says how many dishes it affects. That count is the whole reason
 * this screen is separate from the dish form: an edit made here is an edit to
 * every dish carrying the group, and a screen that hid that would be lying by
 * omission.
 */
export function OptionEditor({
  propertyId,
  outletId,
  groups,
}: {
  propertyId: string;
  outletId: string;
  groups: AdminModifierGroupDetail[];
}) {
  return (
    <>
      {groups.map((group) => (
        <section key={group.id} className={styles.section}>
          <header className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>{group.name}</h2>
            <span className={styles.collectionState}>
              {group.isRequired ? 'required · ' : ''}
              {group.minSelections === group.maxSelections
                ? `choose ${group.maxSelections}`
                : `choose ${group.minSelections}–${group.maxSelections}`}
              {' · '}
              {group.dishCount} {group.dishCount === 1 ? 'dish' : 'dishes'}
            </span>
          </header>

          <ul className={styles.options}>
            {group.options.map((option) => (
              <Option
                key={option.id}
                propertyId={propertyId}
                outletId={outletId}
                groupId={group.id}
                option={option}
                canRemove={group.options.length > 1}
              />
            ))}
          </ul>

          <details className={styles.collectionDetails}>
            <summary className={styles.disclosureHead}>Add an option</summary>
            <OptionForm propertyId={propertyId} outletId={outletId} groupId={group.id} />
          </details>

          <details className={styles.collectionDetails}>
            <summary className={styles.disclosureHead}>Group settings</summary>
            <GroupForm propertyId={propertyId} outletId={outletId} group={group} />
            <ArchiveGroup
              propertyId={propertyId}
              outletId={outletId}
              groupId={group.id}
              dishCount={group.dishCount}
            />
          </details>
        </section>
      ))}

      <details className={styles.newSection}>
        <summary className={styles.disclosureHead}>Add a group</summary>
        <GroupForm propertyId={propertyId} outletId={outletId} />
      </details>

      <p className={styles.footnote}>
        A price here is a difference, not a price: <code>+120</code> adds ₹120 to any
        dish carrying the group, and <code>-50</code> takes ₹50 off. Editing an option
        changes every dish that carries its group — and never changes a past
        receipt, because each order line stores the option name and the amount it
        was actually charged.
      </p>
    </>
  );
}

/* ── One option, editable in place ──────────────────────────────────────── */

function Option({
  propertyId,
  outletId,
  groupId,
  option,
  canRemove,
}: {
  propertyId: string;
  outletId: string;
  groupId: string;
  option: AdminModifierOption;
  canRemove: boolean;
}) {
  return (
    <li className={styles.option}>
      <details>
        <summary className={styles.optionSummary}>
          <span className={styles.optionName}>
            {option.name}
            {option.isDefault ? <em className={styles.defaultTag}> default</em> : null}
            {option.isAvailable ? null : <em className={styles.offTag}> off</em>}
          </span>
          <span className={`${styles.optionDelta} tabular`}>
            {option.priceDeltaMinor === 0
              ? 'no change'
              : `${option.priceDeltaMinor > 0 ? '+' : '−'}${formatMoney(
                  money(Math.abs(option.priceDeltaMinor), option.currency),
                )}`}
          </span>
        </summary>

        <OptionForm
          propertyId={propertyId}
          outletId={outletId}
          groupId={groupId}
          option={option}
        />
        {canRemove ? (
          <ArchiveOption
            propertyId={propertyId}
            outletId={outletId}
            groupId={groupId}
            optionId={option.id}
          />
        ) : (
          <p className={styles.hint}>
            The last option in a group cannot be removed — archive the group instead.
          </p>
        )}
      </details>
    </li>
  );
}

function OptionForm({
  propertyId,
  outletId,
  groupId,
  option,
}: {
  propertyId: string;
  outletId: string;
  groupId: string;
  option?: AdminModifierOption;
}) {
  const [state, action] = useActionState<OptionActionState, FormData>(saveOption, {});

  const deltaDefault = option
    ? (option.priceDeltaMinor / 100).toString()
    : '';

  return (
    <form action={action} className={styles.stackedForm}>
      <input type="hidden" name="propertyId" value={propertyId} />
      <input type="hidden" name="outletId" value={outletId} />
      <input type="hidden" name="groupId" value={groupId} />
      {option ? <input type="hidden" name="optionId" value={option.id} /> : null}

      <label className={styles.field}>
        <span className={styles.label}>What the guest reads</span>
        <input
          name="name"
          className={styles.input}
          defaultValue={option?.name ?? ''}
          required
          maxLength={120}
          placeholder="Extra fiery"
        />
      </label>

      <label className={styles.field}>
        <span className={styles.label}>Price difference</span>
        <input
          name="priceDelta"
          className={styles.input}
          defaultValue={deltaDefault}
          inputMode="decimal"
          placeholder="0"
        />
        <span className={styles.hint}>
          Rupees, added to the dish. 0 for no change, and −50 to take money off.
        </span>
      </label>

      <label className={styles.check}>
        <input
          type="checkbox"
          name="isDefault"
          defaultChecked={option?.isDefault ?? false}
        />
        <span>Chosen for the guest by default</span>
      </label>

      <label className={styles.check}>
        <input
          type="checkbox"
          name="isAvailable"
          defaultChecked={option?.isAvailable ?? true}
        />
        <span>Available tonight</span>
      </label>

      {state.error ? <p className={styles.formError} role="alert">{state.error}</p> : null}
      {state.done ? <p className={styles.formDone}>{state.done}</p> : null}

      <div className={styles.formActions}>
        <SubmitPrimary label={option ? 'Save the option' : 'Add the option'} />
      </div>
    </form>
  );
}

/* ── The group itself ───────────────────────────────────────────────────── */

function GroupForm({
  propertyId,
  outletId,
  group,
}: {
  propertyId: string;
  outletId: string;
  group?: AdminModifierGroupDetail;
}) {
  const [state, action] = useActionState<OptionActionState, FormData>(saveGroup, {});

  return (
    <form action={action} className={styles.stackedForm}>
      <input type="hidden" name="propertyId" value={propertyId} />
      <input type="hidden" name="outletId" value={outletId} />
      {group ? <input type="hidden" name="groupId" value={group.id} /> : null}

      <label className={styles.field}>
        <span className={styles.label}>Group name</span>
        <input
          name="name"
          className={styles.input}
          defaultValue={group?.name ?? ''}
          required
          maxLength={120}
          placeholder="Chilli"
        />
        <span className={styles.hint}>
          The guest sees this as a heading above the choices.
        </span>
      </label>

      <label className={styles.field}>
        <span className={styles.label}>Fewest they may choose</span>
        <input
          name="minSelections"
          className={styles.input}
          type="number"
          min={0}
          max={20}
          defaultValue={group?.minSelections ?? 0}
        />
      </label>

      <label className={styles.field}>
        <span className={styles.label}>Most they may choose</span>
        <input
          name="maxSelections"
          className={styles.input}
          type="number"
          min={1}
          max={20}
          defaultValue={group?.maxSelections ?? 1}
        />
        <span className={styles.hint}>1 makes it a single choice, like heat level.</span>
      </label>

      <label className={styles.check}>
        <input
          type="checkbox"
          name="isRequired"
          defaultChecked={group?.isRequired ?? false}
        />
        <span>The guest must choose before ordering</span>
      </label>

      {state.error ? <p className={styles.formError} role="alert">{state.error}</p> : null}
      {state.done ? <p className={styles.formDone}>{state.done}</p> : null}

      <div className={styles.formActions}>
        <SubmitPrimary label={group ? 'Save the group' : 'Add the group'} />
      </div>
    </form>
  );
}

/**
 * Archiving a shared group.
 *
 * Two separate forms, not one with a flag: the plain one refuses while dishes
 * carry the group and says how many, and the second exists only when there ARE
 * dishes and carries the count in its own label. Nobody archives a group off
 * seven dishes without having read the number.
 *
 * (One form with two submit buttons was the first attempt. Two controls named
 * the same thing put two values in the FormData and `get()` returns the first —
 * the button would have been ignored.)
 */
function ArchiveGroup({
  propertyId,
  outletId,
  groupId,
  dishCount,
}: {
  propertyId: string;
  outletId: string;
  groupId: string;
  dishCount: number;
}) {
  return (
    <div className={styles.archiveGroup}>
      <ArchiveGroupForm
        propertyId={propertyId}
        outletId={outletId}
        groupId={groupId}
        detach={false}
        label="Archive this group"
      />
      {dishCount > 0 ? (
        <ArchiveGroupForm
          propertyId={propertyId}
          outletId={outletId}
          groupId={groupId}
          detach
          label={`Archive and take it off ${dishCount} ${dishCount === 1 ? 'dish' : 'dishes'}`}
        />
      ) : null}
    </div>
  );
}

function ArchiveGroupForm({
  propertyId,
  outletId,
  groupId,
  detach,
  label,
}: {
  propertyId: string;
  outletId: string;
  groupId: string;
  detach: boolean;
  label: string;
}) {
  const [state, action] = useActionState<OptionActionState, FormData>(removeGroup, {});

  return (
    <form action={action} className={styles.inlineForm}>
      <input type="hidden" name="propertyId" value={propertyId} />
      <input type="hidden" name="outletId" value={outletId} />
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="detachFromDishes" value={String(detach)} />
      <SubmitSecondary label={label} />
      {state.error ? <p className={styles.formError} role="alert">{state.error}</p> : null}
      {state.done ? <p className={styles.formDone}>{state.done}</p> : null}
    </form>
  );
}

function ArchiveOption({
  propertyId,
  outletId,
  groupId,
  optionId,
}: {
  propertyId: string;
  outletId: string;
  groupId: string;
  optionId: string;
}) {
  const [state, action] = useActionState<OptionActionState, FormData>(removeOption, {});

  return (
    <form action={action} className={styles.inlineForm}>
      <input type="hidden" name="propertyId" value={propertyId} />
      <input type="hidden" name="outletId" value={outletId} />
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="optionId" value={optionId} />
      <SubmitSecondary label="Remove this option" />
      {state.error ? <span className={styles.inlineError} role="alert">{state.error}</span> : null}
    </form>
  );
}

function SubmitPrimary({ label }: { label: string }) {
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
