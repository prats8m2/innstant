'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  addFloor, renameFloorAction, removeFloor, saveRoom, setRoomInService,
  saveRoomType, setRoomTypeInUse, savePropertySettings,
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

export interface SettingsView {
  name: string;
  timezone: string;
  currency: string;
  /** False once anything has been charged — the currency is write-once (D-043). */
  currencyStillOpen: boolean;
}

export interface RoomTypeView {
  id: string;
  name: string;
}

export interface RoomTypeSetupView extends RoomTypeView {
  code: string;
  maxOccupancy: number;
  /** Archived rooms included — they still point here by FK. */
  roomCount: number;
  archived: boolean;
}

export function PropertyEditor({
  propertyId,
  settings,
  floors,
  rooms,
  roomTypes,
  mayManage,
  mayEditSettings,
  timezones,
}: {
  propertyId: string;
  settings: SettingsView;
  floors: FloorView[];
  rooms: RoomSetupView[];
  roomTypes: RoomTypeSetupView[];
  mayManage: boolean;
  /** `property:update`, which is PROPERTY_ADMIN's alone. */
  mayEditSettings: boolean;
  timezones: string[];
}) {
  // Only the ones a room can still BE. A retired type keeps its rows and its
  // code; it just stops being offered.
  const offerable = roomTypes.filter((type) => !type.archived);

  return (
    <>
      <Settings
        propertyId={propertyId}
        settings={settings}
        timezones={timezones}
        mayEdit={mayEditSettings}
      />

      <section className={styles.section}>
        <header className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Room types</h2>
          <p className={styles.sectionBlurb}>
            What a room is — never what it costs. A price belongs to a rate plan
            for a type on a date, and there is nowhere here to put one.
          </p>
        </header>

        {roomTypes.length ? (
          <ul className={styles.dishes}>
            {roomTypes.map((type) => (
              <RoomType
                key={type.id}
                propertyId={propertyId}
                type={type}
                mayManage={mayManage}
              />
            ))}
          </ul>
        ) : (
          <p className={styles.sectionEmpty}>
            No room types yet. A room has to be one of these before it can exist.
          </p>
        )}

        {mayManage ? <NewRoomType propertyId={propertyId} /> : null}
      </section>

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
                    roomTypes={offerable}
                    mayManage={mayManage}
                  />
                ))}
              </ul>
            ) : null}

            {mayManage && offerable.length ? (
              <NewRoom
                propertyId={propertyId}
                floor={floor}
                floors={floors}
                roomTypes={offerable}
              />
            ) : null}
          </section>
        );
      })}

      {mayManage && !offerable.length ? (
        <p className={styles.sectionEmpty}>
          Every room type here is retired, so a room has nothing to be. Bring one
          back, or add another, before adding a room.
        </p>
      ) : null}
    </>
  );
}

/* ── The hotel itself ───────────────────────────────────────────────────── */

