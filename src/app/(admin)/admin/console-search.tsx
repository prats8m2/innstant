'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BedDouble, CornerDownLeft, Loader2, ReceiptText, Search, UserRound } from 'lucide-react';
import { searchConsole, type SearchKind, type SearchResult } from './console-actions';
import styles from './admin.module.css';

/**
 * The console's search: rooms by number, guests by name, orders by number.
 *
 * Opened by ⌘K (Ctrl+K off a Mac), or by either trigger — the field in the
 * sidebar on a desk, the magnifier in the top bar on a phone. Both triggers
 * ask by event rather than by shared state, so the server-rendered frame
 * does not have to become one client component to hold a boolean.
 *
 * ─── The dialog ────────────────────────────────────────────────────────────
 *
 * A native `<dialog>` opened with `showModal()`: the page behind becomes
 * inert (the focus trap), Escape closes it, and it sits in the top layer
 * above the rail and the bell without a z-index argument. The input is a
 * combobox over a listbox; arrow keys move the active option, Enter opens it,
 * and the input keeps focus throughout, as a combobox does.
 *
 * ─── The round trip ────────────────────────────────────────────────────────
 *
 * Debounced, and every answer carries the query it is for: an answer to
 * "21" arriving after the answer to "214" is dropped rather than shown.
 * What may be searched is decided on the server (`searchConsole`), by the
 * person's permissions; nothing here filters.
 */

export const OPEN_SEARCH_EVENT = 'innstant:console-search';

const DEBOUNCE_MS = 180;

const GROUPS: Array<{ kind: SearchKind; title: string; icon: typeof BedDouble }> = [
  { kind: 'room', title: 'Rooms', icon: BedDouble },
  { kind: 'guest', title: 'Guests', icon: UserRound },
  { kind: 'order', title: 'Orders', icon: ReceiptText },
];

function useShortcutLabel() {
  // ⌘K on the server and on a Mac; Ctrl K everywhere else, once we know.
  const [label, setLabel] = useState('⌘K');
  useEffect(() => {
    if (!/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)) setLabel('Ctrl K');
  }, []);
  return label;
}

function openSearch() {
  window.dispatchEvent(new Event(OPEN_SEARCH_EVENT));
}

/** The sidebar's field, as the board draws it. A button: it opens a dialog. */
export function SearchField() {
  const shortcut = useShortcutLabel();
  return (
    <button
      type="button"
      className={styles.searchField}
      onClick={openSearch}
      aria-label="Search rooms, guests, orders"
      aria-keyshortcuts="Meta+K Control+K"
    >
      <Search size={15} strokeWidth={1.5} aria-hidden="true" />
      {/* The magnifier says "search"; the words say what. The board's full
          sentence does not fit 248px beside the shortcut in Mukta. */}
      <span className={styles.searchFieldText}>Rooms, guests, orders</span>
      <kbd className={`${styles.kbd} tabular`} aria-hidden="true">{shortcut}</kbd>
    </button>
  );
}

/** The top bar's magnifier, where the sidebar is folded away (a phone). */
export function SearchIconButton() {
  return (
    <button
      type="button"
      className={`${styles.topIcon} ${styles.topSearch}`}
      onClick={openSearch}
      aria-label="Search rooms, guests, orders"
    >
      <Search size={17} strokeWidth={1.5} aria-hidden="true" />
    </button>
  );
}

type Phase = 'idle' | 'loading' | 'done' | 'error';

