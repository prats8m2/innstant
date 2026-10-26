'use client';

import { useEffect, useId, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import {
  DndContext, KeyboardSensor, PointerSensor, closestCenter, closestCorners, pointerWithin,
  useDroppable, useSensor, useSensors,
  type Announcements, type CollisionDetection, type DragEndEvent, type DragOverEvent,
  type DragStartEvent, type KeyboardCoordinateGetter, type UniqueIdentifier,
} from '@dnd-kit/core';
import {
  SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { CalendarClock, Flame, GripVertical, ImageOff, Pencil, Plus, Search, Sparkles } from 'lucide-react';
import type { AdminMenu, AdminMenuCategory, AdminMenuItem } from '@/modules/catalog';
import { formatMoney, money } from '@/lib/money';
import {
  arrangeMenuFromBoard, setAvailabilityFromBoard, setPriceFromBoard,
  startTodaysSpecialFromBoard, addDishToCollectionFromBoard,
} from './actions';
import type { ScheduledCard } from './menu-studio';
import { DishImage } from '@/app/(guest)/dish-image';
import { ArchiveDish, ArchiveSection, NewSection, RenameSection } from './menu-forms';
import styles from '../admin.module.css';
import studio from './studio.module.css';

export interface MenuPermissions {
  manage: boolean;
  pricing: boolean;
  availability: boolean;
}

/**
 * The menu studio's board.
 *
 * Sections and dishes as a manager arranges them: drag a section by its
 * handle to move it, drag a dish within its section or into another one.
 * Every drop posts the whole arrangement (`arrangeMenu()` says why), and a
 * refusal puts the board back exactly as it was before the drag.
 *
 * ─── Only the handle drags ─────────────────────────────────────────────────
 *
 * A whole-row drag on a phone or tablet steals the scroll: every attempt to
 * scroll the menu picks up a dish. The handle is a 44px target, keyboard
 * reachable (space to lift, arrows to move, space to drop, escape to cancel),
 * and announced by name rather than by id.
 *
 * ─── Not while the list is narrowed ────────────────────────────────────────
 *
 * With a search or a filter on, the board shows a subset, and "drop this
 * between the two dishes I can see" does not say where it goes among the
 * ones it is hiding. The handles go away until the filter is cleared, and
 * the board says so.
 */
export function MenuBoard({
  propertyId,
  menu,
  permissions,
  scheduled,
  todaysSpecialOn,
}: {
  propertyId: string;
  menu: AdminMenu;
  permissions: MenuPermissions;
  /** The menus on a schedule (D-084), already measured against now. */
  scheduled: ScheduledCard[];
  todaysSpecialOn: boolean;
}) {
  const outletId = menu.outlet.id;
  const dndId = useId();

  const [order, setOrder] = useState(() => arrangementOf(menu));
  const [items, setItems] = useState(() => itemsOf(menu));
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [message, setMessage] = useState<{ tone: 'done' | 'error'; text: string } | null>(null);
  const [, startSaving] = useTransition();

  // The server's answer wins whenever it arrives — after a save, after a
  // rename posted by one of the small forms, after another screen's change
  // reaches this one through the refresh. Not mid-drag, though.
  const dragging = useRef(false);
  const before = useRef(order);
  useEffect(() => {
    if (dragging.current) return;
    setOrder(arrangementOf(menu));
    setItems(itemsOf(menu));
  }, [menu]);

  const categories = useMemo(
    () => new Map(menu.categories.map((c) => [c.id, c])),
    [menu.categories],
  );

  const narrowed = query.trim() !== '' || filter !== 'all';
  const canArrange = permissions.manage && !narrowed;
  const matches = (item: AdminMenuItem) => matchesFilter(item, filter) && matchesQuery(item, query);

  const all = [...items.values()];
  const counts: Record<Filter, number> = {
    all: all.length,
    on: all.filter((i) => matchesFilter(i, 'on')).length,
    off: all.filter((i) => matchesFilter(i, 'off')).length,
    veg: all.filter((i) => matchesFilter(i, 'veg')).length,
    nonveg: all.filter((i) => matchesFilter(i, 'nonveg')).length,
    nophoto: all.filter((i) => matchesFilter(i, 'nophoto')).length,
  };

  /* ── Drag and drop ─────────────────────────────────────────────────────── */

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: keyboardCoordinates }),
  );

  const containerOf = (id: UniqueIdentifier): string | null => {
    const key = String(id);
    if (key.startsWith('l:') || key.startsWith('s:')) return key.slice(2);
    const itemId = key.slice(2);
    return order.find((s) => s.itemIds.includes(itemId))?.categoryId ?? null;
  };

  const labelOf = (id: UniqueIdentifier | undefined): string => {
    if (id === undefined) return 'nothing';
    const key = String(id);
    const rest = key.slice(2);
    if (key.startsWith('s:')) return `section ${categories.get(rest)?.name ?? ''}`;
    if (key.startsWith('l:')) return `the end of ${categories.get(rest)?.name ?? 'a section'}`;
    if (key.startsWith('c:')) return `the ${scheduled.find((c) => c.id === rest)?.name ?? 'scheduled'} menu`;
    return items.get(rest)?.name ?? 'a dish';
  };

  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${labelOf(active.id)}.`,
    onDragOver: ({ active, over }) =>
      over ? `${labelOf(active.id)} is over ${labelOf(over.id)}.` : `${labelOf(active.id)} is not over a place it can go.`,
    onDragEnd: ({ active, over }) =>
      over ? `${labelOf(active.id)} dropped at ${labelOf(over.id)}.` : `${labelOf(active.id)} dropped.`,
    onDragCancel: ({ active }) => `Moving ${labelOf(active.id)} was cancelled. It is back where it was.`,
  };

  const onDragStart = (_event: DragStartEvent) => {
    dragging.current = true;
    before.current = order;
    setMessage(null);
  };

  // A dish crossing into another section moves there as it is dragged, so
  // the section it is over opens a gap for it.
  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over || !String(active.id).startsWith('d:')) return;
    // Over a scheduled menu's card, the dish is being ADDED there, not moved:
    // it stays in its section, so no gap opens anywhere.
    if (String(over.id).startsWith('c:')) return;
    const from = containerOf(active.id);
    const to = containerOf(over.id);
    if (!from || !to || from === to) return;

    const dishId = String(active.id).slice(2);
    setOrder((current) => current.map((section) => {
      if (section.categoryId === from) {
        return { ...section, itemIds: section.itemIds.filter((id) => id !== dishId) };
      }
      if (section.categoryId === to) {
        const overKey = String(over.id);
        const at = overKey.startsWith('d:')
          ? section.itemIds.indexOf(overKey.slice(2))
          : section.itemIds.length;
        const next = [...section.itemIds];
        next.splice(at < 0 ? next.length : at, 0, dishId);
        return { ...section, itemIds: next };
      }
      return section;
    }));
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    dragging.current = false;

    // Dropped on a scheduled menu: the dish joins it and goes back to exactly
    // where it was on the board, whatever sections it passed over on the way.
    if (over && String(over.id).startsWith('c:') && String(active.id).startsWith('d:')) {
      setOrder(before.current);
      const collectionId = String(over.id).slice(2);
      const menuItemId = String(active.id).slice(2);
      startSaving(async () => {
        const result = await addDishToCollectionFromBoard({
          propertyId, outletId, collectionId, menuItemId,
        });
        setMessage(result.error
          ? { tone: 'error', text: result.error }
          : { tone: 'done', text: result.done ?? 'Added.' });
      });
      return;
    }

    let next = order;

    if (over && active.id !== over.id) {
      const key = String(active.id);
      if (key.startsWith('s:')) {
        const from = order.findIndex((s) => `s:${s.categoryId}` === key);
        const to = order.findIndex((s) => `s:${s.categoryId}` === String(over.id));
        if (from >= 0 && to >= 0) next = arrayMove(order, from, to);
      } else {
        const container = containerOf(active.id);
        const overKey = String(over.id);
        if (container && overKey.startsWith('d:') && containerOf(over.id) === container) {
          next = order.map((section) => {
            if (section.categoryId !== container) return section;
            const from = section.itemIds.indexOf(key.slice(2));
            const to = section.itemIds.indexOf(overKey.slice(2));
            return { ...section, itemIds: arrayMove(section.itemIds, from, to) };
          });
        }
      }
    }

    setOrder(next);
    if (sameArrangement(next, before.current)) return;

    const previous = before.current;
    startSaving(async () => {
      const result = await arrangeMenuFromBoard({ propertyId, outletId, sections: next });
      if (result.error) {
        setOrder(previous);
        setMessage({ tone: 'error', text: result.error });
      } else {
        setMessage({ tone: 'done', text: result.done ?? 'Saved.' });
      }
    });
  };

  const onDragCancel = () => {
    dragging.current = false;
    setOrder(before.current);
  };

  /* ── Price and availability, in place ──────────────────────────────────── */

  const patchItem = (id: string, patch: Partial<AdminMenuItem>) => {
    setItems((current) => {
      const next = new Map(current);
      const item = next.get(id);
      if (item) next.set(id, { ...item, ...patch });
      return next;
    });
  };

  const setAvailable = (item: AdminMenuItem, isAvailable: boolean) => {
    patchItem(item.id, { isAvailable });
    startSaving(async () => {
      const result = await setAvailabilityFromBoard({
        propertyId, outletId, itemId: item.id, isAvailable,
      });
      if (result.error) {
        patchItem(item.id, { isAvailable: !isAvailable });
        setMessage({ tone: 'error', text: result.error });
      } else {
        setMessage({ tone: 'done', text: result.done ?? 'Saved.' });
      }
    });
  };

  const setPrice = async (item: AdminMenuItem, typed: string): Promise<string | null> => {
    const result = await setPriceFromBoard({ propertyId, outletId, itemId: item.id, price: typed });
    if (result.error) return result.error;
    setMessage({ tone: 'done', text: result.done ?? 'Saved.' });
    return null;
  };

  const rowProps = { propertyId, outletId, permissions, onAvailable: setAvailable, onPrice: setPrice };

  const startSpecial = () => {
    startSaving(async () => {
      const result = await startTodaysSpecialFromBoard({ propertyId, outletId });
      setMessage(result.error
        ? { tone: 'error', text: result.error }
        : { tone: 'done', text: result.done ?? 'Ready.' });
    });
  };

  return (
    <div className={studio.board}>
      <div className={studio.toolbar}>
        <label className={studio.search}>
          <Search size={16} strokeWidth={1.75} aria-hidden="true" className={studio.searchIcon} />
          <input
            type="search"
            className={styles.input}
            placeholder="Find a dish"
            aria-label="Find a dish"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>

        <div className={studio.filters} role="group" aria-label="Show">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={studio.chip}
              aria-pressed={filter === f.key}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
              <span className={`${studio.chipCount} tabular`}>{counts[f.key]}</span>
            </button>
          ))}
        </div>

        <p
          className={studio.status}
          data-tone={message?.tone}
          role={message?.tone === 'error' ? 'alert' : 'status'}
        >
          {message?.text ?? (narrowed && permissions.manage
            ? 'Clear the search and filter to rearrange.'
            : null)}
        </p>
      </div>

      <DndContext
        id={dndId}
        sensors={sensors}
        collisionDetection={collision}
        accessibility={{
          announcements,
          screenReaderInstructions: {
            draggable:
              'To move it, press space or enter, use the arrow keys, then press space or enter '
              + 'to drop it. Escape puts it back.',
          },
        }}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        {permissions.manage ? (
          <ScheduledStrip
            scheduled={scheduled}
            todaysSpecialOn={todaysSpecialOn}
            canDrop={canArrange}
            onStartSpecial={startSpecial}
          />
        ) : null}

        <SortableContext
          items={order.map((s) => `s:${s.categoryId}`)}
          strategy={verticalListSortingStrategy}
        >
          {order.map((section) => {
            const category = categories.get(section.categoryId);
            if (!category) return null;
            const shown = section.itemIds
              .map((id) => items.get(id))
              .filter((item): item is AdminMenuItem => !!item && matches(item));
            // A narrowed board hides the sections with nothing to show.
            if (narrowed && shown.length === 0) return null;
            return (
              <SortableSection
                key={section.categoryId}
                category={category}
                itemIds={section.itemIds}
                shown={shown}
                canArrange={canArrange}
                {...rowProps}
              />
            );
          })}
        </SortableContext>
      </DndContext>

      {/* Dishes whose section was archived under them. Invisible to a guest
          and still orderable by URL, so they stay in front of the manager
          until somebody gives them a section or removes them. */}
      {menu.orphanedItems.length ? (
        <section className={studio.section}>
          <header className={studio.sectionHead}>
            <div className={studio.sectionText}>
              <h2 className={studio.sectionTitle}>Without a section</h2>
              <p className={studio.sectionBlurb}>
                Their section was archived. A guest cannot browse to these, so
                give them a section or take them off the menu.
              </p>
            </div>
          </header>
          <ul className={studio.dishes}>
            {menu.orphanedItems.map((item) => (
              <DishRow key={item.id} item={items.get(item.id) ?? item} handle={null} {...rowProps} />
            ))}
          </ul>
        </section>
      ) : null}

      {permissions.manage ? <NewSection propertyId={propertyId} outletId={outletId} /> : null}
    </div>
  );
}

/* ── Menus on a schedule (D-084) ──────────────────────────────────────────── */

/**
 * The collections that lead the guest's menu, in that order, each saying
 * when it runs and whether it is showing right now. A dish dragged onto a
 * card joins it (and stays in its own section: a collection is a view over
 * dishes, not a place they live). Editing the schedule itself is on the
 * collections page, one click away.
 */
function ScheduledStrip({
  scheduled,
  todaysSpecialOn,
  canDrop,
  onStartSpecial,
}: {
  scheduled: ScheduledCard[];
  todaysSpecialOn: boolean;
  canDrop: boolean;
  onStartSpecial: () => void;
}) {
  return (
    // A region of articles, not a <section> of <li>s: the board's sections
    // and rows are found as `section` and `li` (by people's tools and by the
    // e2e suite), and a card listing "Mohan maas" must not read as his row.
    <div role="region" className={studio.strip} aria-labelledby="scheduled-title">
      <header className={studio.stripHead}>
        <div>
          <h2 id="scheduled-title" className={studio.stripTitle}>
            <CalendarClock size={18} strokeWidth={1.75} aria-hidden="true" />
            Menus on a schedule
          </h2>
          <p className={studio.stripBlurb}>
            They lead the guest&rsquo;s menu at the times you set.
            {canDrop ? ' Drag a dish onto one to add it.' : null}
          </p>
        </div>
        <div className={studio.stripActions}>
          {todaysSpecialOn ? null : (
            <button type="button" className={`${styles.primary} ${studio.addPrimary}`} onClick={onStartSpecial}>
              <Sparkles size={16} strokeWidth={1.75} aria-hidden="true" />
              Today&rsquo;s special
            </button>
          )}
          <Link href="/admin/menu/collections" className={studio.headLink}>
            <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
            New schedule
          </Link>
        </div>
      </header>

      {scheduled.length ? (
        <div className={studio.cards}>
          {scheduled.map((card) => <ScheduledCardView key={card.id} card={card} canDrop={canDrop} />)}
        </div>
      ) : (
        <p className={studio.stripEmpty}>
          None yet. Start today&rsquo;s special, or a breakfast or weekend menu.
        </p>
      )}
    </div>
  );
}

function ScheduledCardView({ card, canDrop }: { card: ScheduledCard; canDrop: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: `c:${card.id}`, disabled: !canDrop });
  const shown = card.dishes.slice(0, 3);
  return (
    <article
      ref={setNodeRef}
      className={studio.card}
      data-tone={card.tone}
      data-over={isOver || undefined}
      aria-label={`${card.name}: ${card.label}`}
    >
      <div className={studio.cardHead}>
        <h3 className={studio.cardName}>{card.name}</h3>
        <Link
          href={`/admin/menu/collections#collection-${card.id}`}
          className={studio.iconButton}
          aria-label={`Edit ${card.name}`}
          title="Edit its schedule and dishes"
        >
          <Pencil size={15} strokeWidth={1.75} aria-hidden="true" />
        </Link>
      </div>
      <p className={studio.cardSchedule}>{card.schedule}</p>
      <p className={studio.cardState}>
        <span className={studio.cardDot} aria-hidden="true" />
        {card.label}
      </p>
      <p className={studio.cardDishes}>
        {card.dishes.length
          ? `${shown.join(', ')}${card.dishes.length > shown.length ? ` +${card.dishes.length - shown.length}` : ''}`
          : 'No dishes yet. Drop one here.'}
      </p>
    </article>
  );
}

