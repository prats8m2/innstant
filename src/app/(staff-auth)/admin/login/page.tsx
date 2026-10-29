import { getStaffSession } from '@/lib/auth-context';
import { SessionWatch } from '@/components/session-watch';
import { LoginForm } from './login-form';
import styles from './login.module.css';

/**
 * Sign in. The only unauthenticated page on a staff surface — the middleware
 * lets this one through, and everything else behind it is checked server-side
 * by `requirePermission()` regardless (src/middleware.ts).
 */
export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  // Signing in here while somebody is already signed in switches the whole
  // browser to the new account, every tab included — say so before it happens.
  const current = await getStaffSession();

  return (
    <main className={styles.shell}>
      <div className={styles.card}>
        <p className={styles.eyebrow}>The Kesari</p>
        <h1 className={styles.title}>Staff sign in</h1>
        {current ? (
          <p className={styles.current}>
            Signed in as <strong>{current.fullName}</strong>. Signing in here
            switches this browser, and every tab open in it, to the new account.
          </p>
        ) : null}
        <LoginForm next={next} />
        {/* Arriving here after signing out tells the other tabs; arriving
            signed in tells them nothing new. */}
        <SessionWatch staffUserId={current?.staffUserId ?? null} />
      </div>
    </main>
  );
}
