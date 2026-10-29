'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import type { GuestInfo } from '@/modules/identity/guest-info';
import { brandingStyle, type PropertyBranding } from '@/modules/identity/branding';
import { HotelInfo } from '@/app/(guest)/_brand/hotel-info';
import { saveGuestInfo, type PropertyState } from './actions';
import styles from '../admin.module.css';
import s from './settings.module.css';

type Field = keyof GuestInfo;

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * What a guest would otherwise ring the desk for (D-087): how to reach a
 * person, when to arrive and leave, and the wifi.
 *
 * Beside the form, the guest's own card — the real `HotelInfo` component,
 * themed as the guest app is — filling in as you type. A blank field is a row
 * the guest simply does not see, and the preview shows that too.
 */
export function GuestInfoForm({
  propertyId,
  info,
  branding,
  mayEdit,
}: {
  propertyId: string;
  info: GuestInfo;
  /** So the preview wears the hotel's own accent, as the guest's card does. */
  branding: PropertyBranding;
  mayEdit: boolean;
}) {
  const [state, action] = useActionState<PropertyState, FormData>(saveGuestInfo, {});
  const [values, setValues] = useState<Record<Field, string>>(() => ({
    contactPhone: info.contactPhone ?? '',
    contactWhatsapp: info.contactWhatsapp ?? '',
    contactEmail: info.contactEmail ?? '',
    addressLine: info.addressLine ?? '',
    city: info.city ?? '',
    checkInTime: info.checkInTime ?? '',
    checkOutTime: info.checkOutTime ?? '',
    wifiNetwork: info.wifiNetwork ?? '',
    wifiPassword: info.wifiPassword ?? '',
  }));

  const dirty = (Object.keys(values) as Field[]).some((key) => values[key] !== (info[key] ?? ''));

  const input = (name: Field, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input
      name={name}
      className={styles.input}
      value={values[name]}
      onChange={(event) => setValues((previous) => ({ ...previous, [name]: event.target.value }))}
      {...props}
    />
  );

  /** The preview only shows what would pass: a half-typed time is not a row yet. */
  const preview: GuestInfo = {
    contactPhone: /\d{6,}/.test(values.contactPhone.replace(/\D/g, '')) ? values.contactPhone : null,
    contactWhatsapp: /\d{6,}/.test(values.contactWhatsapp.replace(/\D/g, '')) ? values.contactWhatsapp : null,
    contactEmail: values.contactEmail.includes('@') ? values.contactEmail : null,
    addressLine: values.addressLine || null,
    city: values.city || null,
    checkInTime: TIME.test(values.checkInTime) ? values.checkInTime : null,
    checkOutTime: TIME.test(values.checkOutTime) ? values.checkOutTime : null,
    wifiNetwork: values.wifiNetwork || null,
    wifiPassword: values.wifiPassword || null,
  };

  return (
    <div className={s.brandGrid}>
      <section className={styles.section}>
        <header className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Guest info</h2>
          <p className={styles.sectionBlurb}>
            Shown on the guest&rsquo;s Stay screen. Leave a field blank and the guest does not see that row.
          </p>
        </header>

        <form action={action}>
          <input type="hidden" name="propertyId" value={propertyId} />

          <fieldset disabled={!mayEdit} className={`${s.formSection} ${s.fieldset}`}>
            <h3 className={s.formSectionTitle}>Reaching the hotel</h3>
            <div className={styles.formGrid}>
              <label className={styles.field}>
                <span className={styles.label}>Front desk phone</span>
                {input('contactPhone', { type: 'tel', placeholder: '+91 294 242 0000', autoComplete: 'off' })}
                <span className={styles.hint}>A guest taps it to call.</span>
              </label>
              <label className={styles.field}>
                <span className={styles.label}>WhatsApp</span>
                {input('contactWhatsapp', { type: 'tel', placeholder: '+91 98290 00000', autoComplete: 'off' })}
                <span className={styles.hint}>With the country code. Opens a chat.</span>
              </label>
              <label className={`${styles.field} ${styles.wide}`}>
                <span className={styles.label}>Email</span>
                {input('contactEmail', { type: 'email', placeholder: 'desk@thekesari.example', autoComplete: 'off' })}
              </label>
              <label className={`${styles.field} ${styles.wide}`}>
                <span className={styles.label}>Address</span>
                {input('addressLine', { placeholder: 'Lal Ghat, near Jagdish Chowk', maxLength: 200 })}
              </label>
              <label className={styles.field}>
                <span className={styles.label}>City</span>
                {input('city', { placeholder: 'Udaipur', maxLength: 80 })}
              </label>
            </div>
          </fieldset>

          <fieldset disabled={!mayEdit} className={`${s.formSection} ${s.fieldset}`}>
            <h3 className={s.formSectionTitle}>Arriving and leaving</h3>
            <div className={styles.formGrid}>
              <label className={styles.field}>
                <span className={styles.label}>Check-in from</span>
                {input('checkInTime', { type: 'time' })}
              </label>
              <label className={styles.field}>
                <span className={styles.label}>Check-out by</span>
                {input('checkOutTime', { type: 'time' })}
                <span className={styles.hint}>The standard time. A stay&rsquo;s own checkout still wins for that guest.</span>
              </label>
            </div>
          </fieldset>

          <fieldset disabled={!mayEdit} className={`${s.formSection} ${s.fieldset}`}>
            <h3 className={s.formSectionTitle}>Wi-Fi</h3>
            <div className={styles.formGrid}>
              <label className={styles.field}>
                <span className={styles.label}>Network</span>
                {input('wifiNetwork', { placeholder: 'Kesari Guest', maxLength: 64, autoComplete: 'off' })}
              </label>
              <label className={styles.field}>
                <span className={styles.label}>Password</span>
                {input('wifiPassword', { maxLength: 128, autoComplete: 'off', spellCheck: false })}
                <span className={styles.hint}>Shown to guests in a room only — never on a table or counter link.</span>
              </label>
            </div>
          </fieldset>

          <div className={s.saveBar} data-dirty={dirty}>
            <span className={s.dirtyNote}>
              {!mayEdit
                ? 'Only a property admin can change these.'
                : dirty ? 'Not saved yet.' : null}
            </span>
            {state.error ? <span className={styles.inlineError} role="alert">{state.error}</span> : null}
            {state.done && !dirty ? <span className={styles.inlineDone}>{state.done}</span> : null}
            {mayEdit ? <SaveButton disabled={!dirty} /> : null}
          </div>
        </form>
      </section>

      <div className={s.previewWrap}>
        <p className={s.previewLabel}>On the guest&rsquo;s Stay screen</p>
        <div className={s.phone} data-theme="kesari" style={brandingStyle(branding) as React.CSSProperties}>
          <div className={s.phoneScreen}>
            <HotelInfo info={preview} showWifiPassword />
            {Object.values(preview).every((v) => !v) ? (
              <p className={styles.hint}>Nothing filled in yet, so the guest sees nothing here.</p>
            ) : null}
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
      {pending ? 'Saving…' : 'Save guest info'}
    </button>
  );
}
