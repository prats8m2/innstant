'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import type {
  AdminMenuCategory, AdminMenuItemDetail, AdminModifierGroup, MenuDietaryFlag,
} from '@/modules/catalog';
import { formatMoney, money } from '@/lib/money';
import { saveItem, type MenuActionState } from './actions';
import styles from '../admin.module.css';

/**
 * One dish, new or existing. The same form for both — a create form that drifts
 * from its edit form is how a field ends up settable but not changeable.
 *
 * The price is a text input rather than `type="number"`: a number input renders
 * a spinner nobody wants on a price, and it accepts `1e3`. It is parsed by
 * `parseMoneyInput()` server-side, which is the only place a keyboard becomes
 * minor units (#5).
 *
 * Note that the dietary vocabulary arrives as a PROP rather than an import.
 * This is a client component, and importing a value from `@/modules/catalog`
 * pulls the module's index — and therefore `pg` — into the browser bundle. The
 * build says `Can't resolve 'net'`, which does not read like what it is. Types
 * are fine: they are erased.
 */
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function DishForm({
  propertyId,
  outletId,
  currency,
  categories,
  modifierGroups,
  dietaryFlags,
  item,
  defaultCategoryId,
}: {
  propertyId: string;
  outletId: string;
  currency: 'INR';
  categories: AdminMenuCategory[];
  modifierGroups: AdminModifierGroup[];
  /** The fixed vocabulary, from the server — see the note above. */
  dietaryFlags: readonly MenuDietaryFlag[];
  /** Absent when creating. */
  item?: AdminMenuItemDetail;
  defaultCategoryId?: string;
}) {
  const [state, action] = useActionState<MenuActionState, FormData>(saveItem, {});

  const priceDefault = item
    ? (item.priceMinor / 100).toFixed(item.priceMinor % 100 === 0 ? 0 : 2)
    : '';

  return (
    <form action={action} className={styles.dishForm}>
      <input type="hidden" name="propertyId" value={propertyId} />
      <input type="hidden" name="outletId" value={outletId} />
      {item ? <input type="hidden" name="itemId" value={item.id} /> : null}

      <div className={styles.formGrid}>
        <label className={`${styles.field} ${styles.wide}`}>
          <span className={styles.label}>Name</span>
          <input
            name="name"
            className={styles.input}
            defaultValue={item?.name ?? ''}
            required
            maxLength={120}
            placeholder="Laal maas with bajra roti"
          />
        </label>

        <label className={`${styles.field} ${styles.wide}`}>
          <span className={styles.label}>How it reads on the menu</span>
          <textarea
            name="description"
            className={styles.textarea}
            defaultValue={item?.description ?? ''}
            maxLength={600}
            rows={3}
            placeholder="Mutton, Mathania chillies, and the roti it is meant to be eaten with."
          />
          <span className={styles.hint}>
            The guest reads this under the name. Say what it is, not how good it is.
          </span>
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Section</span>
          <select
            name="categoryId"
            className={styles.input}
            defaultValue={item?.categoryId ?? defaultCategoryId ?? ''}
            required
          >
            <option value="" disabled>Pick a section</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>{category.name}</option>
            ))}
          </select>
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Price</span>
          <input
            name="price"
            className={styles.input}
            defaultValue={priceDefault}
            required
            inputMode="decimal"
            placeholder="1150"
          />
          <span className={styles.hint}>
            Rupees. {formatMoney(money(115000, currency))} is typed as 1150, and 1150.50 for paise.
          </span>
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Heat, 0–5</span>
          <input
            name="spiceLevel"
            className={styles.input}
            type="number"
            min={0}
            max={5}
            defaultValue={item?.spiceLevel ?? ''}
          />
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Minutes to cook</span>
          <input
            name="prepTimeMinutes"
            className={styles.input}
            type="number"
            min={1}
            max={240}
            defaultValue={item?.prepTimeMinutes ?? ''}
          />
          <span className={styles.hint}>Leave blank to use the kitchen&rsquo;s default.</span>
        </label>

        <label className={`${styles.field} ${styles.wide}`}>
          <span className={styles.label}>Image URL</span>
          <input
            name="imageUrl"
            className={styles.input}
            defaultValue={item?.imageUrl ?? ''}
            maxLength={500}
            placeholder="https://…"
          />
          {/*
            Honest about what is missing. Upload to R2 with an enforced aspect
            ratio and a generated blurhash is in P1's checklist and blocked on
            credentials — see docs/STATUS.md. A URL field works today and the
            column is the same one upload will write.
          */}
          <span className={styles.hint}>
            Paste a CDN URL for now — upload lands when image hosting is configured.
          </span>
        </label>
      </div>

      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>What it is made of</legend>
        <p className={styles.hint}>
          Composition, not a guest&rsquo;s allergy — a guest&rsquo;s own flags live on their
          profile and reach the kitchen on the ticket.
        </p>
        <div className={styles.checkRow}>
          {dietaryFlags.map((flag) => (
            <label key={flag} className={styles.check}>
              <input
                type="checkbox"
                name="dietaryFlags"
                value={flag}
                defaultChecked={item?.dietaryFlags.includes(flag)}
              />
              <span>{flag.replace(/_/g, ' ').toLowerCase()}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {modifierGroups.length ? (
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Choices the guest gets</legend>
          <p className={styles.hint}>
            Groups are shared across dishes — editing one changes every dish carrying it.
          </p>
          <div className={styles.checkColumn}>
            {modifierGroups.map((group) => (
              <label key={group.id} className={styles.check}>
                <input
                  type="checkbox"
                  name="modifierGroupIds"
                  value={group.id}
                  defaultChecked={item?.modifierGroupIds.includes(group.id)}
                />
                <span>
                  <span className={styles.groupName}>
                    {group.name}
                    {group.isRequired ? <em className={styles.required}> required</em> : null}
                  </span>
                  <span className={styles.groupOptions}>{group.optionNames.join(' · ')}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>When it is on</legend>
        <p className={styles.hint}>
          Leave every row blank and the dish is on whenever the kitchen is. Fill
          one in for a dish that stops — &ldquo;breakfast until 10:30&rdquo; is a row, not
          something a kitchen has to remember to switch off each morning.
        </p>

        <table className={styles.hoursTable}>
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col">From</th>
              <th scope="col">Until</th>
            </tr>
          </thead>
          <tbody>
            {[0, 1, 2].map((i) => {
              const row = item?.availabilityWindows[i];
              return (
                <tr key={i}>
                  <td>
                    <select
                      name={`windowDay-${i}`}
                      className={styles.input}
                      defaultValue={row?.dayOfWeek === null || row === undefined
                        ? ''
                        : String(row.dayOfWeek)}
                      aria-label={`Schedule row ${i + 1} day`}
                    >
                      <option value="">Every day</option>
                      {DAYS.map((day, dayOfWeek) => (
                        <option key={day} value={dayOfWeek}>{day}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      name={`windowStart-${i}`}
                      type="time"
                      className={styles.timeInput}
                      defaultValue={row?.startsAt ?? ''}
                      aria-label={`Schedule row ${i + 1} starts at`}
                    />
                  </td>
                  <td>
                    <input
                      name={`windowEnd-${i}`}
                      type="time"
                      className={styles.timeInput}
                      defaultValue={row?.endsAt ?? ''}
                      aria-label={`Schedule row ${i + 1} ends at`}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </fieldset>

      <label className={styles.check}>
        <input
          type="checkbox"
          name="isAvailable"
          defaultChecked={item ? item.isAvailable : true}
        />
        <span>On the menu tonight</span>
      </label>
      <p className={styles.hint}>
        Tonight only — this is the switch the kitchen flips when it runs out. The
        schedule above is the standing rule.
      </p>

      {state.error ? <p className={styles.formError} role="alert">{state.error}</p> : null}

      <div className={styles.formActions}>
        <SaveButton label={item ? 'Save the dish' : 'Add the dish'} />
        <Link href="/admin/menu" className={styles.secondary}>Back to the menu</Link>
      </div>
    </form>
  );
}

function SaveButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={styles.primary} disabled={pending}>
      {pending ? 'Saving…' : label}
    </button>
  );
}
