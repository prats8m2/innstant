'use client';

import { LogOut } from 'lucide-react';
import { useFormStatus } from 'react-dom';
import { signOut } from '@/app/(admin)/admin/actions';

/**
 * Sign out, as an icon, for the floor screens.
 *
 * A form, not a link: signing out is a mutation, and a GET that revokes a
 * session can be fired by a prefetch. The same server action as the console's
 * button — it revokes the session row, not only the cookie, which on a shared
 * kitchen tablet is the whole point.
 */
export function SignOutButton({ className }: { className?: string }) {
  return (
    <form action={signOut}>
      <Submit className={className} />
    </form>
  );
}

function Submit({ className }: { className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={className}
      disabled={pending}
      aria-label="Sign out"
      title="Sign out"
    >
      <LogOut size={18} aria-hidden="true" />
    </button>
  );
}