function Settings({
  propertyId,
  settings,
  timezones,
  mayEdit,
}: {
  propertyId: string;
  settings: SettingsView;
  timezones: string[];
  mayEdit: boolean;
}) {
  const [state, action] = useActionState<PropertyState, FormData>(savePropertySettings, {});

  return (
    <section className={styles.section}>
      <header className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>This hotel</h2>
        <p className={styles.sectionBlurb}>
          The name in the bar above, the clock every screen reads, and what the
          bill is in.
        </p>
      </header>

      {mayEdit ? (
        <form action={action} className={styles.stackedForm}>
          <input type="hidden" name="propertyId" value={propertyId} />

          <div className={styles.formGrid}>
            <label className={styles.field}>
              <span className={styles.label}>Name</span>
              <input
                name="name"
                defaultValue={settings.name}
                className={styles.input}
                required
                maxLength={120}
              />
            </label>

            <label className={styles.field}>
              <span className={styles.label}>Timezone</span>
              <select
                name="timezone"
                defaultValue={settings.timezone}
                className={styles.input}
                required
              >
                {timezones.map((zone) => (
                  <option key={zone} value={zone}>{zone}</option>
                ))}
              </select>
              {/* Not cosmetic: kitchen hours, availability windows and
                  business-day rollovers are all property-local. */}
              <span className={styles.hint}>
                Everything a guest reads is rendered here, never in the server&rsquo;s zone.
              </span>
            </label>

            <label className={styles.field}>
              <span className={styles.label}>Currency</span>
              <input
                name="currency"
                defaultValue={settings.currency}
                className={styles.input}
                required
                maxLength={3}
                /* Not disabled — the server decides, and a disabled input sends
                   nothing, which would read as "clear it". Read-only keeps the
                   value in the post and the refusal honest. */
                readOnly={!settings.currencyStillOpen}
              />
              <span className={styles.hint}>
                {settings.currencyStillOpen
                  ? 'Set it before the first order. Nothing converts a past bill.'
                  : 'Fixed — this hotel has already charged in it, and nothing converts a past bill.'}
              </span>
            </label>
          </div>

          {state.error ? <p className={styles.inlineError} role="alert">{state.error}</p> : null}
          {state.done ? <p className={styles.inlineDone}>{state.done}</p> : null}

          <SubmitButton label="Save" primary />
        </form>
      ) : (
        <ul className={styles.dishes}>
          <li className={`${styles.dish} ${styles.typeRow}`}>
            <span className={styles.dishBody}>
              <span className={styles.dishName}>{settings.name}</span>
              <span className={styles.dishFlags}>
                {settings.timezone} · {settings.currency}
              </span>
            </span>
          </li>
        </ul>
      )}
    </section>
  );
}

/* ── Room types ─────────────────────────────────────────────────────────── */

function RoomType({
  propertyId,
  type,
  mayManage,
}: {
  propertyId: string;
  type: RoomTypeSetupView;
  mayManage: boolean;
}) {
  return (
    <li
      className={`${styles.dish} ${styles.typeRow}`}
      data-muted={type.archived}
      data-room-type={type.code}
    >
      <span className={styles.dishBody}>
        <span className={styles.dishName}>
          {type.name}
          {type.archived ? <span className={styles.offTag} data-tone="neutral">retired</span> : null}
        </span>
        <span className={styles.dishFlags}>
          {type.code} · sleeps {type.maxOccupancy} ·{' '}
          {/* The count is what Retire refuses on, so it is shown before the
              button rather than after the refusal. */}
          {type.roomCount
            ? `${type.roomCount} ${type.roomCount === 1 ? 'room' : 'rooms'}`
            : 'no rooms'}
        </span>
      </span>

      {mayManage ? (
        <span className={styles.rowEnd}>
          {type.archived ? null : <EditRoomType propertyId={propertyId} type={type} />}
          <RoomTypeSwitch propertyId={propertyId} type={type} />
        </span>
      ) : null}
    </li>
  );
}

function RoomTypeSwitch({
  propertyId,
  type,
}: {
  propertyId: string;
  type: RoomTypeSetupView;
}) {
  const [state, action] = useActionState<PropertyState, FormData>(setRoomTypeInUse, {});

  return (
    <form action={action} className={styles.inlineForm}>
      <input type="hidden" name="propertyId" value={propertyId} />
      <input type="hidden" name="roomTypeId" value={type.id} />
      <input type="hidden" name="restore" value={String(type.archived)} />
      <SubmitButton
        label={type.archived ? 'Bring back' : 'Retire'}
        title={
          type.archived
            ? `Offer ${type.name} to rooms again`
            : type.roomCount
              ? `Change its ${type.roomCount} rooms first`
              : `Stop offering ${type.name}`
        }
      />
      {state.error ? <span className={styles.inlineError} role="alert">{state.error}</span> : null}
    </form>
  );
}