/* ── A section ──────────────────────────────────────────────────────────── */

interface RowProps {
  propertyId: string;
  outletId: string;
  permissions: MenuPermissions;
  onAvailable: (item: AdminMenuItem, isAvailable: boolean) => void;
  onPrice: (item: AdminMenuItem, typed: string) => Promise<string | null>;
}

function SortableSection({
  category,
  itemIds,
  shown,
  canArrange,
  ...row
}: RowProps & {
  category: AdminMenuCategory;
  itemIds: string[];
  shown: AdminMenuItem[];
  canArrange: boolean;
}) {
  const {
    attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging,
  } = useSortable({ id: `s:${category.id}`, disabled: !canArrange });
  // The list is its own drop target, so a dish can go into an empty section
  // or below the last dish of a full one.
  const { setNodeRef: setListRef } = useDroppable({ id: `l:${category.id}`, disabled: !canArrange });

  return (
    <section
      ref={setNodeRef}
      className={studio.section}
      data-dragging={isDragging || undefined}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      <header className={studio.sectionHead}>
        {canArrange ? (
          <button
            ref={setActivatorNodeRef}
            type="button"
            className={studio.handle}
            aria-label={`Move section ${category.name}`}
            {...attributes}
            {...listeners}
          >
            <GripVertical size={18} strokeWidth={1.75} aria-hidden="true" />
          </button>
        ) : null}

        <div className={studio.sectionText}>
          <h2 className={studio.sectionTitle}>
            {category.name}
            <span className={`${studio.sectionCount} tabular`}>{itemIds.length}</span>
          </h2>
          {category.description ? (
            <p className={studio.sectionBlurb}>{category.description}</p>
          ) : null}
        </div>

        {row.permissions.manage ? (
          <span className={studio.sectionActions}>
            <RenameSection
              propertyId={row.propertyId}
              outletId={row.outletId}
              categoryId={category.id}
              name={category.name}
              description={category.description}
            />
            <ArchiveSection
              propertyId={row.propertyId}
              outletId={row.outletId}
              categoryId={category.id}
              itemCount={itemIds.length}
            />
          </span>
        ) : null}
      </header>

      <SortableContext items={shown.map((i) => `d:${i.id}`)} strategy={verticalListSortingStrategy}>
        <ul ref={setListRef} className={studio.dishes} data-empty={shown.length === 0 || undefined}>
          {shown.map((item) => (
            <SortableDish key={item.id} item={item} canArrange={canArrange} {...row} />
          ))}
          {shown.length === 0 ? (
            <li className={studio.emptyDrop}>
              {canArrange ? 'Nothing here yet. Drag a dish in, or add one.' : 'Nothing in this section yet.'}
            </li>
          ) : null}
        </ul>
      </SortableContext>

      {/* The dish form needs both, so the way into it does too. */}
      {row.permissions.manage && row.permissions.pricing ? (
        <Link href={`/admin/menu/new?category=${category.id}`} className={studio.addDish}>
          <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
          Add a dish to {category.name}
        </Link>
      ) : null}
    </section>
  );
}

