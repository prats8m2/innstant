'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  addFloor, renameFloorAction, removeFloor, saveRoom, setRoomInService,
  type PropertyState,
} from './actions';
import styles from '../admin.module.css';

/**
 * Floors and rooms.
 *
 * Every mutation is a `<form action={...}>` posting to a Server Action, the way
 * every other editor in this console works — the screen is usable with
 * JavaScript off, and `useActionState` only adds the message and the pending
 * state on top.
 */
export interface FloorView {
  id: string;
  name: string;
  level: number;
  /** Out-of-service rooms included: they still hold the floor by FK. */
  roomCount: number;
}

export interface RoomSetupView {
  id: string;
  number: string;
  floorId: string;
  roomTypeId: string;
  roomTypeName: string | null;
  archived: boolean;
}

export interface RoomTypeView {
  id: string;
  name: string;
}

export function PropertyEditor({
  propertyId,
  floors,
  rooms,
  roomTypes,
  mayManage,
}: {
  propertyId: string;
  floors: FloorView[];
  rooms: RoomSetupView[];
  roomTypes: RoomTypeView[];
  mayManage: boolean;
}) {
  return (
    <>
      <section className={styles.section}>
        <header className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Floors</h2>
          <p className={styles.sectionBlurb}>
            The level is the storey, and what orders them. A floor can only be
            deleted once nothing is on it.
          </p>
        </header>

        {floors.length ? (
          <ul className={styles.dishes}>
            {floors.map((floor) => (
              <Floor
                key={floor.id}
                propertyId={propertyId}
                floor={floor}
                mayManage={mayManage}
              />
            ))}
          </ul>
        ) : (
          <p className={styles.sectionEmpty}>
            No floors yet. Add one before you can add a room.
          </p>
        )}

        {mayManage ? <NewFloor propertyId={propertyId} /> : null}
      </section>

      {floors.map((floor) => {
        const onFloor = rooms.filter((room) => room.floorId === floor.id);
        return (
          <section key={floor.id} className={styles.section}>
            <header className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>{floor.name}</h2>
              <p className={styles.sectionBlurb}>
                {onFloor.length
                  ? `${onFloor.length} ${onFloor.length === 1 ? 'room' : 'rooms'}`
                  : 'Nothing here yet.'}
              </p>
            </header>

            {onFloor.length ? (
              <ul className={styles.dishes}>
                {onFloor.map((room) => (
                  <Room
                    key={room.id}
                    propertyId={propertyId}
                    room={room}
                    floors={floors}
                    roomTypes={roomTypes}
                    mayManage={mayManage}
                  />
                ))}
              </ul>
            ) : null}

            {mayManage && roomTypes.length ? (
              <NewRoom
                propertyId={propertyId}
                floor={floor}
                floors={floors}
                roomTypes={roomTypes}
              />
            ) : null}
          </section>
        );
      })}

      {mayManage && !roomTypes.length ? (
        <p className={styles.sectionEmpty}>
          This property has no room types, so a room has nothing to be. They are
          created with the property — see <code>provisionProperty()</code>.
        </p>
      ) : null}
    </>
  );
}

/* ── Floors ─────────────────────────────────────────────────────────────── */

function Floor({
  propertyId,
  floor,
  mayManage,
}: {
  propertyId: string;
  floor: FloorView;
  mayManage: boolean;
}) {
  return (
    <li className={`${styles.dish} ${styles.typeRow}`} data-floor={floor.level}>
      <span className={styles.dishBody}>
        <span className={styles.dishName}>{floor.name}</span>
        <span className={styles.dishFlags}>
          level {floor.level} ·{' '}
          {floor.roomCount
            ? `${floor.roomCount} ${floor.roomCount === 1 ? 'room' : 'rooms'}`
            : 'empty'}
        </span>
      </span>

      {mayManage ? (
        <>
          <RenameFloor propertyId={propertyId} floor={floor} />
          <DeleteFloor propertyId={propertyId} floor={floor} />
        </>
      ) : null}
    </li>
  );
}

