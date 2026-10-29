'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import type { StaffShift } from '@/modules/housekeeping';
import { startShift, endShift, type BoardState } from './housekeeping/actions';
import { SignOutButton } from '@/components/sign-out-button';
import { SessionWatch } from '@/components/session-watch';
import styles from './floor-header.module.css';

/**
 * Who is holding this phone, whether they are on shift, and the two screens
 * their shift covers.
 *
 * ─── Why it is shared, and why it imports housekeeping's actions ───────────
 *
 * The design draws the runner app as ONE phone screen with a Pickups/Requests
 * segmented control. We kept `/runner` and `/housekeeping` as separate routes —
 * they load different data, check different permissions and were already
 * shipping — so the segmented control is rendered as what it actually is here:
 * two links, one of them current. Same affordance, same thumb position, no
 * route merge.
 *
 * Clocking in is `startShift`/`endShift`, which live under `housekeeping/`
 * because that module owns `shifts`. A runner clocks into the same table —
 * routing asks "who is on duty covering this floor" and does not care which
 * screen they tapped — so this imports them rather than growing a second pair.
 *
 * ─── Why the tabs are filtered ─────────────────────────────────────────────
 *
 * Only what this account can actually open. A housekeeper without `order:read`
 * offered a Pickups tab gets a refusal page, and a floor app full of links that
 * refuse is how staff learn not to trust it. Same rule as the console rail.
 */

export interface FloorTab {
  href: string;
  label: string;
  /** Shown beside the label. Null when this account cannot see that number. */
  count: number | null;
}

export interface FloorOption {
  id: string;
  name: string;
}

export function FloorHeader({
  propertyId,
  staffUserId,
  fullName,
  shift,
  floors,
  tabs,
  current,
  mayClock,
  timeZone,
}: {
  propertyId: string;
  /** Who this screen was drawn for — so another tab signing out is noticed. */
  staffUserId: string;
  fullName: string;
  shift: StaffShift | null;
  floors: FloorOption[];
  tabs: readonly FloorTab[];
  /** The href of the screen being looked at. */
  current: string;
  /** `shift:clock`. Without it the button is not drawn — it would only refuse. */
  mayClock: boolean;
  timeZone: string;
}) {
  const covering = shift?.zones.map((z) => z.floorName).join(' · ');

  return (
    <header className={styles.header}>
      <div className={styles.who}>
        <span className={styles.avatar} aria-hidden="true">{initialsOf(fullName)}</span>
        <div className={styles.whoBody}>
          <p className={styles.name}>{fullName}</p>
          {shift && mayClock ? (
            /* Tapping the shift line opens the floor picker. "Actually I have
               got three as well" is a normal thing to say mid-shift, and the
               control it needs cannot cost the clock-out button its single
               tap — that one is pressed with a trolley in the other hand. */
            <details className={styles.changeFloors}>
              <summary className={styles.shiftLine}>
                {shiftLineFor(shift, covering, timeZone)}
              </summary>
              <ChangeFloors propertyId={propertyId} floors={floors} shift={shift} />
            </details>
          ) : (
            <p className={styles.shiftLine}>{shiftLineFor(shift, covering, timeZone)}</p>
          )}
        </div>
        {mayClock ? (
          <ClockControl propertyId={propertyId} floors={floors} shift={shift} />
        ) : null}
        <SignOutButton className={styles.signOut} />
      </div>
      <SessionWatch staffUserId={staffUserId} />

      {tabs.length > 1 ? (
        <nav className={styles.tabs} aria-label="Floor screens">
          {tabs.map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              className={styles.tab}
              aria-current={tab.href === current ? 'page' : undefined}
            >
              <span>{tab.label}</span>
              {tab.count !== null ? (
                <span className={`${styles.tabCount} tabular`}>{tab.count}</span>
              ) : null}
            </Link>
          ))}
        </nav>
      ) : null}
    </header>
  );
}

/**
 * Clock in, or out.
 *
 * Clocking OUT is one tap, because it happens at the end of a shift with a
 * trolley in the other hand. Clocking IN opens the floor picker, because a
 * shift with no zones on it routes nothing and is the failure this control
 * exists to prevent — so it cannot be a single tap that silently covers
 * nothing.
 */
function ClockControl({
  propertyId,
  floors,
  shift,
}: {
  propertyId: string;
  floors: FloorOption[];
  shift: StaffShift | null;
}) {
  const [outState, clockOut] = useActionState<BoardState, FormData>(endShift, {});

  if (shift) {
    return (
      <form action={clockOut} className={styles.clockForm}>
        <input type="hidden" name="propertyId" value={propertyId} />
        <ClockButton label="Clock out" />
        {outState.error ? <p className={styles.error} role="alert">{outState.error}</p> : null}
      </form>
    );
  }

  return <ClockIn propertyId={propertyId} floors={floors} />;
}

/**
 * Changing the floors mid-shift is the same call as clocking in — `clockIn()`
 * is idempotent and REPLACES the zones rather than opening a second shift, so
 * there is no separate action and no way to end up on duty twice.
 */
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
      <ClockButton label="Save floors" primary />
    </form>
  );
}

function ClockIn({ propertyId, floors }: { propertyId: string; floors: FloorOption[] }) {
  const [state, action] = useActionState<BoardState, FormData>(startShift, {});

  return (
    <details className={styles.clockIn}>
      <summary className={styles.clockInSummary}>Clock in</summary>
      <form action={action} className={styles.clockInForm}>
        <input type="hidden" name="propertyId" value={propertyId} />
        <p className={styles.clockInLead}>Which floors are you covering?</p>
        <div className={styles.floorPicker}>
          {floors.map((floor) => (
            <label key={floor.id} className={styles.floorCheck}>
              <input type="checkbox" name="floorIds" value={floor.id} />
              <span>{floor.name}</span>
            </label>
          ))}
        </div>
        {state.error ? <p className={styles.error} role="alert">{state.error}</p> : null}
        <ClockButton label="Start the shift" primary />
      </form>
    </details>
  );
}

function ClockButton({ label, primary = false }: { label: string; primary?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={primary ? styles.clockPrimary : styles.clockOut}
      disabled={pending}
    >
      {pending ? '…' : label}
    </button>
  );
}

/**
 * Nothing is routed to somebody who is off shift, so the board behind this is
 * empty for a reason rather than because it is broken. Said in a card, because
 * an empty screen with no explanation reads as a bug.
 */
export function OffShiftNotice() {
  return (
    <div className={styles.offShift}>
      <p className={styles.offShiftTitle}>You are off shift</p>
      <p className={styles.offShiftBody}>
        Nothing routes to you. Clock in to take work on your floors.
      </p>
    </div>
  );
}

function shiftLineFor(
  shift: StaffShift | null,
  covering: string | undefined,
  timeZone: string,
): string {
  if (!shift) return `Off shift${covering ? ` · ${covering}` : ''}`;
  const since = shift.clockedInAt ? ` · since ${clockOf(shift.clockedInAt, timeZone)}` : '';
  return `On shift · ${covering || 'no floors'}${since}`;
}

/** "Kishan Rathore" → "KR". One or two letters, never three. */
function initialsOf(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '·';
  const first = parts[0]![0]!;
  const last = parts.length > 1 ? parts[parts.length - 1]![0]! : '';
  return (first + last).toUpperCase();
}

/** The HOTEL's clock, never the phone's (CLAUDE.md "Dates"). */
function clockOf(at: Date | string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone,
  }).format(new Date(at));
}