/* ── A dish ─────────────────────────────────────────────────────────────── */

function SortableDish({ item, canArrange, ...row }: RowProps & { item: AdminMenuItem; canArrange: boolean }) {
  const {
    attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging,
  } = useSortable({ id: `d:${item.id}`, disabled: !canArrange });

  return (
    <DishRow
      item={item}
      rowRef={setNodeRef}
      dragging={isDragging}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      handle={canArrange ? (
        <button
          ref={setActivatorNodeRef}
          type="button"
          className={studio.handle}
          aria-label={`Move ${item.name}`}
          {...attributes}
          {...listeners}
        >
          <GripVertical size={18} strokeWidth={1.75} aria-hidden="true" />
        </button>
      ) : null}
      {...row}
    />
  );
}

function DishRow({
  item,
  handle,
  rowRef,
  dragging = false,
  style,
  propertyId,
  outletId,
  permissions,
  onAvailable,
  onPrice,
}: RowProps & {
  item: AdminMenuItem;
  handle: React.ReactNode;
  rowRef?: (node: HTMLElement | null) => void;
  dragging?: boolean;
  style?: React.CSSProperties;
}) {
  const diet = dietOf(item.dietaryFlags);
  const others = item.dietaryFlags
    .filter((f) => !DIET_FLAGS.has(f))
    .map((f) => f.replace(/_/g, ' ').toLowerCase());

  return (
    <li
      ref={rowRef}
      className={studio.dish}
      data-muted={!item.isAvailable || undefined}
      data-dragging={dragging || undefined}
      style={style}
    >
      {handle}

      {/* The guest screens' own photo component: the mark underneath shows
          when there is no photo AND when the URL is dead, which is the case
          a manager most needs to see. */}
      <span className={studio.thumb}>
        <ImageOff size={18} strokeWidth={1.5} aria-label={item.imageUrl ? undefined : 'No photo'} aria-hidden={item.imageUrl ? true : undefined} />
        <DishImage src={item.imageUrl} />
      </span>

      <span className={studio.dishBody}>
        <span className={studio.dishName}>
          {diet ? <span className={studio.dietMark} data-diet={diet} title={DIET_LABEL[diet]} aria-label={DIET_LABEL[diet]} /> : null}
          {permissions.manage && permissions.pricing ? (
            <Link href={`/admin/menu/${item.id}`} className={studio.dishLink}>{item.name}</Link>
          ) : (
            item.name
          )}
          {item.isAvailable ? null : <span className={styles.offTag}>off tonight</span>}
        </span>
        {item.description ? <span className={studio.dishBlurb}>{item.description}</span> : null}
        {others.length || item.spiceLevel ? (
          <span className={studio.dishMeta}>
            {item.spiceLevel ? (
              <span className={studio.spice} title={`Spice ${item.spiceLevel} of 5`}>
                <Flame size={12} strokeWidth={2} aria-hidden="true" />
                <span className="tabular">{item.spiceLevel}</span>
              </span>
            ) : null}
            {others.join(' · ')}
          </span>
        ) : null}
      </span>

      <PriceCell item={item} editable={permissions.pricing} onPrice={onPrice} />

      <span className={studio.dishActions}>
        {permissions.availability ? (
          <button
            type="button"
            role="switch"
            aria-checked={item.isAvailable}
            aria-label={`${item.name} on the menu tonight`}
            title={item.isAvailable ? 'On the menu. Switch off for tonight.' : 'Off tonight. Switch back on.'}
            className={studio.switch}
            onClick={() => onAvailable(item, !item.isAvailable)}
          >
            <span className={studio.switchTrack} aria-hidden="true"><span className={studio.switchKnob} /></span>
            <span className={studio.switchText} aria-hidden="true">{item.isAvailable ? 'On' : 'Off'}</span>
          </button>
        ) : null}
        {permissions.manage ? (
          <ArchiveDish propertyId={propertyId} outletId={outletId} itemId={item.id} name={item.name} />
        ) : null}
      </span>
    </li>
  );
}

