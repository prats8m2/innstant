import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { InnstantLogo } from '@/components/innstant-logo';
import { DEMO_NAME_COOKIE } from '@/modules/demo';
import { NameForm } from './name-form';
import styles from './demo.module.css';

/**
 * The one screen between the website and the demo room.
 *
 * ─── Why there is a screen here at all ─────────────────────────────────────
 *
 * CLAUDE.md #9 says never gate browsing behind verification, and this looks
 * like exactly that — a field in front of the product. It is not the same
 * thing, and the difference is who is on the other side.
 *
 * #9 protects a GUEST: somebody who has already paid for a room, is standing in
 * it, and is pointing their phone at a sticker. Asking them to log in before
 * they can read a menu is the thing D-012 was written to prevent, and nothing
 * on this page touches that path — `/r/{code}` is untouched.
 *
 * This is a VISITOR on a marketing site who has just clicked "See how it
 * works". They have no room, no stay and no name in anybody's PMS. The question
 * is not a gate, it is the demo: the whole point of the screen they are about
 * to see is that the hotel knows who is in the room, and it cannot show that
 * without knowing what to call them.
 *
 * It is asked ONCE, in a cookie that outlives the session behind it, and it is
 * skipped entirely on the way back.
 */
export const dynamic = 'force-dynamic';

export default async function DemoGate({
  searchParams,
}: {
  searchParams: Promise<{ unavailable?: string }>;
}) {
  const { unavailable } = await searchParams;
  const store = await cookies();

  // Already answered, and the demo is reachable — don't ask twice.
  if (!unavailable && store.get(DEMO_NAME_COOKIE)?.value) redirect('/demo/enter');

  return (
    <main className={styles.shell} data-theme="innstant">
      <div className={styles.card}>
        <Link href="/" className={styles.brand} aria-label="Innstant, home">
          {/* The dark cut: this screen's ground is --paper-deep. */}
          <InnstantLogo size={30} tone="dark" priority />
        </Link>

        {unavailable ? (
          <>
            <h1 className={styles.title}>The demo room isn’t open</h1>
            <p className={styles.body}>
              The Kesari’s demo data hasn’t been loaded into this deployment, or
              its stays have aged past their checkout. Nothing is wrong with the
              product — there is just nobody in the building.
            </p>
            {/* Named plainly, because the person who needs to read this is
                whoever deployed it, not the visitor who tripped over it. */}
            <p className={styles.hint}>
              <code>pnpm demo:reset</code> reseeds it, and <code>DEMO_TENANT_ID</code>{' '}
              points this route at the tenant it lives in.
            </p>
            <Link href="/" className={styles.secondary}>Back to the site</Link>
          </>
        ) : (
          <>
            <p className={styles.eyebrow}>The Kesari · Room 214</p>
            <h1 className={styles.title}>What should the room call you?</h1>
            <p className={styles.body}>
              You’re about to walk into a real guest’s screen at a hotel that
              doesn’t exist. Everything on it works — the menu, the kitchen, the
              runner, the bill. Only the hotel is made up.
            </p>

            <NameForm />

            <p className={styles.hint}>
              Kept on this device so you’re not asked again. It goes on the
              greeting and into a list of who tried the demo — nothing else, and
              nowhere else.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
