'use client';

import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { ArrowRight, Check, Copy, Moon, MonitorSmartphone, Sun } from 'lucide-react';
import type { GuestThemeKey, PropertyBranding } from '@/modules/identity/branding';
import type { GuestThemeSheet } from '@/modules/identity/theme-sheet';
import {
  saveBranding, pickThemeDraft, discardThemeDraftAction, publishThemeAction, type PropertyState,
} from './actions';
import b from './branding.module.css';

/**
 * Branding & themes (D-102, replacing D-087's single accent).
 *
 * A hotel picks one of the five guest themes in the token file. Picking a
 * card saves a DRAFT — the preview on the right wears it, the console's
 * accent note and contrast table follow it — and nothing a guest sees moves
 * until "Publish theme". "Discard" drops the draft. Logo and cover are saved
 * on their own, as before.
 *
 * No colour in this file. Every swatch, chip and preview sits inside an
 * element carrying `data-guest-theme` (or `data-console` + `data-accent`) and
 * paints with `var(--g-*)`, so what it shows is innstant-themes.css itself.
 * The contrast numbers and the CSS block come from the server, worked out
 * from the JSON mirror of that file (`theme-sheet.ts`).
 *
 * The staff console's appearance is per person, set from the top bar; this
 * screen only explains the three choices and which one is yours.
 */
type ConsoleMode = 'light' | 'dark';
type Appearance = ConsoleMode | 'system';

