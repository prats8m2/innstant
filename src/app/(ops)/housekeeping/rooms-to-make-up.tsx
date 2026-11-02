'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Brush, Sparkles } from 'lucide-react';
import { setRoomState, type DeskState } from '@/app/(admin)/admin/rooms/actions';
import styles from './housekeeping.module.css';

export interface RoomToMakeUp {
  id: string;
  number: string;
  floorId: string;
  floorName: string;
  /** DIRTY to make up; CLEAN (made up today) for whoever inspects. */
  status: 'DIRTY' | 'CLEAN';
}

/**
 * The rooms the guests have left (D-096): checkout marks a room DIRTY, it
 * shows here, and "Made up" is the tap that lets the desk sell it again. An
 * inspector sees what was made up today with "Inspected" — the second
 * signature, as on a request.
 *
 * The floors this person covers come first; the rest stay visible, because
 * a room in the next corridor is still a room the next guest is waiting for.
 */
export function RoomsToMakeUp({
  propertyId,
  rooms,
  myFloorIds,
  mayClean,
  mayInspect,
}: {
  propertyId: string;
  rooms: RoomToMakeUp[];
  myFloorIds: string[];
  mayClean: boolean;
  mayInspect: boolean;
}) {
  if (!rooms.length) return null;
  const mine = (room: RoomToMakeUp) => myFloorIds.includes(room.floorId);
  const ordered = [...rooms].sort((a, b) =>
    Number(mine(b)) - Number(mine(a)) || Number(b.status === 'DIRTY') - Number(a.status === 'DIRTY') || a.number.localeCompare(b.number, undefined, { numeric: true }));
  const dirty = rooms.filter((r) => r.status === 'DIRTY').length;

  return (
    <section className={styles.roomsToMake} aria-labelledby="rooms-to-make-up">
      <h2 id="rooms-to-make-up" className={styles.groupTitle}>
        Rooms to make up <span className={`${styles.groupCount} tabular`}>{dirty}</span>
      </h2>
      <ul className={styles.roomChips}>
        {ordered.map((room) => (
          <li key={room.id} className={styles.roomChip} data-status={room.status} data-room-to-make={room.number}>
            <span className={styles.roomChipText}>
              <span className={`${styles.roomChipNumber} tabular`}>{room.number}</span>
              <span className={styles.roomChipFloor}>
                {room.status === 'DIRTY'
                  ? <><Brush size={12} aria-hidden="true" /> {room.floorName}</>
                  : <><Sparkles size={12} aria-hidden="true" /> made up · {room.floorName}</>}
              </span>
            </span>
            {room.status === 'DIRTY' && mayClean ? (
              <Mark propertyId={propertyId} roomId={room.id} to="CLEAN" label="Made up" />
            ) : room.status === 'CLEAN' && mayInspect ? (
              <Mark propertyId={propertyId} roomId={room.id} to="INSPECTED" label="Inspected" />
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Mark({ propertyId, roomId, to, label }: { propertyId: string; roomId: string; to: string; label: string }) {
  const [state, action] = useActionState<DeskState, FormData>(setRoomState, {});
  return (
    <form action={action}>
      <input type="hidden" name="propertyId" value={propertyId} />
      <input type="hidden" name="roomId" value={roomId} />
      <input type="hidden" name="status" value={to} />
      <MarkButton label={label} />
      {state.error ? <span className={styles.error} role="alert">{state.error}</span> : null}
    </form>
  );
}

function MarkButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={styles.roomChipButton} disabled={pending}>
      {pending ? '…' : label}
    </button>
  );
}
