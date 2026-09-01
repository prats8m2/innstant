import { requireStaffSession } from '@/lib/auth-context';
import { can } from '@/modules/identity';
import type { Permission, StaffSession } from '@/modules/identity';
import styles from './admin.module.css';

/**
 * Who is signed in, at which property, and may they do this.
 *
 * ─── Why this is not `requirePermission()` ─────────────────────────────────
 *
 * `requirePermission()` THROWS, and a thrown `ForbiddenError` in a Server
 * Component does not become a 403 — Next has no error mapping to run there, so
 * it renders the error boundary and the browser gets a 500. A staff member
 * reading "Application error" when the truth is "your role cannot do this" is
 * both wrong and unfixable by them.
 *
 * Route handlers and Server Actions still throw and are still mapped in one
 * place (`httpStatusFor`). This is the page-level equivalent: check, and hand
 * back something to render. `/kds` and `/runner` have always done it this way;
 * this is that pattern, once.
 *
 * The server action behind every button re-checks regardless. Nothing here is
 * load-bearing for security — it decides what to draw.
 */
export type AdminAccess =
  | { ok: true; session: StaffSession; propertyId: string }
  | { ok: false; reason: 'NO_PROPERTY' | 'NOT_PERMITTED' };

export async function adminAccess(
  ...permissions: readonly Permission[]
): Promise<AdminAccess> {
  const session = await requireStaffSession();

  // A group F&B manager legitimately has several properties; the switcher is
  // still admin work, and the KDS and runner make the same placeholder choice.
  const propertyId = [...session.properties.keys()][0];
  if (!propertyId) return { ok: false, reason: 'NO_PROPERTY' };

  if (!permissions.every((permission) => can(session, propertyId, permission))) {
    return { ok: false, reason: 'NOT_PERMITTED' };
  }

  return { ok: true, session, propertyId };
}

/** What a refusal looks like: a sentence, inside the console, not a stack. */
export function AdminDenied({ reason }: { reason: 'NO_PROPERTY' | 'NOT_PERMITTED' }) {
  return (
    <div className={styles.frame}>
      <main className={styles.main}>
        <p className={styles.empty}>
          {reason === 'NO_PROPERTY'
            ? 'This account has no property assigned. Someone with staff admin can fix that.'
            : 'This account cannot change this. Ask whoever manages roles at this property.'}
        </p>
      </main>
    </div>
  );
}
