'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import type { StaffShift } from '@/modules/housekeeping';
import { startShift, endShift, type BoardState } from './actions';
import styles from './housekeeping.module.css';

export interface FloorOption {
  id: string;
  name: string;
}

/**
 * On duty, and for which floors.
 *
 * At the top of the board because it is the thing that has to be true before the
 * board means anything: a request can only be routed to somebody who is clocked
 * in and covering the floor, so a screen that hides this control is a screen
 * where requests silently pile up unrouted.
 */
export function ShiftBar({
  propertyId,
  floors,
  shift,
}: {
  propertyId: string;
  floors: FloorOption[];
  shift: StaffShift | null;
}) {
  return shift
    ? <OnDuty propertyId={propertyId} floors={floors} shift={shift} />
    : <OffDuty propertyId={propertyId} floors={floors} />;
}

function OffDuty({ propertyId, floors }: { propertyId: string; floors: FloorOption[] }) {
  const [state, action] = useActionState<BoardState, FormData>(startShift, {});

  return (
    <form action={action} className={styles.shiftBar}>
      <input type="hidden" name="propertyId" value={propertyId} />

      <p className={styles.shiftLine}>
        You are not clocked in. Nothing will be routed to you until you are.
      </p>

      <div className={styles.floorPicker}>
        {floors.map((floor) => (
          <label key={floor.id} className={styles.floorCheck}>
            <input type="checkbox" name="floorIds" value={floor.id} />
            <span>{floor.name}</span>
          </label>
        ))}
      </div>

      {state.error ? <p className={styles.error} role="alert">{state.error}</p> : null}

      <ShiftButton label="Clock in" primary />
    </form>
  );
}

function OnDuty({
  propertyId,
  floors,
  shift,
}: {
  propertyId: string;
  floors: FloorOption[];
  shift: StaffShift;
}) {
  const [state, action] = useActionState<BoardState, FormData>(endShift, {});
  const covering = shift.zones.map((z) => z.floorName).join(' · ');

  return (
    <div className={styles.shiftBar} data-on="true">
      <p className={styles.shiftLine}>
        <span className={styles.onDutyDot} aria-hidden="true" />
        On duty · {covering || 'no floors'}
      </p>

      {/* Changing the floors mid-shift is the same form as clocking in — it
          replaces the zones rather than opening a second shift. */}
      <details className={styles.shiftDetails}>
        <summary className={styles.shiftSummary}>Change floors</summary>
        <ChangeFloors propertyId={propertyId} floors={floors} shift={shift} />
      </details>

      <form action={action}>
        <input type="hidden" name="propertyId" value={propertyId} />
        <ShiftButton label="Clock out" />
      </form>

      {state.error ? <p className={styles.error} role="alert">{state.error}</p> : null}
    </div>
  );
}

function ChangeFloors({
  propertyId,
  floors,
  shift,
}: {
  propertyId: string;
  floors: FloorOption[];
  shift: StaffShift;
}) {
  const [state, action] = useActionState<BoardState, FormData>(startShift, {});
  const covered = new Set(shift.zones.map((z) => z.floorId));

  return (
    <form action={action} className={styles.changeForm}>
      <input type="hidden" name="propertyId" value={propertyId} />
      <div className={styles.floorPicker}>
        {floors.map((floor) => (
          <label key={floor.id} className={styles.floorCheck}>
            <input
              type="checkbox"
              name="floorIds"
              value={floor.id}
              defaultChecked={covered.has(floor.id)}
            />
            <span>{floor.name}</span>
          </label>
        ))}
      </div>
      {state.error ? <p className={styles.error} role="alert">{state.error}</p> : null}
      <ShiftButton label="Save floors" />
    </form>
  );
}

function ShiftButton({ label, primary = false }: { label: string; primary?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={primary ? styles.primary : styles.secondary}
      disabled={pending}
    >
      {pending ? '…' : label}
    </button>
  );
}
