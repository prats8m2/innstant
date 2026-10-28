'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  BadgePercent, Eye, EyeOff, Layers, ListPlus, Plus, RotateCw, SlidersHorizontal, X,
} from 'lucide-react';
import type { AdminMenu } from '@/modules/catalog';
import { MenuBoard, type MenuPermissions } from './menu-board';
import { OutletSwitch } from './menu-forms';
import styles from '../admin.module.css';
import studio from './studio.module.css';

/**
 * The menu studio: the board on the left, the guest's screen on the right.
 *
 * The preview is the real guest menu (`/admin/menu/preview`, which renders
 * the guest screen's own component) in a phone-sized frame. It reloads when
 * the menu changes, so a drop, a price or a switch shows up in it within a
 * second, and it can be wound to any day and time, because "After 10pm" and
 * a breakfast-only dish are only visible at the hour they apply.
 *
 * It is closed until somebody asks for it, at every width. Open all the time
 * it took a third of the screen from the board, which is the thing being
 * worked on, and loaded a second page on every visit to show something most
 * visits never looked at. Opened, it docks beside the board from 1280px and
 * slides in over it below that. The frame is not mounted while closed.
 */
/**
 * A collection as the board's strip draws it. Decided on the server (the
 * schedule rules live in the catalog module, which carries the database
 * client and so cannot be imported here).
 */
export interface ScheduledCard {
  id: string;
  name: string;
  /** "Weekends · 11:00–15:30". */
  schedule: string;
  /** "showing now", "later today · from 22:00", "ended 5 Nov"… */
  label: string;
  tone: 'live' | 'waiting' | 'off';
  dishes: string[];
}

/** A loose end on the menu, said as the thing to do (step 4). */
export interface Warning {
  text: string;
  /** Where to fix it, when that is another page. */
  href?: string;
  /** A board filter that shows exactly the dishes it is about. */
  filter?: 'nophoto';
}