export function BrandingEditor({
  propertyId,
  propertyName,
  branding,
  sheets,
  mayEdit,
}: {
  propertyId: string;
  propertyName: string;
  branding: PropertyBranding;
  sheets: GuestThemeSheet[];
  mayEdit: boolean;
}) {
  const router = useRouter();
  const live = branding.theme;
  const saved = branding.draftTheme ?? branding.theme;
  const [selected, setSelected] = useState<GuestThemeKey>(saved);
  const [message, setMessage] = useState<PropertyState>({});
  const [pending, startTransition] = useTransition();
  const appearance = useConsoleAppearance();
  const mode: ConsoleMode = appearance.resolved;

  // A publish or discard elsewhere (another tab, another manager) arrives as
  // new props; the cards follow it.
  useEffect(() => { setSelected(saved); }, [saved]);

  const sheet = sheets.find((s) => s.key === selected) ?? sheets[0]!;
  const liveName = sheets.find((s) => s.key === live)?.name ?? live;
  const hasDraft = selected !== live;
  // A pre-theme accent (D-087) is still on the guest screens until a publish.
  const legacyAccent = branding.accent && live === 'kesari' ? branding.accent : null;

  const run = (job: () => Promise<PropertyState>) => {
    startTransition(async () => {
      const result = await job();
      setMessage(result);
      router.refresh();
    });
  };

  const pick = (key: GuestThemeKey) => {
    if (!mayEdit || key === selected) return;
    setSelected(key);
    run(() => pickThemeDraft(propertyId, key));
  };

  return (
    <div className={b.page}>
      <header className={b.head}>
        <div className={b.headText}>
          <h2 className={b.title}>Branding &amp; themes</h2>
          <p className={b.sub}>
            What guests see on their phones, and how this console looks to your team.
            A published theme reaches every guest from their next tap.
          </p>
        </div>
        {mayEdit ? (
          <div className={b.headActions}>
            <button
              type="button"
              className={b.btn}
              disabled={pending || !hasDraft}
              onClick={() => { setSelected(live); run(() => discardThemeDraftAction(propertyId)); }}
            >
              Discard
            </button>
            <button
              type="button"
              className={b.btnPrimary}
              disabled={pending || (!hasDraft && !legacyAccent)}
              onClick={() => run(() => publishThemeAction(propertyId))}
            >
              {pending ? 'Saving…' : 'Publish theme'}
            </button>
          </div>
        ) : null}
      </header>

      <p className={b.status} aria-live="polite">
        {message.error ? <span className={b.error} role="alert">{message.error}</span>
          : hasDraft ? (
            <>
              <span className={b.draftPill}>Draft</span>
              {sheet.name} is a draft. Guests still see <b>{liveName}</b> until you publish.
            </>
          ) : message.done ? <span className={b.done}>{message.done}</span>
            : !mayEdit ? 'Only a property admin can change the branding.' : null}
      </p>

      <div className={b.grid}>
        <div className={b.settings}>
          <section className={b.card} aria-labelledby="guest-theme">
            <div className={b.cardHead}>
              <div>
                <h3 id="guest-theme" className={b.h3}>Guest app theme</h3>
                <p className={b.sub}>Five themes, each checked for AA contrast. Pick one; your logo and cover photo sit on top.</p>
              </div>
              <span className={b.liveNow}>Live now: <b>{liveName}</b></span>
            </div>
            <ThemeCards sheets={sheets} selected={selected} live={live} disabled={!mayEdit} onPick={pick} />
            {legacyAccent ? (
              <p className={b.note}>
                Guests also see a custom accent, <span className="tabular">{legacyAccent}</span>, chosen before
                themes. The preview shows the theme without it; publishing makes that what guests see.
              </p>
            ) : null}
          </section>

          <section className={b.card} aria-labelledby="console-look">
            <div>
              <h3 id="console-look" className={b.h3}>Staff console</h3>
              <p className={b.sub}>
                Each person picks their own from the moon icon in the top bar. These are the three choices;
                nothing here changes anybody&rsquo;s screen.
              </p>
            </div>
            <ul className={b.apps}>
              {APPEARANCES.map((a) => (
                <li key={a.key} className={b.app} data-yours={appearance.chosen === a.key || undefined}>
                  <AppearanceThumb kind={a.key} accent={selected} />
                  <span className={b.appLabel}>
                    <a.icon size={15} aria-hidden="true" />
                    {a.label}
                    {appearance.chosen === a.key ? <span className={b.yours}>Yours</span> : null}
                  </span>
                </li>
              ))}
            </ul>
            <div className={b.accentNote} data-console={mode} data-accent={selected}>
              <span className={b.accentSwatch} aria-hidden="true" />
              <span className={b.accentText}>
                <span className={b.accentTitle}>Console accent follows the guest theme</span>
                <span className={b.accentSub}>
                  A deeper tone chosen for {mode === 'dark' ? 'a dark screen' : 'paper'},{' '}
                  <span className="tabular">{sheet.consoleAccent[mode]}</span>. Red is never offered — it&rsquo;s reserved for late.
                </span>
              </span>
            </div>
          </section>

          <section className={b.card} aria-labelledby="contrast">
            <div className={b.cardHead}>
              <h3 id="contrast" className={b.h3}>Contrast check · {sheet.name}</h3>
              <span className={b.liveNow}>Computed from the tokens, WCAG 2.2</span>
            </div>
            <ul className={b.contrast} data-guest-theme={sheet.key}>
              {sheet.contrast.map((row) => (
                <li key={row.label} className={b.contrastRow}>
                  <span
                    className={b.chip}
                    style={{ background: `var(--${row.bg})`, color: `var(--${row.fg})` }}
                    aria-hidden="true"
                  >
                    Aa
                  </span>
                  <span>{row.label}</span>
                  <span className={`${b.ratio} tabular`}>{row.ratio}</span>
                  <span className={b.verdict} data-ok={row.verdict !== 'Fails'}>
                    {row.verdict}<span className={b.srOnly}> (needs {row.floor}:1)</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <DeveloperTokens css={`${sheet.guestCss}\n\n${sheet.consoleCss[mode]}`} />

          <Pictures propertyId={propertyId} branding={branding} mayEdit={mayEdit} />
        </div>

        <Preview
          propertyName={propertyName}
          theme={selected}
          mode={mode}
          logoUrl={branding.logoUrl}
          coverUrl={branding.coverUrl}
        />
      </div>
    </div>
  );
}

/* ── Theme cards ─────────────────────────────────────────────────────────── */

function ThemeCards({
  sheets, selected, live, disabled, onPick,
}: {
  sheets: GuestThemeSheet[];
  selected: GuestThemeKey;
  live: GuestThemeKey;
  disabled: boolean;
  onPick: (key: GuestThemeKey) => void;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  /** A radio group: arrows move and choose, Tab leaves the group. */
  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + sheets.length) % sheets.length;
    refs.current[next]?.focus();
    onPick(sheets[next]!.key);
  };

  return (
    <div role="radiogroup" aria-label="Guest theme" className={b.themes}>
      {sheets.map((sheet, index) => {
        const on = sheet.key === selected;
        return (
          <button
            key={sheet.key}
            ref={(el) => { refs.current[index] = el; }}
            type="button"
            role="radio"
            aria-checked={on}
            aria-disabled={disabled || undefined}
            tabIndex={on ? 0 : -1}
            className={b.theme}
            data-on={on}
            onClick={() => onPick(sheet.key)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            <span className={b.swatch} data-guest-theme={sheet.key} aria-hidden="true">
              <svg width="26" height="34" viewBox="0 0 200 260" className={b.swatchArch}>
                <path d="M8 260 V110 C8 60 54 32 100 8 C146 32 192 60 192 110 V260" fill="none" strokeWidth="10" />
              </svg>
              <span className={b.swatchBars}>
                <span className={b.bar1} />
                <span className={b.bar2} />
                <span className={b.barBtn} />
              </span>
            </span>
            <span className={b.themeName}>
              {sheet.name}
              {on ? <span className={b.tick}><Check size={12} strokeWidth={3} aria-hidden="true" /></span> : null}
            </span>
            <span className={b.themeOrigin}>{sheet.origin}</span>
            {sheet.key === live ? <span className={b.livePill}>Live</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/* ── Staff console appearance ────────────────────────────────────────────── */

const APPEARANCES = [
  { key: 'light', label: 'Light', icon: Sun },
  { key: 'dark', label: 'Dark', icon: Moon },
  { key: 'system', label: 'Match device', icon: MonitorSmartphone },
] as const;

/** A tiny console, in the real tokens of that appearance. */
function AppearanceThumb({ kind, accent }: { kind: Appearance; accent: GuestThemeKey }) {
  if (kind === 'system') {
    return (
      <span className={b.thumbSplit} aria-hidden="true">
        <span className={b.thumbHalf} data-console="light" data-accent={accent}><MiniConsole /></span>
        <span className={b.thumbHalf} data-console="dark" data-accent={accent}><MiniConsole /></span>
      </span>
    );
  }
  return (
    <span className={b.thumb} data-console={kind} data-accent={accent} aria-hidden="true">
      <MiniConsole />
    </span>
  );
}

function MiniConsole() {
  return (
    <>
      <span className={b.thumbSide} />
      <span className={b.thumbBody}>
        <span className={b.thumbLine1} />
        <span className={b.thumbLine2} />
      </span>
    </>
  );
}

/**
 * Which appearance this person's console is in. The top bar owns the choice
 * (appearance-toggle.tsx) and writes it on the console's frame as
 * `data-appearance` (light, dark or system) beside the rendered
 * `data-console`; this only reads them, and follows them when they change.
 * Without a frame it falls back to <html data-console>.
 */
function useConsoleAppearance(): { chosen: Appearance | null; resolved: ConsoleMode } {
  const [state, setState] = useState<{ chosen: Appearance | null; resolved: ConsoleMode }>({
    chosen: null, resolved: 'light',
  });
  useEffect(() => {
    const root = document.documentElement;
    const frame = document.querySelector('[data-appearance]') ?? root;
    const read = () => {
      const rendered = frame.getAttribute('data-console') ?? root.getAttribute('data-console');
      const stored = frame.getAttribute('data-appearance') ?? rendered;
      const chosen = (['light', 'dark', 'system'] as const).find((a) => a === stored) ?? null;
      setState({ chosen, resolved: rendered === 'dark' ? 'dark' : 'light' });
    };
    read();
    const observer = new MutationObserver(read);
    const attributeFilter = ['data-console', 'data-appearance'];
    observer.observe(frame, { attributes: true, attributeFilter });
    if (frame !== root) observer.observe(root, { attributes: true, attributeFilter });
    return () => observer.disconnect();
  }, []);
  return state;
}

/* ── Developer tokens ────────────────────────────────────────────────────── */

function DeveloperTokens({ css }: { css: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => { setCopied(false); }, [css]);
  return (
    <section className={b.card} aria-labelledby="dev-tokens">
      <div className={b.cardHead}>
        <div>
          <h3 id="dev-tokens" className={b.h3}>Developer tokens</h3>
          <p className={b.sub}>The selected theme as CSS custom properties. The full set is in innstant-themes.css.</p>
        </div>
        <button
          type="button"
          className={b.btn}
          onClick={async () => {
            try { await navigator.clipboard.writeText(css); setCopied(true); } catch { setCopied(false); }
          }}
        >
          {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
          {copied ? 'Copied' : 'Copy tokens'}
        </button>
      </div>
      <pre className={`${b.code} tabular`}>{css}</pre>
    </section>
  );
}

/* ── Logo and cover ──────────────────────────────────────────────────────── */

function Pictures({ propertyId, branding, mayEdit }: {
  propertyId: string; branding: PropertyBranding; mayEdit: boolean;
}) {
  const [state, action] = useActionState<PropertyState, FormData>(saveBranding, {});
  const [logoUrl, setLogoUrl] = useState(branding.logoUrl ?? '');
  const [coverUrl, setCoverUrl] = useState(branding.coverUrl ?? '');
  const dirty = logoUrl !== (branding.logoUrl ?? '') || coverUrl !== (branding.coverUrl ?? '');

  return (
    <section className={b.card} aria-labelledby="pictures">
      <div>
        <h3 id="pictures" className={b.h3}>Logo and cover photo</h3>
        <p className={b.sub}>Saved on their own, and live as soon as they are saved.</p>
      </div>
      <form action={action} className={b.form}>
        <input type="hidden" name="propertyId" value={propertyId} />
        <fieldset disabled={!mayEdit} className={b.fieldset}>
          <label className={b.field}>
            <span className={b.label}>Logo</span>
            <input
              name="logoUrl"
              className={b.input}
              value={logoUrl}
              onChange={(event) => setLogoUrl(event.target.value)}
              placeholder="https://…/logo.png"
              inputMode="url"
            />
            <span className={b.hint}>
              Replaces the hotel&rsquo;s name at the top of the guest home. A light logo on a transparent background works best.
            </span>
          </label>
          <label className={b.field}>
            <span className={b.label}>Cover photo</span>
            <input
              name="coverUrl"
              className={b.input}
              value={coverUrl}
              onChange={(event) => setCoverUrl(event.target.value)}
              placeholder="https://…/courtyard.jpg"
              inputMode="url"
            />
            <span className={b.hint}>Behind the arch on the guest home, dimmed so the kitchen&rsquo;s hours stay readable.</span>
          </label>
        </fieldset>
        {mayEdit ? (
          <div className={b.formFoot}>
            {state.error ? <span className={b.error} role="alert">{state.error}</span> : null}
            {state.done && !dirty ? <span className={b.done}>{state.done}</span> : null}
            <SavePictures disabled={!dirty} />
          </div>
        ) : null}
      </form>
    </section>
  );
}

function SavePictures({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={b.btnPrimary} disabled={disabled || pending}>
      {pending ? 'Saving…' : 'Save pictures'}
    </button>
  );
}

/* ── Live preview ────────────────────────────────────────────────────────── */

/**
 * The guest home, small, in the chosen theme's own tokens. `data-theme` is
 * repeated beside `data-guest-theme` for the reason brand-scope.tsx gives: a
 * var() resolves where it is declared, so theme.css's role names have to be
 * recomputed on this element for the chosen theme to reach them. The words
 * are a sample — a preview of a room, not anybody's stay.
 */
function Preview({
  propertyName, theme, mode, logoUrl, coverUrl,
}: {
  propertyName: string;
  theme: GuestThemeKey;
  mode: ConsoleMode;
  logoUrl: string | null;
  coverUrl: string | null;
}) {
  return (
    <aside className={b.preview} aria-label="Live preview">
      <span className={b.lbl}>Live preview</span>
      <div className={b.device}>
        <div className={b.screen} data-theme="kesari" data-guest-theme={theme}>
          <div className={b.pMast}>
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- a preview of any host the hotel pastes
              <img src={logoUrl} alt={propertyName} className={b.pLogo} />
            ) : (
              <span className={b.pWordmark}>{propertyName.toUpperCase()}</span>
            )}
            <span className={b.pRoom}>Room <span className="tabular">214</span></span>
          </div>
          <div className={b.pHero}>
            <span className={b.pArchWrap}>
              {coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- a preview of any host the hotel pastes
                <img src={coverUrl} alt="" className={b.pCover} />
              ) : null}
              <svg width="74" height="96" viewBox="0 0 200 260" className={b.pArch} aria-hidden="true">
                <path d="M2 260 V110 C2 60 50 30 100 2 C150 30 198 60 198 110 V260" strokeWidth="4" />
              </svg>
            </span>
            <span className={b.pGreeting}>Good evening</span>
          </div>
          <div className={b.pStatus}>
            <span className={b.pDot} aria-hidden="true" />
            <span className={b.pStatusText}>
              <span>Dinner is plated and covered</span>
              <span className={b.pMuted}>At your door around <span className="tabular">9:05pm</span></span>
            </span>
          </div>
          <div className={b.pTiles}>
            {[['Amenities', 'Towels, pillows'], ['Call for service', 'Someone comes up'], ['Your stay', 'Bill, Wi-Fi'], ['Plan my day', 'Places nearby']].map(([title, sub]) => (
              <span key={title} className={b.pTile}>
                <span className={b.pTileTitle}>{title}</span>
                <span className={b.pMuted}>{sub}</span>
              </span>
            ))}
          </div>
          <div className={b.pChips}>
            <span className={b.pReady}>Open till 11pm</span>
            <span className={b.pLate}>About 6 min behind</span>
          </div>
          <span className={b.pButton}><span>Order dinner to room <span className="tabular">214</span></span><ArrowRight size={14} aria-hidden="true" /></span>
        </div>
      </div>

      <div className={b.snippet} data-console={mode} data-accent={theme} aria-hidden="true">
        <span className={b.sSide}>
          <span className={b.sNavOn} />
          <span className={b.sNav} />
          <span className={b.sNav} />
          <span className={b.sNav} />
        </span>
        <span className={b.sBody}>
          <span className={b.sStats}>
            <span className={b.sStat}><span className={b.sStatLabel}>Open requests</span><span className="tabular">6</span></span>
            <span className={b.sStat}><span className={b.sStatLabel}>On time</span><span className="tabular">92%</span></span>
          </span>
          <span className={b.sPills}>
            <span className={b.sPos}>Ready</span>
            <span className={b.sWarn}>Nobody has it</span>
            <span className={b.sCrit}>Late 6 min</span>
          </span>
          <span className={b.sButton}>Assign</span>
        </span>
      </div>
    </aside>
  );
}