export function ConsoleSearch({ propertyId }: { propertyId: string }) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const latest = useRef('');
  const listId = useId();
  const optionId = (index: number) => `${listId}-o${index}`;

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [kinds, setKinds] = useState<SearchKind[] | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [active, setActive] = useState(0);

  const open = useCallback(() => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    returnFocus.current = document.activeElement as HTMLElement | null;
    dialog.showModal();
    inputRef.current?.select();
  }, []);

  const close = useCallback(() => {
    dialogRef.current?.close();
  }, []);

  // ⌘K / Ctrl+K anywhere in the console, and the triggers' event.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'k' || !(event.metaKey || event.ctrlKey)) return;
      if (event.altKey || event.shiftKey) return;
      event.preventDefault();
      if (dialogRef.current?.open) close();
      else open();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener(OPEN_SEARCH_EVENT, open);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(OPEN_SEARCH_EVENT, open);
    };
  }, [open, close]);

  // The debounced round trip. An answer for an older query is dropped.
  useEffect(() => {
    const typed = query.trim();
    latest.current = typed;
    if (!typed) {
      setResults([]);
      setPhase('idle');
      return;
    }
    setPhase('loading');
    const timer = window.setTimeout(async () => {
      try {
        const answer = await searchConsole({ propertyId, query: typed });
        if (latest.current !== typed) return;
        setResults(answer.results);
        setKinds(answer.kinds);
        setActive(0);
        setPhase('done');
      } catch {
        if (latest.current !== typed) return;
        setResults([]);
        setPhase('error');
      }
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query, propertyId]);

  const go = (result: SearchResult | undefined) => {
    if (!result) return;
    close();
    router.push(result.href);
  };

  const onInputKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    // One Escape closes, even with text in the box: a search field's own
    // Escape would clear the text first and need a second press.
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (!results.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((index) => (index + 1) % results.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => (index - 1 + results.length) % results.length);
    } else if (event.key === 'Home' && event.ctrlKey) {
      event.preventDefault();
      setActive(0);
    } else if (event.key === 'End' && event.ctrlKey) {
      event.preventDefault();
      setActive(results.length - 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      go(results[active]);
    }
  };

  // Keep the active option in view as the arrows walk past the edge.
  useEffect(() => {
    document.getElementById(`${listId}-o${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, listId]);

  const hint = kinds && kinds.length === 0
    ? 'This account cannot open rooms, guests or orders.'
    : 'A room number, a guest’s name, or an order number like KE-1186.';

  const showList = phase === 'done' && results.length > 0;
  // The server answers rooms, then guests, then orders: the groups' order,
  // so an option's place in `results` is its place on screen.
  const grouped = GROUPS.map((group) => ({
    ...group,
    items: results
      .map((result, at) => ({ result, at }))
      .filter(({ result }) => result.kind === group.kind),
  })).filter((group) => group.items.length > 0);

  return (
    <dialog
      ref={dialogRef}
      className={styles.searchDialog}
      aria-label="Search"
      onClose={() => {
        returnFocus.current?.focus?.();
      }}
      // A click on the backdrop lands on the dialog element itself.
      onClick={(event) => { if (event.target === event.currentTarget) close(); }}
    >
      <div className={styles.searchBox}>
        <div className={styles.searchInputRow}>
          {phase === 'loading'
            ? <Loader2 className={styles.searchSpin} size={18} strokeWidth={1.5} aria-hidden="true" />
            : <Search size={18} strokeWidth={1.5} aria-hidden="true" />}
          <input
            ref={inputRef}
            className={styles.searchInput}
            type="search"
            role="combobox"
            aria-label="Search rooms, guests and orders"
            aria-expanded={showList}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={showList ? optionId(active) : undefined}
            placeholder="Search rooms, guests, orders"
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="go"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onInputKey}
          />
          <kbd className={`${styles.kbd} tabular`} aria-hidden="true">Esc</kbd>
        </div>

        <div className={styles.searchBody} aria-live="polite" aria-busy={phase === 'loading'}>
          {phase === 'idle' ? <p className={styles.searchHint}>{hint}</p> : null}
          {phase === 'error'
            ? <p className={styles.searchHint} role="alert">Search did not answer. Try again in a moment.</p>
            : null}
          {phase === 'done' && results.length === 0
            ? <p className={styles.searchHint}>Nothing matches “{query.trim()}”.</p>
            : null}

          <ul id={listId} role="listbox" aria-label="Results" className={styles.searchList} hidden={!showList}>
            {grouped.map((group) => {
              const Icon = group.icon;
              return (
                <li key={group.kind} role="presentation">
                  <p className={styles.searchGroup} aria-hidden="true">{group.title}</p>
                  <ul role="group" aria-label={group.title} className={styles.searchGroupList}>
                    {group.items.map(({ result, at }) => {
                      return (
                        <li
                          key={`${result.kind}-${result.id}`}
                          id={optionId(at)}
                          role="option"
                          aria-selected={at === active}
                          className={styles.searchOption}
                          onMouseMove={() => { if (active !== at) setActive(at); }}
                          onClick={() => go(result)}
                        >
                          <span className={styles.searchOptionIcon}>
                            <Icon size={16} strokeWidth={1.5} aria-hidden="true" />
                          </span>
                          <span className={styles.searchOptionText}>
                            <span className={styles.searchOptionTitle}>{result.title}</span>
                            <span className={styles.searchOptionDetail}>{result.detail}</span>
                          </span>
                          <CornerDownLeft
                            className={styles.searchOptionEnter}
                            size={14}
                            strokeWidth={1.5}
                            aria-hidden="true"
                          />
                        </li>
                      );
                    })}
                  </ul>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </dialog>
  );
}