/**
 * The price, and a click turns it into a field.
 *
 * Enter or leaving the field saves; Escape puts the old price back. The new
 * price shows the moment it is typed, and goes back if the server refuses
 * it, with the reason underneath.
 */
function PriceCell({
  item,
  editable,
  onPrice,
}: {
  item: AdminMenuItem;
  editable: boolean;
  onPrice: (item: AdminMenuItem, typed: string) => Promise<string | null>;
}) {
  const shown = formatMoney(money(item.priceMinor, item.currency));
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [optimistic, setOptimistic] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const cancelled = useRef(false);

  // A fresh price from the server replaces whatever was typed.
  useEffect(() => setOptimistic(null), [item.priceMinor]);

  if (!editable) return <span className={`${studio.price} tabular`}>{shown}</span>;

  const open = () => {
    cancelled.current = false;
    setError(null);
    setDraft(rupeesOf(item.priceMinor));
    setEditing(true);
  };

  const commit = () => {
    setEditing(false);
    if (cancelled.current) return;
    const typed = draft.trim();
    if (!typed || typed === rupeesOf(item.priceMinor)) return;
    setOptimistic(`₹${typed}`);
    start(async () => {
      const refusal = await onPrice(item, typed);
      if (refusal) {
        setOptimistic(null);
        setError(refusal);
      }
    });
  };

  return (
    <span className={studio.priceCell}>
      {editing ? (
        <input
          className={`${studio.priceInput} tabular`}
          inputMode="decimal"
          aria-label={`Price of ${item.name}, in rupees`}
          value={draft}
          autoFocus
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
            if (event.key === 'Escape') {
              cancelled.current = true;
              event.currentTarget.blur();
            }
          }}
        />
      ) : (
        <button
          type="button"
          className={`${studio.price} ${studio.priceButton} tabular`}
          aria-label={`${item.name} costs ${shown}. Change the price`}
          title="Click to change the price"
          data-pending={pending || undefined}
          onClick={open}
        >
          {optimistic ?? shown}
        </button>
      )}
      {error ? <span className={studio.formError} role="alert">{error}</span> : null}
    </span>
  );
}

