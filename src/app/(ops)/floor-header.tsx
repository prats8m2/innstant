'use client';

import Link from 'next/link';
import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import type { StaffShift } from '@/modules/housekeeping';
import type { GuestThemeKey } from '@/modules/identity/branding';
import { startShift, endShift, type BoardState } from './housekeeping/actions';
import { SignOutButton } from '@/components/sign-out-button';
import { SessionWatch } from '@/components/session-watch';
import { isNight } from './night';
import styles from './floor-header.module.css';

/**
 * Who is holding this phone, whether they are on shift, and the two screens
 * their shift covers — plus the frame both floor phones are drawn in.
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

/**
 * The floor phone's frame: console tokens, light by day and dark from 19:00
 * on the HOTEL's clock (D-100), in the property's accent.
 *
 * Seeded from the server so a night corridor does not get a white flash while
 * the page hydrates, then re-derived every minute so a phone that has been in
 * an apron pocket since lunch dims by itself. `<html>` is kept in step from an
 * effect, the way the console's frame does it, so the overscroll and anything
 * portalled to `<body>` match — and is put back on the way out.
 */
export function FloorFrame({
  initialScheme,
  timeZone,
  theme,
  className,
  children,
}: {
  initialScheme: 'light' | 'dark';
  timeZone: string;
  theme: GuestThemeKey;
  className?: string;
  children: React.ReactNode;
}) {
  const [scheme, setScheme] = useState(initialScheme);

  useEffect(() => {
    const derive = () => setScheme(isNight(Date.now(), timeZone) ? 'dark' : 'light');
    derive();
    const tick = window.setInterval(derive, 60_000);
    return () => window.clearInterval(tick);
  }, [timeZone]);

  useEffect(() => {
    const root = document.documentElement;
    const before = {
      console: root.getAttribute('data-console'),
      accent: root.getAttribute('data-accent'),
    };
    root.setAttribute('data-console', scheme);
    root.setAttribute('data-accent', theme);
    return () => {
      if (before.console) root.setAttribute('data-console', before.console);
      if (before.accent) root.setAttribute('data-accent', before.accent);
    };
  }, [scheme, theme]);

  return (
    <div className={className} data-console={scheme} data-accent={theme}>
      {children}
    </div>
  );
}

export function FloorHeader({
  propertyId,
  staffUserId,
  fullName,
  role,
  stat,
  shift,
  floors,
  tabs,
  current,
  mayClock,
  timeZone,
  renderedAt,
}: {
  propertyId: string;
  /** Who this screen was drawn for — so another tab signing out is noticed. */
  staffUserId: string;
  fullName: string;
  /** The role(s) this person holds here, as the console names them. */
  role: string;
  /** "14 handovers today" — the one number this person asks about their day. */
  stat: { value: number; label: string };
  shift: StaffShift | null;
  floors: FloorOption[];
  tabs: readonly FloorTab[];
  /** The href of the screen being looked at. */
  current: string;
  /** `shift:clock`. Without it the button is not drawn — it would only refuse. */
  mayClock: boolean;
  timeZone: string;
  /** The server's clock at render — the first tick, so hydration agrees. */
  renderedAt: number;
}) {
  const covering = shift?.zones.map((z) => z.floorName).join(' · ');

  return (
    <header className={styles.header}>
      <div className={styles.top}>
        <div className={styles.whoBody}>
          <p className={styles.name}>{fullName}</p>
          <p className={styles.role}>
            {role} · <span className="tabular">{stat.value}</span> {stat.label}
          </p>
        </div>
        <Clock renderedAt={renderedAt} timeZone={timeZone} />
      </div>

      <div className={styles.shiftRow}>
        <div className={styles.shiftBody}>
          {shift && mayClock ? (
            /* Tapping the shift line opens the floor picker. "Actually I have
               got three as well" is a normal thing to say mid-shift, and the
               control it needs cannot cost the clock-out button its single
               tap — that one is pressed with a trolley in the other hand. */
            <details className={styles.changeFloors}>
              <summary className={styles.shiftLine} data-on="true">
                {shiftLineFor(shift, covering, timeZone)}
                <ChevronDown size={14} aria-hidden="true" />
              </summary>
              <ChangeFloors propertyId={propertyId} floors={floors} shift={shift} />
            </details>
          ) : (
            <p className={styles.shiftLine} data-on={shift ? 'true' : 'false'}>
              {shiftLineFor(shift, covering, timeZone)}
            </p>
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

/** The hotel's wall clock, "9:01pm" — the board's top-right corner. */
function Clock({ renderedAt, timeZone }: { renderedAt: number; timeZone: string }) {
  const [now, setNow] = useState(renderedAt);
  useEffect(() => {
    setNow(Date.now());
    const tick = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(tick);
  }, []);
  return (
    <time className={`${styles.clock} tabular`} dateTime={new Date(now).toISOString()}>
      {wallClock(now, timeZone)}
    </time>
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

/** The HOTEL's clock, never the phone's (CLAUDE.md "Dates"). */
function clockOf(at: Date | string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone,
  }).format(new Date(at));
}

/** "9:01pm", the way the boards write the time — the hotel's, not the phone's. */
export function wallClock(at: number | Date | string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone,
  }).formatToParts(new Date(at));
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `${pick('hour')}:${pick('minute')}${pick('dayPeriod').toLowerCase()}`;
}
