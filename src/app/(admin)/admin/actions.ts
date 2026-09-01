'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revokeStaffSession, STAFF_SESSION_COOKIE } from '@/modules/identity';

/**
 * Sign out.
 *
 * The database row IS the session, so this revokes it rather than only dropping
 * the cookie — a cookie copied off a shared tablet keeps working otherwise, and
 * a shared tablet is exactly what this product runs on.
 */
export async function signOut(): Promise<void> {
  const store = await cookies();
  await revokeStaffSession(store.get(STAFF_SESSION_COOKIE)?.value);
  store.delete(STAFF_SESSION_COOKIE);
  redirect('/admin/login');
}
