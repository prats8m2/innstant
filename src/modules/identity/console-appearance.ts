/**
 * The console's light or dark, as a person picks it (migration 0017).
 *
 * A pure file — no database import — so the top bar's toggle can read the
 * list in the browser, the way the guest menu's search reads `searchMenu`.
 */
export const CONSOLE_APPEARANCES = ['light', 'dark', 'system'] as const;

export type ConsoleAppearance = (typeof CONSOLE_APPEARANCES)[number];

export const DEFAULT_CONSOLE_APPEARANCE: ConsoleAppearance = 'system';

export function isConsoleAppearance(value: unknown): value is ConsoleAppearance {
  return typeof value === 'string' && (CONSOLE_APPEARANCES as readonly string[]).includes(value);
}

/**
 * What the server renders into `data-console` before the browser has said
 * anything. `system` renders LIGHT and is corrected by a script before paint
 * when the device prefers dark — the token file's "resolve in JS".
 */
export function renderedConsole(appearance: ConsoleAppearance): 'light' | 'dark' {
  return appearance === 'dark' ? 'dark' : 'light';
}

/** What each choice is called where somebody picks it. */
export const APPEARANCE_LABELS: Record<ConsoleAppearance, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'Match device',
};
