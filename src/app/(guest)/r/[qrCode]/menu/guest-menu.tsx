'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, Search, X } from 'lucide-react';
import type { MenuSection } from '@/modules/catalog';
/*
 * The module's own search rule, imported by path rather than through the
 * catalog index: the index re-exports the menu reads, which import `pg`, and
 * a client component that touched it would ship a database driver to a phone.
 * `menu-search.ts` is pure and imports only types. ONE rule for what matches
 * (its header explains why that matters); this screen does not invent a
 * second one.
 */
import { searchMenu } from '@/modules/catalog/menu-search';
import { CategoryRail } from './category-rail';
import { DishCard } from './dish-card';
import styles from './menu.module.css';

/**
 * The menu screen, for a room and for a property link alike (D-079).
 *
 * A client component for one feature: search. Opening the search swaps the
 * title and the rail for a field, and typing narrows the menu that is ALREADY
 * on the page — no request, which on hotel wifi is the difference between a
 * search and a spinner. Everything here still server-renders, so the menu
 * reads with JavaScript off; only the search needs it.
 *
 * The two routes hand this everything they have worked out on the server —
 * the kitchen line in the property's timezone, the steppers bound to their
 * own actions — so nothing here reads a session or a clock.
 */
export interface GuestMenuProps {
  /** `/r/{qrCode}` or `/p/{code}`. A dish lives at `{base}/menu/{id}`. */
  base: string;
  /** Null on a property link: there is nothing behind its menu. */
  back: { href: string; label: string } | null;
  /** The quiet line in the bar — "Room 214", "Kesari Kitchen · Table 4". */
  context: React.ReactNode;
  title: string;
  status: {
    /** "Kitchen open until 1am", from `describeOpenState`, property-local. */
    line: string;
    open: boolean;
    /** "30–40", or null when the kitchen is not taking orders. */
    eta: string | null;
  };
  sections: MenuSection[];
  /** One stepper per dish that can be added in one tap, keyed by dish id. */
  steppers: Record<string, React.ReactNode>;
  cart: { count: number; total: string; href: string } | null;
  /** Today's hours, as a range, under the last section. */
  footnote: string | null;
  /** "tonight's menu" or "today's menu", for the empty search. */
  menuWord: string;
}

