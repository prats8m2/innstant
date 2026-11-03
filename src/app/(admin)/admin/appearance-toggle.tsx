'use client';

import {
  createContext, useCallback, useContext, useEffect, useId, useRef, useState,
} from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import {
  APPEARANCE_LABELS, CONSOLE_APPEARANCES, renderedConsole, type ConsoleAppearance,
} from '@/modules/identity/console-appearance';
import type { GuestThemeKey } from '@/modules/identity/branding';
import { saveConsoleAppearance } from './console-actions';
import styles from './admin.module.css';

/**
 * The console's light or dark, for the person signed in (migration 0017).
 *
 * ─── How it is chosen ──────────────────────────────────────────────────────
 *
 * `ConsoleFrame` is the console's outermost element. It carries
 * `data-console` (this person's light or dark) and `data-accent` (the
 * property's guest theme), and theme.css re-declares every console role name
 * on `[data-console]`, so everything inside recomputes from the token file.
 *
 * "Match device" cannot be known on the server. The frame renders LIGHT, and
 * a one-line script right inside it flips the attribute to dark before the
 * first paint when the device prefers dark — the token file's "resolve in
 * JS". React is told not to mind that one attribute differing at hydration;
 * an effect then takes over and follows the device if it changes while open.
 *
 * `<html>` is kept in step from an effect, so anything portalled to `<body>`
 * and the page's overscroll match the console, and put back on the way out.
 */

interface AppearanceState {
  appearance: ConsoleAppearance;
  resolved: 'light' | 'dark';
  choose: (next: ConsoleAppearance) => Promise<boolean>;
}

const AppearanceContext = createContext<AppearanceState | null>(null);

const DARK_QUERY = '(prefers-color-scheme: dark)';

/** Runs during parsing, before paint; `currentScript` is the tag itself. */
const RESOLVE_SYSTEM = `(function(){try{var s=document.currentScript,f=s&&s.parentElement;if(f&&f.getAttribute('data-appearance')==='system'&&window.matchMedia('${DARK_QUERY}').matches){f.setAttribute('data-console','dark')}}catch(e){}})();`;

export function ConsoleFrame({
  appearance: initial,
  theme,
  className,
  children,
}: {
  appearance: ConsoleAppearance;
  theme: GuestThemeKey;
  className?: string;
  children: React.ReactNode;
}) {
  const [appearance, setAppearance] = useState<ConsoleAppearance>(initial);
  // What the server rendered, until an effect can ask the device.
  const [deviceDark, setDeviceDark] = useState<boolean | null>(null);

  useEffect(() => {
    const media = window.matchMedia(DARK_QUERY);
    const sync = () => setDeviceDark(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  const resolved: 'light' | 'dark' = appearance === 'system'
    ? (deviceDark ? 'dark' : 'light')
    : renderedConsole(appearance);

  useEffect(() => {
    const root = document.documentElement;
    const before = {
      console: root.getAttribute('data-console'),
      accent: root.getAttribute('data-accent'),
    };
    root.setAttribute('data-console', resolved);
    root.setAttribute('data-accent', theme);
    return () => {
      if (before.console) root.setAttribute('data-console', before.console);
      if (before.accent) root.setAttribute('data-accent', before.accent);
    };
  }, [resolved, theme]);

  const choose = useCallback(async (next: ConsoleAppearance) => {
    const previous = appearance;
    setAppearance(next);
    try {
      await saveConsoleAppearance({ appearance: next });
      return true;
    } catch {
      setAppearance(previous);
      return false;
    }
  }, [appearance]);

  return (
    <AppearanceContext.Provider value={{ appearance, resolved, choose }}>
      <div
        className={className}
        data-console={resolved}
        data-accent={theme}
        data-appearance={appearance}
        suppressHydrationWarning
      >
        <script dangerouslySetInnerHTML={{ __html: RESOLVE_SYSTEM }} />
        {children}
      </div>
    </AppearanceContext.Provider>
  );
}

/**
 * This person's console appearance, and the way to change it — the same state
 * the moon in the top bar shows, so a choice made on the Branding screen and
 * one made in the top bar are one choice. Null outside the console frame.
 */
export function useAppearanceChoice(): AppearanceState | null {
  return useContext(AppearanceContext);
}

const ICONS = { light: Sun, dark: Moon, system: Monitor } as const;

/**
 * The moon in the top bar: Light, Dark or Match device, for this person only.
 * A small popover of three radios — arrow keys move between them and choose,
 * as radios do; Escape or a click elsewhere closes it.
 */
export function AppearanceToggle() {
  const state = useContext(AppearanceContext);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const name = useId();

  useEffect(() => {
    if (!open) return;
    wrapRef.current?.querySelector<HTMLInputElement>('input:checked')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    const onPointer = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  if (!state) return null;
  const { appearance, resolved, choose } = state;
  const Icon = resolved === 'dark' ? Sun : Moon;

  return (
    <div ref={wrapRef} className={styles.appearance}>
      <button
        ref={buttonRef}
        type="button"
        className={styles.topIcon}
        aria-label={`Appearance: ${APPEARANCE_LABELS[appearance]}`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon size={17} strokeWidth={1.5} aria-hidden="true" />
      </button>
      <fieldset id={panelId} className={styles.appearancePanel} hidden={!open}>
        <legend className={styles.appearanceLegend}>Your console</legend>
        {CONSOLE_APPEARANCES.map((key) => {
          const OptionIcon = ICONS[key];
          return (
            <label key={key} className={styles.appearanceOption}>
              <input
                type="radio"
                name={name}
                value={key}
                checked={appearance === key}
                onChange={() => {
                  setFailed(false);
                  // Not in a transition: the console switches now, and the
                  // save follows. A transition would hold the switch until
                  // the server answered.
                  void choose(key).then((saved) => { if (!saved) setFailed(true); });
                }}
              />
              <OptionIcon size={16} strokeWidth={1.5} aria-hidden="true" />
              <span>{APPEARANCE_LABELS[key]}</span>
            </label>
          );
        })}
        <p className={styles.appearanceNote} role={failed ? 'alert' : undefined}>
          {failed ? 'Not saved. Try again.' : 'Only for you, on any device you sign in on.'}
        </p>
      </fieldset>
    </div>
  );
}