function EditRoomType({
  propertyId,
  type,
}: {
  propertyId: string;
  type: RoomTypeSetupView;
}) {
  const [state, action] = useActionState<PropertyState, FormData>(saveRoomType, {});

  return (
    <details className={styles.roomForm}>
      <summary className={styles.disclosureHead}>Edit</summary>
      <form action={action} className={styles.stackedForm}>
        <input type="hidden" name="propertyId" value={propertyId} />
        <input type="hidden" name="roomTypeId" value={type.id} />
        <RoomTypeFields type={type} />
        {state.error ? <p className={styles.inlineError} role="alert">{state.error}</p> : null}
        {state.done ? <p className={styles.inlineDone}>{state.done}</p> : null}
        <SubmitButton label="Save" primary />
      </form>
    </details>
  );
}

function NewRoomType({ propertyId }: { propertyId: string }) {
  const [state, action] = useActionState<PropertyState, FormData>(saveRoomType, {});

  return (
    <details className={styles.newSection}>
      <summary className={styles.disclosureHead}>Add a room type</summary>
      <form action={action} className={styles.stackedForm}>
        <input type="hidden" name="propertyId" value={propertyId} />
        <RoomTypeFields type={null} />
        {state.error ? <p className={styles.inlineError} role="alert">{state.error}</p> : null}
        {state.done ? <p className={styles.inlineDone}>{state.done}</p> : null}
        <SubmitButton label="Add the room type" primary />
      </form>
    </details>
  );
}

function RoomTypeFields({ type }: { type: RoomTypeSetupView | null }) {
  return (
    <div className={styles.formGrid}>
      <label className={styles.field}>
        <span className={styles.label}>Name</span>
        <input
          name="name"
          defaultValue={type?.name ?? ''}
          className={styles.input}
          required
          maxLength={80}
          placeholder="Lake view"
        />
        {/* What the guest reads on their own screen — describeRoom() takes the
            name from here rather than inventing a descriptor. */}
        <span className={styles.hint}>The guest sees this on their room screen.</span>
      </label>

      <label className={styles.field}>
        <span className={styles.label}>Code</span>
        <input
          name="code"
          defaultValue={type?.code ?? ''}
          className={styles.input}
          required
          maxLength={12}
          placeholder="LKV"
        />
        <span className={styles.hint}>
          Short and uppercase. A rate sheet will key on it.
        </span>
      </label>

      <label className={styles.field}>
        <span className={styles.label}>Sleeps</span>
        <input
          name="maxOccupancy"
          type="number"
          min={1}
          max={20}
          defaultValue={type?.maxOccupancy ?? 2}
          className={styles.input}
          required
        />
        {/* Recorded, not enforced: nothing in the guest product counts heads.
            It is here because rates and inventory will be priced per type
            (EXTENSION-POINTS §1) and backfilling it across live data later is
            the expensive version. */}
        <span className={styles.hint}>Recorded for rates later. Nothing counts heads today.</span>
      </label>
    </div>
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
        <span className={styles.rowEnd}>
          <RenameFloor propertyId={propertyId} floor={floor} />
          <DeleteFloor propertyId={propertyId} floor={floor} />
        </span>
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
        danger
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
      data-muted={room.archived}
      data-room={room.number}
    >
      <span className={styles.dishBody}>
        <span className={styles.dishName}>
          {room.number}
          {room.archived ? <span className={styles.offTag} data-tone="critical">out of service</span> : null}
        </span>
        <span className={styles.dishFlags}>{room.roomTypeName ?? 'No room type'}</span>
      </span>

      {mayManage ? (
        <span className={styles.rowEnd}>
          {room.archived ? null : (
            <EditRoom
              propertyId={propertyId}
              room={room}
              floors={floors}
              roomTypes={roomTypes}
            />
          )}
          <ServiceSwitch propertyId={propertyId} room={room} />
        </span>
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
  danger = false,
}: {
  label: string;
  title?: string;
  primary?: boolean;
  /** Destroys something. Outlined clay, so it is findable without shouting. */
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
