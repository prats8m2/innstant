'use client';

import { useActionState, useMemo, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { BedDouble, Compass, ConciergeBell, Sparkles } from 'lucide-react';
import {
  accentContrast, brandingStyle, BRAND_PRESETS, type PropertyBranding,
} from '@/modules/identity/branding';
import { saveBranding, type PropertyState } from './actions';
import styles from '../admin.module.css';
import s from './settings.module.css';

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * How the hotel looks to a guest (D-087): one accent, a logo, a cover photo,
 * and a phone beside them showing the result before anyone saves.
 *
 * The preview is not a screenshot and not the real page. It is a few guest
 * shapes — the masthead, the arch, the tiles, the order button — wearing
 * `data-theme="kesari"` and the SAME `brandingStyle()` the guest layouts set,
 * so what it shows is what the token swap does, by construction.
 *
 * The contrast numbers are the save's own check, run as you pick. The server
 * runs it again and refuses; this only saves the round trip.
 */
export function BrandingEditor({
  propertyId,
  propertyName,
  branding,
  mayEdit,
}: {
  propertyId: string;
  propertyName: string;
  branding: PropertyBranding;
  mayEdit: boolean;
}) {
  const [state, action] = useActionState<PropertyState, FormData>(saveBranding, {});
  const [accent, setAccent] = useState(branding.accent ?? '');
  const [logoUrl, setLogoUrl] = useState(branding.logoUrl ?? '');
  const [coverUrl, setCoverUrl] = useState(branding.coverUrl ?? '');

  const valid = HEX.test(accent);
  const check = valid ? accentContrast(accent) : null;
  const passes = check ? check.onGround >= 3 && check.inkOnAccent >= 4.5 : true;

  const previewStyle = useMemo(
    () => brandingStyle({ accent: valid && passes ? accent : null, logoUrl: null, coverUrl: null }),
    [accent, valid, passes],
  );

  const dirty = accent !== (branding.accent ?? '')
    || logoUrl !== (branding.logoUrl ?? '')
    || coverUrl !== (branding.coverUrl ?? '');

  return (
    <div className={s.brandGrid}>
      <section className={styles.section}>
        <header className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Branding</h2>
          <p className={styles.sectionBlurb}>
            How the hotel looks on a guest&rsquo;s phone. Everything else about the guest app stays the same.
          </p>
        </header>

        <form action={action}>
          <input type="hidden" name="propertyId" value={propertyId} />
          <fieldset disabled={!mayEdit} className={`${s.formSection} ${s.fieldset}`}>
            <h3 className={s.formSectionTitle}>Accent colour</h3>
            <p className={styles.hint}>
              Buttons, links and highlights. It sits on a dark indigo ground, so a light or mid shade reads best.
            </p>

            <div className={s.swatches} role="group" aria-label="Suggested accents">
              {BRAND_PRESETS.map((preset) => (
                <button
                  key={preset.hex}
                  type="button"
                  className={s.swatch}
                  style={{ background: preset.hex }}
                  aria-pressed={accent.toUpperCase() === preset.hex}
                  aria-label={preset.name}
                  title={preset.name}
                  onClick={() => setAccent(preset.hex)}
                />
              ))}
            </div>

            <label className={`${styles.field} ${s.spaced}`}>
              <span className={styles.label}>Your own colour</span>
              <span className={s.colorRow}>
                <input
                  type="color"
                  className={s.colorPicker}
                  value={(valid ? accent : BRAND_PRESETS[0]!.hex).toLowerCase()}
                  onChange={(event) => setAccent(event.target.value.toUpperCase())}
                  aria-label="Pick an accent colour"
                />
                <input
                  name="accent"
                  className={styles.input}
                  value={accent}
                  onChange={(event) => setAccent(event.target.value.trim())}
                  placeholder={`${BRAND_PRESETS[0]!.hex} — blank keeps the theme's saffron`}
                  maxLength={7}
                  spellCheck={false}
                />
              </span>
            </label>

            {check ? (
              <p className={s.checks} aria-live="polite">
                <span className={s.check} data-ok={check.onGround >= 3}>
                  On the indigo {check.onGround.toFixed(1)}:1 {check.onGround >= 3 ? '✓' : '— needs 3:1'}
                </span>
                <span className={s.check} data-ok={check.inkOnAccent >= 4.5}>
                  Button text {check.inkOnAccent.toFixed(1)}:1 {check.inkOnAccent >= 4.5 ? '✓' : '— needs 4.5:1'}
                </span>
              </p>
            ) : accent ? (
              <p className={styles.hint}>A hex colour is six digits after a #, like {BRAND_PRESETS[0]!.hex}.</p>
            ) : null}
          </fieldset>

          <fieldset disabled={!mayEdit} className={`${s.formSection} ${s.fieldset}`}>
            <h3 className={s.formSectionTitle}>Pictures</h3>
            <div className={styles.formGrid}>
              <label className={`${styles.field} ${styles.wide}`}>
                <span className={styles.label}>Logo</span>
                <input
                  name="logoUrl"
                  className={styles.input}
                  value={logoUrl}
                  onChange={(event) => setLogoUrl(event.target.value)}
                  placeholder="https://…/logo.png"
                  inputMode="url"
                />
                <span className={styles.hint}>
                  Replaces the hotel&rsquo;s name at the top of the guest home. A light logo on a transparent background works best.
                </span>
              </label>
              <label className={`${styles.field} ${styles.wide}`}>
                <span className={styles.label}>Cover photo</span>
                <input
                  name="coverUrl"
                  className={styles.input}
                  value={coverUrl}
                  onChange={(event) => setCoverUrl(event.target.value)}
                  placeholder="https://…/courtyard.jpg"
                  inputMode="url"
                />
                <span className={styles.hint}>
                  Behind the arch on the guest home, dimmed so the kitchen&rsquo;s hours stay readable.
                </span>
              </label>
            </div>
          </fieldset>

          <div className={s.saveBar} data-dirty={dirty}>
            <span className={s.dirtyNote}>
              {!mayEdit
                ? 'Only a property admin can change the branding.'
                : dirty ? 'Not saved yet — the preview shows the change.' : null}
            </span>
            {state.error ? <span className={styles.inlineError} role="alert">{state.error}</span> : null}
            {state.done && !dirty ? <span className={styles.inlineDone}>{state.done}</span> : null}
            {mayEdit ? (
              <>
                <button
                  type="button"
                  className={styles.secondary}
                  onClick={() => { setAccent(''); setLogoUrl(''); setCoverUrl(''); }}
                >
                  Use the theme
                </button>
                <SaveButton disabled={!dirty || (valid && !passes) || (accent !== '' && !valid)} />
              </>
            ) : null}
          </div>
        </form>
      </section>

      <div className={s.previewWrap}>
        <p className={s.previewLabel}>What a guest sees</p>
        <div className={s.phone} data-theme="kesari" style={previewStyle as React.CSSProperties}>
          <div className={s.phoneScreen}>
            <div className={s.pMast}>
              {logoUrl.startsWith('https://') ? (
                // eslint-disable-next-line @next/next/no-img-element -- a preview of any host the hotel pastes
                <img src={logoUrl} alt={propertyName} className={s.pLogo} />
              ) : (
                <p className={s.pWordmark}>{propertyName}</p>
              )}
              <span className={s.pChip}>Room 214</span>
            </div>
            <div className={s.pArch}>
              {coverUrl.startsWith('https://') ? (
                // eslint-disable-next-line @next/next/no-img-element -- a preview of any host the hotel pastes
                <img src={coverUrl} alt="" className={s.pCover} />
              ) : null}
              <span className={s.pGlow} aria-hidden="true" />
              <p className={s.pArchText}>Kitchen open until 1am</p>
            </div>
            <p className={s.pGreeting}>Good evening, Anjali</p>
            <div className={s.pTiles} aria-hidden="true">
              <span className={s.pTile}><Sparkles size={18} />Amenities</span>
              <span className={s.pTile}><ConciergeBell size={18} />Call for service</span>
              <span className={s.pTile}><BedDouble size={18} />Your stay</span>
              <span className={s.pTile}><Compass size={18} />Plan my day</span>
            </div>
            <span className={s.pButton}>Order in-room dining</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function SaveButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={styles.primary} disabled={disabled || pending}>
      {pending ? 'Saving…' : 'Save branding'}
    </button>
  );
}
