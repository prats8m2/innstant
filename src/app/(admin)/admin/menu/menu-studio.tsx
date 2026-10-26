'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Eye, Layers, ListPlus, Plus, RotateCw, SlidersHorizontal, X } from 'lucide-react';
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
 * Below 1280px there is no room for both, and the preview becomes a panel
 * opened from the page head.
 */
export function MenuStudio({
  propertyId,
  menu,
  permissions,
  today,
}: {
  propertyId: string;
  menu: AdminMenu;
  permissions: MenuPermissions;
  /** Property-local day of the week, 0 = Sunday, for the preview's day list. */
  today: number;
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
            {permissions.manage && permissions.pricing ? (
              <Link href="/admin/menu/options" className={studio.headLink}>
                <SlidersHorizontal size={16} strokeWidth={1.75} aria-hidden="true" />
                Option groups
              </Link>
            ) : null}
            <button
              type="button"
              className={`${studio.headLink} ${studio.previewToggle}`}
              aria-expanded={previewOpen}
              aria-controls="menu-preview"
              onClick={() => setPreviewOpen(true)}
            >
              <Eye size={16} strokeWidth={1.75} aria-hidden="true" />
              Preview
            </button>
            {permissions.manage && permissions.pricing ? (
              <Link href="/admin/menu/new" className={`${styles.primary} ${studio.addPrimary}`}>
                <Plus size={16} strokeWidth={2} aria-hidden="true" />
                Add a dish
              </Link>
            ) : null}
          </div>
        </div>
      </header>

      <div className={studio.layout}>
        <MenuBoard propertyId={propertyId} menu={menu} permissions={permissions} />
        <PreviewPane
          menu={menu}
          today={today}
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

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

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
  today: number;
  open: boolean;
  onClose: () => void;
}) {
  // null is "now", which is the default and what a guest sees this minute.
  const [moment, setMoment] = useState<{ day: number; time: string } | null>(null);
  const [version, setVersion] = useState(0);

  // Any new menu from the server is a reason to look again.
  useEffect(() => setVersion((v) => v + 1), [menu]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const params = new URLSearchParams();
  if (moment) {
    params.set('day', String(moment.day));
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
          type="button"
          className={`${studio.iconButton} ${studio.previewClose}`}
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
            aria-pressed={moment?.time === preset.time && moment.day === today}
            onClick={() => setMoment({ day: today, time: preset.time })}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className={studio.momentPick}>
        <label className={studio.momentField}>
          <span className={styles.label}>Day</span>
          <select
            className={styles.input}
            value={moment?.day ?? today}
            onChange={(event) => setMoment({
              day: Number(event.target.value),
              time: moment?.time ?? '12:00',
            })}
          >
            {DAYS.map((name, day) => (
              <option key={name} value={day}>{day === today ? `${name} (today)` : name}</option>
            ))}
          </select>
        </label>
        <label className={studio.momentField}>
          <span className={styles.label}>Time</span>
          <input
            type="time"
            className={styles.input}
            value={moment?.time ?? ''}
            onChange={(event) => {
              if (event.target.value) setMoment({ day: moment?.day ?? today, time: event.target.value });
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
        <iframe key={src} src={src} title="The guest menu" className={studio.phoneScreen} />
      </div>

      <p className={studio.previewNote}>
        The room menu as it reads {moment ? `on ${DAYS[moment.day]} at ${moment.time}` : 'right now'},
        in the hotel’s time. Taps do nothing here.
      </p>
    </aside>
  );
}
