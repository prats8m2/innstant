'use client';

import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import {
  ArrowRight, Bell, Check, ConciergeBell, Copy, House, Landmark, MapPin, MessageCircle, Moon,
  MonitorSmartphone, Package, Sun, Utensils,
} from 'lucide-react';
import { GUEST_GROUND, type GuestThemeKey, type PropertyBranding } from '@/modules/identity/branding';
import { mediaSrcSet } from '@/modules/media/paths';
import { ImageField } from '../image-field';
import { useAppearanceChoice } from '../appearance-toggle';
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
  uploads,
}: {
  propertyId: string;
  propertyName: string;
  branding: PropertyBranding;
  sheets: GuestThemeSheet[];
  mayEdit: boolean;
  /** False when this server has nowhere to keep pictures (D-093). */
  uploads: boolean;
}) {
  const router = useRouter();
  const live = branding.theme;
  const saved = branding.draftTheme ?? branding.theme;
  const [selected, setSelected] = useState<GuestThemeKey>(saved);
  const [message, setMessage] = useState<PropertyState>({});
  const [pending, startTransition] = useTransition();
  // This person's own console look — the top bar's moon and these cards are
  // one choice (appearance-toggle.tsx).
  const appearance = useAppearanceChoice();
  const mode: ConsoleMode = appearance?.resolved ?? 'light';
  const [appearanceFailed, setAppearanceFailed] = useState(false);

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
                Your own console: pick how it looks for you. Everybody chooses their own, here or from the
                moon icon in the top bar; nobody else&rsquo;s screen changes.
              </p>
            </div>
            <fieldset className={b.apps} disabled={!appearance}>
              <legend className={b.visuallyHidden}>Your console appearance</legend>
              {APPEARANCES.map((a) => (
                <label key={a.key} className={b.app} data-yours={appearance?.appearance === a.key || undefined}>
                  <input
                    type="radio"
                    name="console-appearance"
                    value={a.key}
                    className={b.appRadio}
                    checked={appearance?.appearance === a.key}
                    onChange={() => {
                      setAppearanceFailed(false);
                      void appearance?.choose(a.key).then((saved) => { if (!saved) setAppearanceFailed(true); });
                    }}
                  />
                  <AppearanceThumb kind={a.key} accent={selected} />
                  <span className={b.appLabel}>
                    <a.icon size={15} aria-hidden="true" />
                    {a.label}
                    {appearance?.appearance === a.key ? <span className={b.yours}>Yours</span> : null}
                  </span>
                </label>
              ))}
            </fieldset>
            {appearanceFailed ? (
              <p className={b.error} role="alert">That did not save. Try again.</p>
            ) : null}
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

          <Pictures propertyId={propertyId} branding={branding} mayEdit={mayEdit} uploads={uploads} />
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

function Pictures({ propertyId, branding, mayEdit, uploads }: {
  propertyId: string; branding: PropertyBranding; mayEdit: boolean; uploads: boolean;
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
          {/* Uploaded, checked and cut to size by the server (D-093); a link
              box instead while this server has no storage. The logo is shown
              on the guest app's own ground, where it will actually sit. */}
          <ImageField
            name="logoUrl"
            label="Logo"
            hint="Replaces the hotel’s name at the top of the guest home. A light logo on a transparent background (PNG) works best."
            propertyId={propertyId}
            purpose="logo"
            value={logoUrl}
            onChange={setLogoUrl}
            aspect="3 / 1"
            ground={GUEST_GROUND}
            uploads={uploads}
          />
          <ImageField
            name="coverUrl"
            label="Cover photo"
            hint="Behind the arch on the guest home, dimmed so the kitchen’s hours stay readable."
            propertyId={propertyId}
            purpose="cover"
            value={coverUrl}
            onChange={setCoverUrl}
            aspect="16 / 9"
            uploads={uploads}
          />
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
          {/* The guest Home as D-105 draws it, small: the same parts in the
              same order, in this theme's own tokens and type. */}
          <div className={b.pMast}>
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- an upload, or a URL pasted before uploads (D-093)
              <img src={logoUrl} srcSet={mediaSrcSet(logoUrl)} sizes="120px" alt={propertyName} className={b.pLogo} />
            ) : (
              <span className={b.pBrand}>
                <svg width="13" height="16" viewBox="0 0 22 26" fill="none" aria-hidden="true">
                  <path d="M1 25V11C1 5.5 5.5 1 11 1s10 4.5 10 10v14" stroke="currentColor" strokeWidth="1.4" />
                  <circle cx="11" cy="18" r="2" fill="currentColor" />
                </svg>
                <span className={b.pWordmark}>{propertyName.toUpperCase()}</span>
              </span>
            )}
          </div>

          <div className={b.pHero}>
            {coverUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- an upload, or a URL pasted before uploads (D-093)
              <img src={coverUrl} srcSet={mediaSrcSet(coverUrl)} sizes="260px" alt="" className={b.pCover} />
            ) : null}
            <span className={b.pHeroLine} aria-hidden="true" />
            <span className={b.pEyebrow}>Day 2 of 4 · Room <span className="tabular">214</span></span>
            <span className={b.pGreeting}>Good evening,<br /><em>Anjali</em></span>
          </div>

          <div className={b.pStrip}>
            {[['Check-out', 'Mon, 11am'], ['Wi-Fi', 'Tap to join'], ['Bill', 'View']].map(([label, value]) => (
              <span key={label} className={b.pCell}>
                <span className={b.pCellLabel}>{label}</span>
                <span className={b.pCellValue}>{value}</span>
              </span>
            ))}
          </div>

          <span className={b.pHeading}>At your service</span>
          <div className={b.pTiles}>
            {([
              [ConciergeBell, 'In-room dining', 'Until 1am'],
              [Package, 'Amenities', 'Towels, pillows'],
              [Landmark, 'Plan my day', 'Places we vouch for'],
              [Bell, 'Call for service', 'About 8 min'],
            ] as const).map(([Icon, title, sub], index) => (
              <span key={title} className={b.pTile} data-lit={index === 3 || undefined}>
                <span className={b.pTileIcon}><Icon size={11} strokeWidth={1.6} aria-hidden="true" /></span>
                <span className={b.pTileText}>
                  <span className={b.pTileTitle}>{title}</span>
                  <span className={b.pMuted}>{sub}</span>
                </span>
              </span>
            ))}
          </div>

          <div className={b.pDock}>
            <span className={b.pButton}>
              <span className={b.pButtonText}>
                <span>Order dinner to Room <span className="tabular">214</span></span>
                <span className={b.pButtonSub}>Kitchen open until 1am · ~30 min</span>
              </span>
              <span className={b.pButtonArrow}><ArrowRight size={12} aria-hidden="true" /></span>
            </span>
            <span className={b.pNav}>
              {([[House, 'Stay'], [Utensils, 'Dining'], [MessageCircle, 'Concierge'], [MapPin, 'Explore']] as const).map(([Icon, label], index) => (
                <span key={label} className={b.pNavItem} data-on={index === 0 || undefined}>
                  <Icon size={13} strokeWidth={1.6} aria-hidden="true" />
                  {label}
                </span>
              ))}
            </span>
          </div>
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
