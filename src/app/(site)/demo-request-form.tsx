'use client';

import { useState } from 'react';
import styles from './site.module.css';

const ROOM_BANDS = ['Under 30', '30–80', '80–200', '200+'] as const;

const INTERESTS = [
  'In-room dining',
  'Service requests',
  'Late checkout & folio',
  'Replacing phone calls',
  'A theme in our brand',
] as const;

/**
 * The book-a-demo form.
 *
 * ─── It does not submit anywhere, and it says so ───────────────────────────
 *
 * There is no CRM, no transactional email and no `demo_requests` table behind
 * this, and adding one was explicitly out of scope for now — the only visitor
 * record this product keeps is a name in `demo_visitors`, written when somebody
 * opens the demo room.
 *
 * The honest options were to delete the form or to be plain about it. Deleting
 * it loses the page's whole closing argument; a form that accepts a property
 * name, says "thanks, we'll be in touch" and drops it on the floor is a lie
 * told to somebody who was about to become a customer. So the fields are here,
 * they work, and the button hands over an email draft instead of pretending.
 *
 * When a real endpoint exists, this becomes a Server Action with Zod at the
 * boundary like every other mutation, and the note below comes out.
 */
export function DemoRequestForm() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [property, setProperty] = useState('');
  const [city, setCity] = useState('');
  const [rooms, setRooms] = useState<string>('');
  const [interests, setInterests] = useState<string[]>([]);
  const [note, setNote] = useState('');

  const toggle = (value: string) =>
    setInterests((current) =>
      current.includes(value)
        ? current.filter((x) => x !== value)
        : [...current, value],
    );

  /**
   * Everything typed, as an email the visitor sends themselves. `mailto:` is a
   * poor form target and an honest one: it opens in their client, they can see
   * exactly what is being sent, and it cannot silently fail on our side.
   */
  const body = [
    name && `Name: ${name}`,
    property && `Property: ${property}`,
    city && `City: ${city}`,
    rooms && `Rooms: ${rooms}`,
    interests.length ? `Interested in: ${interests.join(', ')}` : '',
    note && `\n${note}`,
  ].filter(Boolean).join('\n');

  const mailto =
    `mailto:hello@innstant.in?subject=${encodeURIComponent(
      property ? `Demo request — ${property}` : 'Demo request',
    )}&body=${encodeURIComponent(body)}`;

  return (
    <form
      id="contact-form"
      className={styles.form}
      /* No action and no onSubmit: the CTA is a link, and a stray Enter in a
         text field must not reload the page and lose what they typed. */
      onSubmit={(event) => event.preventDefault()}
    >
      <div className={styles.formRow}>
        <Field label="Your name" value={name} onChange={setName} autoComplete="name" />
        <Field label="Work email" value={email} onChange={setEmail} type="email" autoComplete="email" />
      </div>
      <div className={styles.formRow}>
        <Field label="Property name" value={property} onChange={setProperty} autoComplete="organization" />
        <Field label="City" value={city} onChange={setCity} autoComplete="address-level2" />
      </div>

      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Rooms</legend>
        <div className={styles.chips}>
          {ROOM_BANDS.map((band) => (
            <button
              key={band}
              type="button"
              className={styles.chip}
              aria-pressed={rooms === band}
              onClick={() => setRooms(rooms === band ? '' : band)}
            >
              {band}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>What matters most right now</legend>
        <div className={styles.chips}>
          {INTERESTS.map((interest) => (
            <button
              key={interest}
              type="button"
              className={styles.chip}
              aria-pressed={interests.includes(interest)}
              onClick={() => toggle(interest)}
            >
              {interest}
            </button>
          ))}
        </div>
      </fieldset>

      <label className={styles.field}>
        <span className={styles.label}>Anything else</span>
        <textarea
          className={styles.textarea}
          rows={3}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>

      <a className={styles.formSubmit} href={mailto}>
        Open this as an email
      </a>

      <p className={styles.formNote}>
        This form isn’t wired to anything yet — the button opens the details in
        your own mail client so you can see exactly what’s being sent, and send
        it yourself. A reply comes from a person within one working day.
      </p>
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  autoComplete?: string;
}) {
  return (
    <label className={styles.field}>
      <span className={styles.label}>{label}</span>
      <input
        className={styles.input}
        type={type}
        value={value}
        autoComplete={autoComplete}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