export function MenuStudio({
  propertyId,
  menu,
  permissions,
  now,
  scheduled,
  todaysSpecialOn,
  liveOffers,
  offerCount,
  portions,
  warnings,
}: {
  propertyId: string;
  menu: AdminMenu;
  permissions: MenuPermissions;
  /** The hotel's today, not the server's: the preview's default, and the
   *  date its presets use. */
  now: { dayOfWeek: number; date: string };
  scheduled: ScheduledCard[];
  /** Whether a "Today's special" dated today already exists. */
  todaysSpecialOn: boolean;
  /** Dish id → "20% off now · Happy hour", for dishes an offer prices now. */
  liveOffers: Record<string, string>;
  /** How many offers exist, or null without `catalog:pricing`. */
  offerCount: number | null;
  /** D-086. Limited dishes only: id → today's limit and what is left. */
  portions: Record<string, { limit: number; left: number }>;
  warnings: Warning[];
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const dishCount = menu.categories.reduce((n, c) => n + c.items.length, 0);

  return (
    <>
      <header className={styles.pageHead}>
        <div>
          <h1 className={styles.title}>{menu.outlet.name}</h1>
          <p className={styles.lede}>
            {menu.categories.length} {menu.categories.length === 1 ? 'section' : 'sections'} ·{' '}
            {dishCount} {dishCount === 1 ? 'dish' : 'dishes'} ·{' '}
            about {menu.outlet.prepTimeMinutes} minutes to the door
          </p>
        </div>

        <div className={studio.headActions}>
          {permissions.availability ? (
            <OutletSwitch
              propertyId={propertyId}
              outletId={menu.outlet.id}
              isAcceptingOrders={menu.outlet.isAcceptingOrders}
            />
          ) : null}
          <div className={studio.headLinks}>
            {permissions.manage ? (
              <Link href="/admin/menu/collections" className={studio.headLink}>
                <Layers size={16} strokeWidth={1.75} aria-hidden="true" />
                Collections
              </Link>
            ) : null}
            {offerCount !== null ? (
              <Link href="/admin/menu/offers" className={studio.headLink}>
                <BadgePercent size={16} strokeWidth={1.75} aria-hidden="true" />
                Offers{offerCount ? ` (${offerCount})` : ''}
              </Link>
            ) : null}
            {permissions.manage && permissions.pricing ? (
              <Link href="/admin/menu/options" className={studio.headLink}>
                <SlidersHorizontal size={16} strokeWidth={1.75} aria-hidden="true" />
                Option groups
              </Link>
            ) : null}
            <button
              type="button"
              className={studio.headLink}
              aria-expanded={previewOpen}
              aria-controls="menu-preview"
              data-active={previewOpen || undefined}
              onClick={() => setPreviewOpen((open) => !open)}
            >
              {previewOpen
                ? <EyeOff size={16} strokeWidth={1.75} aria-hidden="true" />
                : <Eye size={16} strokeWidth={1.75} aria-hidden="true" />}
              {previewOpen ? 'Hide preview' : 'Preview'}
            </button>
            {permissions.manage && permissions.pricing ? (
              <Link href="/admin/menu?dish=new" scroll={false} className={`${styles.primary} ${studio.addPrimary}`}>
                <Plus size={16} strokeWidth={2} aria-hidden="true" />
                Add a dish
              </Link>
            ) : null}
          </div>
        </div>
      </header>

      <div className={studio.layout} data-preview={previewOpen || undefined}>
        <MenuBoard
          propertyId={propertyId}
          menu={menu}
          permissions={permissions}
          scheduled={scheduled}
          todaysSpecialOn={todaysSpecialOn}
          liveOffers={liveOffers}
          portions={portions}
          warnings={warnings}
        />
        <PreviewPane
          menu={menu}
          today={now.date}
          open={previewOpen}
          onClose={() => setPreviewOpen(false)}
        />
      </div>

      <p className={styles.footnote}>
        <ListPlus size={14} strokeWidth={1.75} aria-hidden="true" className={studio.footIcon} />
        Prices are in {menu.outlet.currency}. Nothing here is ever deleted: a
        dish taken off the menu stays on the receipts that sold it (D-008).
      </p>
    </>
  );
}

/* ── The preview ────────────────────────────────────────────────────────── */

/** The moments a manager actually checks. Each is today, at that hour. */
const PRESETS = [
  { label: 'Breakfast', time: '08:00' },
  { label: 'Lunch', time: '13:00' },
  { label: 'Dinner', time: '20:00' },
  { label: 'Late', time: '23:00' },
];

function PreviewPane({
  menu,
  today,
  open,
  onClose,
}: {
  menu: AdminMenu;
  /** The hotel's `YYYY-MM-DD`. */
  today: string;
  open: boolean;
  onClose: () => void;
}) {
  // null is "now", which is the default and what a guest sees this minute.
  // A DATE rather than a weekday since D-084: a menu that runs 1–5 November
  // looks different on a Sunday in October than on the Sunday it starts.
  const [moment, setMoment] = useState<{ date: string; time: string } | null>(null);
  const [version, setVersion] = useState(0);

  const closeRef = useRef<HTMLButtonElement>(null);

  // Any new menu from the server is a reason to look again.
  useEffect(() => setVersion((v) => v + 1), [menu]);

  useEffect(() => {
    if (!open) return;
    // Where the keyboard goes when it opens, so Escape and Tab start here.
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const params = new URLSearchParams();
  if (moment) {
    params.set('date', moment.date);
    params.set('time', moment.time);
  }
  params.set('v', String(version));
  const src = `/admin/menu/preview?${params.toString()}`;

  return (
    <aside
      id="menu-preview"
      className={studio.preview}
      data-open={open || undefined}
      aria-label="What a guest sees"
    >
      <div className={studio.previewHead}>
        <p className={studio.previewTitle}>What a guest sees</p>
        <button
          ref={closeRef}
          type="button"
          className={studio.iconButton}
          aria-label="Close the preview"
          onClick={onClose}
        >
          <X size={18} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>

      <div className={studio.moments} role="group" aria-label="When">
        <button
          type="button"
          className={studio.chip}
          aria-pressed={moment === null}
          onClick={() => setMoment(null)}
        >
          Now
        </button>
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            className={studio.chip}
            aria-pressed={moment?.time === preset.time && moment.date === today}
            onClick={() => setMoment({ date: today, time: preset.time })}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className={studio.momentPick}>
        <label className={studio.momentField}>
          <span className={styles.label}>Date</span>
          <input
            type="date"
            className={styles.input}
            value={moment?.date ?? today}
            onChange={(event) => {
              if (event.target.value) {
                setMoment({ date: event.target.value, time: moment?.time ?? '12:00' });
              }
            }}
          />
        </label>
        <label className={studio.momentField}>
          <span className={styles.label}>Time</span>
          <input
            type="time"
            className={styles.input}
            value={moment?.time ?? ''}
            onChange={(event) => {
              if (event.target.value) setMoment({ date: moment?.date ?? today, time: event.target.value });
            }}
          />
        </label>
        <button
          type="button"
          className={studio.iconButton}
          aria-label="Reload the preview"
          title="Reload"
          onClick={() => setVersion((v) => v + 1)}
        >
          <RotateCw size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>

      <div className={studio.phone}>
        {/* Not mounted while closed: a hidden iframe still loads its page. */}
        {open ? (
          <iframe key={src} src={src} title="The guest menu" className={studio.phoneScreen} />
        ) : null}
      </div>

      <p className={studio.previewNote}>
        The room menu as it reads {moment ? `on ${readableDate(moment.date)} at ${moment.time}` : 'right now'},
        in the hotel’s time. Taps do nothing here.
      </p>
    </aside>
  );
}

/** `2026-11-05` → `Thursday 5 November`. A bare date, so UTC. */
function readableDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
  }).format(new Date(Date.UTC(y!, m! - 1, d!)));
}