export function GuestMenu({
  base, back, context, title, status, sections, steppers, cart, footnote, menuWord,
}: GuestMenuProps) {
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const opened = useRef(false);
  const fieldId = useId();

  const trimmed = query.trim();
  const hits = useMemo(
    () => (searching && trimmed ? searchMenu(sections, { query: trimmed }) : null),
    [searching, trimmed, sections],
  );

  // Focus follows the field: into it when it opens, back to the button that
  // opened it when it closes — never to the top of the document.
  useEffect(() => {
    if (searching) {
      inputRef.current?.focus();
      opened.current = true;
    } else if (opened.current) {
      toggleRef.current?.focus();
    }
  }, [searching]);

  const close = () => {
    setQuery('');
    setSearching(false);
  };

  const dishHref = (id: string) => `${base}/menu/${id}`;

  return (
    <main className={styles.shell} data-cart={cart ? true : undefined}>
      <header className={styles.head}>
        {back ? (
          <Link href={back.href} className={styles.iconButton} aria-label={back.label}>
            <ChevronLeft size={22} strokeWidth={1.5} aria-hidden="true" />
          </Link>
        ) : (
          <span className={styles.iconSlot} aria-hidden="true" />
        )}
        <span className={styles.context}>{context}</span>
        <button
          ref={toggleRef}
          type="button"
          className={styles.iconButton}
          aria-label={searching ? 'Close the search' : 'Search the menu'}
          aria-expanded={searching}
          aria-controls={searching ? fieldId : undefined}
          onClick={() => (searching ? close() : setSearching(true))}
        >
          {searching
            ? <X size={20} strokeWidth={1.5} aria-hidden="true" />
            : <Search size={20} strokeWidth={1.5} aria-hidden="true" />}
        </button>
      </header>

      {searching ? (
        <div className={styles.searchBar} role="search">
          <label htmlFor={fieldId} className={styles.srOnly}>Search the menu</label>
          <span className={styles.searchIcon} aria-hidden="true">
            <Search size={20} strokeWidth={1.5} />
          </span>
          <input
            ref={inputRef}
            id={fieldId}
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            spellCheck={false}
            className={styles.searchInput}
            placeholder="A dish, or what is in it"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                close();
              }
            }}
          />
          {query ? (
            <button
              type="button"
              className={styles.searchClear}
              aria-label="Clear the search"
              onClick={() => {
                setQuery('');
                inputRef.current?.focus();
              }}
            >
              <X size={20} strokeWidth={1.5} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      ) : (
        <>
          <div className={styles.intro}>
            <h1 className={styles.title}>{title}</h1>
            <p className={styles.status}>
              <span className={styles.statusDot} data-open={status.open} aria-hidden="true" />
              {status.line}
              {status.eta ? (
                <>
                  {' · about '}
                  <span className="tabular">{status.eta}</span>
                  {' min'}
                </>
              ) : null}
            </p>
          </div>

          <CategoryRail sections={sections.map((s) => ({ id: s.id, label: s.label }))} />
        </>
      )}

      {/*
        One live region for the whole search, present for as long as the field
        is: a count that changes as you type, or the reason there is nothing.
      */}
      {searching ? (
        <p
          className={hits && hits.length === 0 ? styles.srOnly : styles.searchCount}
          role="status"
        >
          {hits
            ? hits.length
              ? `${hits.length} ${hits.length === 1 ? 'dish' : 'dishes'}`
              : `Nothing on ${menuWord} matches “${trimmed}”.`
            : ''}
        </p>
      ) : null}

      {hits ? (
        hits.length ? (
          <ul className={styles.rows} data-results>
            {hits.map((hit) => (
              <DishCard
                key={hit.dish.id}
                dish={hit.dish}
                href={dishHref(hit.dish.id)}
                variant="row"
                eyebrow={hit.section}
                control={steppers[hit.dish.id]}
              />
            ))}
          </ul>
        ) : (
          <div className={styles.empty}>
            <span className={styles.emptyArch} aria-hidden="true" />
            <p className={styles.emptyTitle}>
              Nothing on {menuWord} matches “{trimmed}”.
            </p>
            <p className={styles.emptyLine}>
              Try one word of a dish’s name, or something in it.
            </p>
            <button
              type="button"
              className={styles.emptyButton}
              onClick={() => {
                setQuery('');
                inputRef.current?.focus();
              }}
            >
              Clear the search
            </button>
          </div>
        )
      ) : (
        <div className={styles.sections}>
          {sections.map((section) => (
            <MenuSectionBlock
              key={section.id}
              section={section}
              dishHref={dishHref}
              steppers={steppers}
            />
          ))}
          {footnote ? <p className={styles.footnote}>{footnote}</p> : null}
        </div>
      )}

      {/* The way into the cart. Nothing at all when the cart is empty: the
          kitchen's line already sits under the title. A link, not a button —
          the cart is a real route. */}
      {cart ? (
        <div className={styles.cartBar}>
          <Link href={cart.href} className={styles.cartButton}>
            <span>
              <span className="tabular">{cart.count}</span> {cart.count === 1 ? 'dish' : 'dishes'}
            </span>
            <span>Review order</span>
            <span className="tabular">{cart.total}</span>
          </Link>
        </div>
      ) : null}
    </main>
  );
}

/**
 * One section, in the shape its kind calls for.
 *
 * The board draws an editorial collection as photographs — a lead dish at full
 * width and the rest two-up — and a plain category as rows. Which is which is
 * already in the data (`kind`), so a property gets the same reading of its own
 * menu without configuring a layout. An odd-numbered collection leads with its
 * first dish, so the grid below it never ends on an orphan; an even one is
 * all grid.
 */
function MenuSectionBlock({
  section,
  dishHref,
  steppers,
}: {
  section: MenuSection;
  dishHref: (id: string) => string;
  steppers: Record<string, React.ReactNode>;
}) {
  const items = section.items;

  // An offer every dish in the section shares ("20% off") is said once, on
  // the section, as the board does for its late-night menu. Each dish still
  // carries its own struck price.
  const offers = new Set(items.map((d) => d.offer?.label ?? ''));
  const sharedOffer = items.length > 1 && offers.size === 1 ? [...offers][0] : '';

  const lead = section.kind === 'COLLECTION' && items.length % 2 === 1 ? items[0] : null;
  const rest = lead ? items.slice(1) : items;

  return (
    <section id={section.id} data-section className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>{section.title}</h2>
        {sharedOffer ? <span className={styles.sectionOffer}>{sharedOffer}</span> : null}
      </div>
      {section.blurb ? <p className={styles.blurb}>{section.blurb}</p> : null}

      {section.kind === 'COLLECTION' ? (
        <>
          {lead ? (
            <ul className={styles.feature}>
              <DishCard
                dish={lead}
                href={dishHref(lead.id)}
                variant="feature"
                control={steppers[lead.id]}
              />
            </ul>
          ) : null}
          {rest.length ? (
            <ul className={styles.grid}>
              {rest.map((dish) => (
                <DishCard
                  key={dish.id}
                  dish={dish}
                  href={dishHref(dish.id)}
                  variant="grid"
                  control={steppers[dish.id]}
                />
              ))}
            </ul>
          ) : null}
        </>
      ) : (
        <ul className={styles.rows}>
          {items.map((dish) => (
            <DishCard
              key={dish.id}
              dish={dish}
              href={dishHref(dish.id)}
              variant="row"
              control={steppers[dish.id]}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