function RenameFloor({ propertyId, floor }: { propertyId: string; floor: FloorView }) {
  const [state, action] = useActionState<PropertyState, FormData>(renameFloorAction, {});

  return (
    <details className={styles.roomForm}>
      <summary className={styles.disclosureHead}>Rename</summary>
      <form action={action} className={styles.stackedForm}>
        <input type="hidden" name="propertyId" value={propertyId} />
        <input type="hidden" name="floorId" value={floor.id} />
        <label className={styles.field}>
          <span className={styles.label}>Floor name</span>
          <input
            name="name"
            defaultValue={floor.name}
            className={styles.input}
            required
            maxLength={80}
          />
        </label>
        {state.error ? <p className={styles.inlineError} role="alert">{state.error}</p> : null}
        <SubmitButton label="Save" primary />
      </form>
    </details>
  );
}

function DeleteFloor({ propertyId, floor }: { propertyId: string; floor: FloorView }) {
  const [state, action] = useActionState<PropertyState, FormData>(removeFloor, {});

  return (
    <form action={action} className={styles.inlineForm}>
      <input type="hidden" name="propertyId" value={propertyId} />
      <input type="hidden" name="floorId" value={floor.id} />
      <SubmitButton
        label="Delete"
        title={
          floor.roomCount
            ? `Move or remove its ${floor.roomCount} rooms first`
            : `Delete ${floor.name}`
        }
      />
      {state.error ? <span className={styles.inlineError} role="alert">{state.error}</span> : null}
    </form>
  );
}

function NewFloor({ propertyId }: { propertyId: string }) {
  const [state, action] = useActionState<PropertyState, FormData>(addFloor, {});

  return (
    <details className={styles.newSection}>
      <summary className={styles.disclosureHead}>Add a floor</summary>
      <form action={action} className={styles.stackedForm}>
        <input type="hidden" name="propertyId" value={propertyId} />
        <div className={styles.formGrid}>
          <label className={styles.field}>
            <span className={styles.label}>Name</span>
            <input name="name" className={styles.input} required maxLength={80}
              placeholder="Third" />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Level</span>
            <input name="level" type="number" min={-5} max={200} className={styles.input}
              required placeholder="3" />
            <span className={styles.hint}>
              The storey. 0 is the ground floor; basements are negative.
            </span>
          </label>
        </div>
        {state.error ? <p className={styles.inlineError} role="alert">{state.error}</p> : null}
        {state.done ? <p className={styles.inlineDone}>{state.done}</p> : null}
        <SubmitButton label="Add the floor" primary />
      </form>
    </details>
  );
}

/* ── Rooms ──────────────────────────────────────────────────────────────── */

function Room({
  propertyId,
  room,
  floors,
  roomTypes,
  mayManage,
}: {
  propertyId: string;
  room: RoomSetupView;
  floors: FloorView[];
  roomTypes: RoomTypeView[];
  mayManage: boolean;
}) {
  return (
    <li
      className={`${styles.dish} ${styles.typeRow}`}
      data-available={!room.archived}
      data-room={room.number}
    >
      <span className={styles.dishBody}>
        <span className={styles.dishName}>
          {room.number}
          {room.archived ? <span className={styles.offTag}>out of service</span> : null}
        </span>
        <span className={styles.dishFlags}>{room.roomTypeName ?? 'No room type'}</span>
      </span>

      {mayManage ? (
        <>
          {room.archived ? null : (
            <EditRoom
              propertyId={propertyId}
              room={room}
              floors={floors}
              roomTypes={roomTypes}
            />
          )}
          <ServiceSwitch propertyId={propertyId} room={room} />
        </>
      ) : null}
    </li>
  );
}

