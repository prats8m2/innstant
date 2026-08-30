import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { withTenant } from '@/db';
import { resolveGuestSession, GUEST_SESSION_COOKIE } from '@/modules/access';
import { getDish } from '@/modules/catalog';
import { formatMoney, money, type CurrencyCode } from '@/lib/money';
import { DishForm } from './dish-form';
import styles from './dish.module.css';

/**
 * One dish. The screen a guest actually decides on.
 *
 * Rebuilt from `design/reference/` as real components — the arch hero, the
 * modifier chips, the stepper, and the saffron bar pinned to the bottom 40%
 * where a thumb reaches (DESIGN-SPEC "Viewport").
 *
 * CLAUDE.md #9 still holds here: reading a dish and choosing modifiers needs no
 * verification. The one prompt comes at the first charge to the room, which is
 * placement — not this screen.
 */
export const dynamic = 'force-dynamic';

export default async function DishScreen({
  params,
}: {
  params: Promise<{ qrCode: string; itemId: string }>;
}) {
  const { qrCode, itemId } = await params;
  const store = await cookies();
  const session = await resolveGuestSession(store.get(GUEST_SESSION_COOKIE)?.value);

  if (!session) redirect(`/r/${encodeURIComponent(qrCode)}`);

  const detail = await withTenant(
    { tenantId: session.tenantId, propertyId: session.propertyId },
    (tx) => getDish(tx, { propertyId: session.propertyId, itemId }),
  );

  // A dish id that is not on this property's menu — a stale link, a guessed id,
  // another hotel's dish. All the same 404.
  if (!detail) notFound();

  const { dish, outlet, modifierGroups } = detail;
  const currency = dish.currency as CurrencyCode;
  const isOrderable = dish.isAvailable && outlet.isAcceptingOrders;

  return (
    <main className={styles.shell}>
      <div className={styles.hero}>
        <div className={styles.heroWash} aria-hidden="true" />
        <Link
          href={`/r/${encodeURIComponent(qrCode)}/menu`}
          className={styles.back}
          aria-label="Back to the menu"
        >
          ←
        </Link>
      </div>

      <div className={styles.body}>
        {dish.prepTimeMinutes ? (
          <p className={styles.tag}>{dish.prepTimeMinutes} minutes</p>
        ) : null}

        <h1 className={styles.name}>{dish.name}</h1>
        <p className={`${styles.price} tabular`}>
          {formatMoney(money(dish.priceMinor, currency))}
        </p>

        {dish.description ? <p className={styles.note}>{dish.description}</p> : null}

        <DishForm
          qrCode={qrCode}
          dish={{ id: dish.id, priceMinor: dish.priceMinor }}
          groups={modifierGroups}
          currency={currency}
          isOrderable={isOrderable}
        />

        <p className={styles.foot}>
          {dish.dietaryFlags.includes('VEGETARIAN') ? 'Vegetarian. ' : ''}
          {!outlet.isAcceptingOrders
            ? 'The kitchen has stopped taking orders for tonight.'
            : `Cooked to order. About ${dish.prepTimeMinutes ?? outlet.prepTimeMinutes} minutes, and it travels up covered.`}
        </p>
      </div>
    </main>
  );
}