/* ── Pure helpers ───────────────────────────────────────────────────────── */

type Filter = 'all' | 'on' | 'off' | 'veg' | 'nonveg' | 'nophoto';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'on', label: 'On' },
  { key: 'off', label: 'Off tonight' },
  { key: 'veg', label: 'Veg' },
  { key: 'nonveg', label: 'Non-veg' },
  { key: 'nophoto', label: 'No photo' },
];

const DIET_FLAGS = new Set(['VEGETARIAN', 'NON_VEGETARIAN', 'VEGAN']);
const DIET_LABEL = { veg: 'Vegetarian', vegan: 'Vegan', nonveg: 'Non-vegetarian' } as const;

/** The mark an Indian menu carries: green for veg, brown for non-veg. */
function dietOf(flags: readonly string[]): keyof typeof DIET_LABEL | null {
  if (flags.includes('NON_VEGETARIAN')) return 'nonveg';
  if (flags.includes('VEGAN')) return 'vegan';
  if (flags.includes('VEGETARIAN')) return 'veg';
  return null;
}

function matchesFilter(item: AdminMenuItem, filter: Filter): boolean {
  switch (filter) {
    case 'all': return true;
    case 'on': return item.isAvailable;
    case 'off': return !item.isAvailable;
    case 'veg': return dietOf(item.dietaryFlags) === 'veg' || dietOf(item.dietaryFlags) === 'vegan';
    case 'nonveg': return dietOf(item.dietaryFlags) === 'nonveg';
    case 'nophoto': return !item.imageUrl;
  }
}

