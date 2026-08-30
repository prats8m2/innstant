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

  return (
    <main className={styles.shell}>
      <div className={styles.card}>
        <p className={styles.eyebrow}>The Kesari</p>
        <h1 className={styles.title}>Staff sign in</h1>
        <LoginForm next={next} />
      </div>
    </main>
  );
}
