'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { BedDouble, Sparkles } from 'lucide-react';
import { setRoomState, type DeskState } from '@/app/(admin)/admin/rooms/actions';
import styles from './housekeeping.module.css';

export interface RoomToMakeUp {
  id: string;
  number: string;
  floorId: string;
  floorName: string;
  /** DIRTY to make up; CLEAN (made up today) for whoever inspects. */
  status: 'DIRTY' | 'CLEAN';
  /** When the room went into this state — how long it has been waiting. */
  since: Date | string | null;
}

/**
 * The rooms the guests have left (D-096): checkout marks a room DIRTY, it
 * shows here, and "Made up" is the tap that lets the desk sell it again. An
 * inspector sees what was made up today with "Inspected" — the second
 * signature, as on a request.
 *
 * The floors this person covers come first; the rest stay visible, because
 * a room in the next corridor is still a room the next guest is waiting for.
 *
 * Direction A draws these as "Make up · checked out · Arrival at 10pm" with
 * "Take it". What the product holds is the state and when it was set: there
 * are no reservations to give an arrival time, the room state does not say
 * WHY it is to make up (checkout, or the desk), and nobody claims a room —
 * so the row says how long it has waited and offers the one tap there is.
 */
export function RoomsToMakeUp({
  propertyId,
  rooms,
  myFloorIds,
  mayClean,
  mayInspect,
  renderedAt,
}: {
  propertyId: string;
  rooms: RoomToMakeUp[];
  myFloorIds: string[];
  mayClean: boolean;
  mayInspect: boolean;
  renderedAt: number;
}) {
  const now = useMinute(renderedAt);
  if (!rooms.length) return null;
  const mine = (room: RoomToMakeUp) => myFloorIds.includes(room.floorId);
  const ordered = [...rooms].sort((a, b) =>
    Number(mine(b)) - Number(mine(a)) || Number(b.status === 'DIRTY') - Number(a.status === 'DIRTY') || a.number.localeCompare(b.number, undefined, { numeric: true }));
  const dirty = rooms.filter((r) => r.status === 'DIRTY').length;

  return (
    <section className={styles.group} aria-labelledby="rooms-to-make-up">
      <h2 id="rooms-to-make-up" className={styles.groupTitle}>
        Rooms to make up <span className="tabular">{dirty}</span>
      </h2>
      <ul className={styles.board}>
        {ordered.map((room) => {
          const waited = room.since
            ? Math.max(0, Math.round((now - new Date(room.since).getTime()) / 60_000))
            : null;
          return (
            <li
              key={room.id}
              className={styles.roomRow}
              data-status={room.status}
              data-room-to-make={room.number}
            >
              <span className={`${styles.rowRoom} tabular`}>{room.number}</span>
              <span className={styles.rowBody}>
                <span className={styles.rowLabel}>
                  {room.status === 'DIRTY'
                    ? <><BedDouble size={16} aria-hidden="true" /> Make up</>
                    : <><Sparkles size={16} aria-hidden="true" /> Made up · needs a check</>}
                </span>
                <span className={styles.rowSub} data-tone={room.status === 'DIRTY' ? 'warn' : undefined}>
                  {room.floorName}
                  {room.status === 'DIRTY' && waited !== null ? (
                    <> · waiting <span className="tabular">{waited}</span> min</>
                  ) : null}
                </span>
              </span>
              {room.status === 'DIRTY' && mayClean ? (
                <Mark propertyId={propertyId} roomId={room.id} to="CLEAN" label="Made up" />
              ) : room.status === 'CLEAN' && mayInspect ? (
                <Mark propertyId={propertyId} roomId={room.id} to="INSPECTED" label="Inspected" />
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Mark({ propertyId, roomId, to, label }: { propertyId: string; roomId: string; to: string; label: string }) {
  const [state, action] = useActionState<DeskState, FormData>(setRoomState, {});
  return (
    <form action={action} className={styles.rowForm}>
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
    <button type="submit" className={styles.secondary} disabled={pending}>
      {pending ? '…' : label}
    </button>
  );
}

/** The minute, ticking, so "waiting 40 min" moves without a refresh. */
function useMinute(renderedAt: number): number {
  const [now, setNow] = useState(renderedAt);
  useEffect(() => {
    setNow(Date.now());
    const tick = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(tick);
  }, []);
  return now;
}