function matchesQuery(item: AdminMenuItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return item.name.toLowerCase().includes(q) || (item.description ?? '').toLowerCase().includes(q);
}

function arrangementOf(menu: AdminMenu) {
  return menu.categories.map((c) => ({ categoryId: c.id, itemIds: c.items.map((i) => i.id) }));
}

function itemsOf(menu: AdminMenu): Map<string, AdminMenuItem> {
  return new Map(
    [...menu.categories.flatMap((c) => c.items), ...menu.orphanedItems].map((i) => [i.id, i]),
  );
}

function sameArrangement(
  a: readonly { categoryId: string; itemIds: readonly string[] }[],
  b: readonly { categoryId: string; itemIds: readonly string[] }[],
): boolean {
  return a.length === b.length && a.every((s, i) =>
    s.categoryId === b[i]!.categoryId
    && s.itemIds.length === b[i]!.itemIds.length
    && s.itemIds.every((id, j) => id === b[i]!.itemIds[j]));
}

/** 115000 → "1150", 115050 → "1150.50": what `parseMoneyInput` reads back. */
function rupeesOf(minor: number): string {
  return minor % 100 === 0 ? String(minor / 100) : (minor / 100).toFixed(2);
}

/**
 * Sections collide only with sections; a dish with dishes and with the lists
 * (so it can land in an empty section). A pointer inside a dish beats the
 * list around it. The keyboard has no pointer, and falls back to corners.
 */