function ServiceSwitch({ propertyId, room }: { propertyId: string; room: RoomSetupView }) {
  const [state, action] = useActionState<PropertyState, FormData>(setRoomInService, {});

  return (
    <form action={action} className={styles.inlineForm}>
      <input type="hidden" name="propertyId" value={propertyId} />
      <input type="hidden" name="roomId" value={room.id} />
      <input type="hidden" name="restore" value={String(room.archived)} />
      <SubmitButton
        label={room.archived ? 'Bring back' : 'Take out'}
        title={
          room.archived
            ? `Put ${room.number} back in service with a new QR sticker`
            : `Take ${room.number} out of service — its QR sticker stops working`
        }
      />
      {state.error ? <span className={styles.inlineError} role="alert">{state.error}</span> : null}
    </form>
  );
}

function EditRoom({
  propertyId,
  room,
  floors,
  roomTypes,
}: {
  propertyId: string;
  room: RoomSetupView;
  floors: FloorView[];
  roomTypes: RoomTypeView[];
}) {
  const [state, action] = useActionState<PropertyState, FormData>(saveRoom, {});

  return (
    <details className={styles.roomForm}>
      <summary className={styles.disclosureHead}>Edit</summary>
      <form action={action} className={styles.stackedForm}>
        <input type="hidden" name="propertyId" value={propertyId} />
        <input type="hidden" name="roomId" value={room.id} />
        <RoomFields room={room} floors={floors} roomTypes={roomTypes} />
        {state.error ? <p className={styles.inlineError} role="alert">{state.error}</p> : null}
        {state.done ? <p className={styles.inlineDone}>{state.done}</p> : null}
        <SubmitButton label="Save" primary />
      </form>
    </details>
  );
}

function NewRoom({
  propertyId,
  floor,
  floors,
  roomTypes,
}: {
  propertyId: string;
  floor: FloorView;
  floors: FloorView[];
  roomTypes: RoomTypeView[];
}) {
  const [state, action] = useActionState<PropertyState, FormData>(saveRoom, {});

  return (
    <details className={styles.newSection}>
      <summary className={styles.disclosureHead}>Add a room to {floor.name}</summary>
      <form action={action} className={styles.stackedForm}>
        <input type="hidden" name="propertyId" value={propertyId} />
        <RoomFields room={null} floors={floors} roomTypes={roomTypes} defaultFloorId={floor.id} />
        {state.error ? <p className={styles.inlineError} role="alert">{state.error}</p> : null}
        {state.done ? <p className={styles.inlineDone}>{state.done}</p> : null}
        <SubmitButton label={`Add it to ${floor.name}`} primary />
      </form>
    </details>
  );
}

function RoomFields({
  room,
  floors,
  roomTypes,
  defaultFloorId,
}: {
  room: RoomSetupView | null;
  floors: FloorView[];
  roomTypes: RoomTypeView[];
  defaultFloorId?: string;
}) {
  return (
    <div className={styles.formGrid}>
      <label className={styles.field}>
        <span className={styles.label}>Number</span>
        <input
          name="number"
          defaultValue={room?.number ?? ''}
          className={styles.input}
          required
          maxLength={16}
          placeholder="215"
        />
        {/* A label, not a number: "004", "2A" and "Cottage 3" are all real, and
            the key rack keeps the leading zero. */}
        <span className={styles.hint}>However it reads on the key rack.</span>
      </label>

      <label className={styles.field}>
        <span className={styles.label}>Floor</span>
        <select
          name="floorId"
          defaultValue={room?.floorId ?? defaultFloorId ?? ''}
          className={styles.input}
          required
        >
          {floors.map((floor) => (
            <option key={floor.id} value={floor.id}>{floor.name}</option>
          ))}
        </select>
      </label>

      <label className={styles.field}>
        <span className={styles.label}>Room type</span>
        <select
          name="roomTypeId"
          defaultValue={room?.roomTypeId ?? roomTypes[0]?.id ?? ''}
          className={styles.input}
          required
        >
          {roomTypes.map((type) => (
            <option key={type.id} value={type.id}>{type.name}</option>
          ))}
        </select>
        {/* #11 — a room type is what a rate plan will attach to one day. It is
            never a price, and there is nowhere here to put one. */}
        <span className={styles.hint}>What it is, never what it costs.</span>
      </label>
    </div>
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
