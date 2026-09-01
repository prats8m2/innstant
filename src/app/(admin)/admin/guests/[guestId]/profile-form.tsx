'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { saveGuestProfile, type GuestProfileState } from '../actions';
import styles from '../../admin.module.css';

/**
 * What this property writes down.
 *
 * The flag list arrives as a prop rather than being imported: a client component
 * importing a value from a `modules/*` index pulls the module's db layer, and
 * `pg` follows it into the browser bundle. Only `pnpm build` catches that.
 */
export function GuestProfileForm({
  propertyId,
  guestId,
  isVip,
  chargingBlocked,
  staffNotes,
  dietaryFlags,
  allFlags,
  mayEdit,
}: {
  propertyId: string;
  guestId: string;
  isVip: boolean;
  chargingBlocked: boolean;
  staffNotes: string | null;
  dietaryFlags: string[];
  allFlags: string[];
  mayEdit: boolean;
}) {
  const [state, action] = useActionState<GuestProfileState, FormData>(saveGuestProfile, {});

  if (!mayEdit) {
    return (
      <dl className={styles.readOnlyProfile}>
        <dt className={styles.label}>Allergies and diet</dt>
        <dd className={styles.readOnlyValue}>
          {dietaryFlags.length ? dietaryFlags.map(label).join(' · ') : 'None recorded'}
        </dd>
        <dt className={styles.label}>Charging</dt>
        <dd className={styles.readOnlyValue}>
          {chargingBlocked ? 'On hold' : 'Allowed'}
        </dd>
        <dt className={styles.label}>Notes</dt>
        <dd className={styles.readOnlyValue}>{staffNotes ?? 'None'}</dd>
      </dl>
    );
  }

  return (
    <form action={action} className={styles.stackedForm}>
      <input type="hidden" name="propertyId" value={propertyId} />
      <input type="hidden" name="guestId" value={guestId} />

      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Allergies and diet</legend>
        <div className={styles.checkRow}>
          {allFlags.map((flag) => (
            <label key={flag} className={styles.check}>
              <input
                type="checkbox"
                name="dietaryFlags"
                value={flag}
                defaultChecked={dietaryFlags.includes(flag)}
              />
              <span>{label(flag)}</span>
            </label>
          ))}
        </div>
        <p className={styles.hint}>
          These print on every kitchen ticket this guest sends.
        </p>
      </fieldset>

      <div className={styles.checkColumn}>
        <label className={styles.check}>
          <input type="checkbox" name="isVip" defaultChecked={isVip} />
          <span>VIP</span>
        </label>

        <label className={styles.check}>
          <input type="checkbox" name="chargingBlocked" defaultChecked={chargingBlocked} />
          <span>
            Hold charges to the room
            {/* The one control on this screen that refuses money. Say what it
                does and what it does not: a hold must never stop a guest asking
                for a towel (#9). */}
            <span className={styles.hint}>
              Refuses orders and anything that costs money. Free requests and
              calling for service still work.
            </span>
          </span>
        </label>
      </div>

      <label className={styles.field}>
        <span className={styles.label}>Notes for staff</span>
        <textarea
          name="staffNotes"
          defaultValue={staffNotes ?? ''}
          className={styles.textarea}
          rows={3}
          maxLength={2000}
          placeholder="Card declined on arrival — took a deposit."
        />
        <span className={styles.hint}>The guest never sees this.</span>
      </label>

      {state.error ? <p className={styles.inlineError} role="alert">{state.error}</p> : null}
      {state.done ? <p className={styles.inlineDone}>{state.done}</p> : null}

      <SaveButton />
    </form>
  );
}

/** `NUT_ALLERGY` → `nut allergy`, the way every other screen prints a flag. */
function label(flag: string): string {
  return flag.replace(/_/g, ' ').toLowerCase();
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={styles.primary} disabled={pending}>
      {pending ? 'Saving…' : 'Save'}
    </button>
  );
}