const collision: CollisionDetection = (args) => {
  const isSection = String(args.active.id).startsWith('s:');
  const droppableContainers = args.droppableContainers.filter((c) =>
    String(c.id).startsWith('s:') === isSection);
  const scoped = { ...args, droppableContainers };

  if (isSection) return closestCenter(scoped);

  const within = pointerWithin(scoped);
  if (within.length) {
    // A scheduled menu's card first: it is a small target, and the pointer
    // being on it is the whole intent.
    const card = within.find((c) => String(c.id).startsWith('c:'));
    if (card) return [card];
    const dish = within.find((c) => String(c.id).startsWith('d:'));
    return dish ? [dish] : within;
  }
  return closestCorners(scoped);
};

/**
 * The arrow keys, scoped the same way.
 *
 * `sortableKeyboardCoordinates` steps to the nearest droppable in the arrow's
 * direction, and without a scope that is usually a dish row inside the
 * section above. Six presses moved a section three places. Each press now
 * steps to the next thing of the same kind: a section moves a section at a
 * time, a dish a dish at a time (or into the next section's list).
 */
const keyboardCoordinates: KeyboardCoordinateGetter = (event, args) => {
  const isSection = String(args.active).startsWith('s:');
  const all = args.context.droppableContainers;
  const scoped = {
    getEnabled: () => all.getEnabled().filter((c) => String(c.id).startsWith('s:') === isSection),
    get: (id: UniqueIdentifier) => all.get(id),
  } as unknown as typeof all;
  return sortableKeyboardCoordinates(event, {
    ...args,
    context: { ...args.context, droppableContainers: scoped },
  });
};
