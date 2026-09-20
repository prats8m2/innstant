'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { GUEST_SESSION_COOKIE, QrNotUsableError } from '@/modules/access';
import {
  cleanVisitorName, recordDemoVisitor, resolveDemoRoomCode, openDemoSession,
  DEMO_NAME_COOKIE, DEMO_FLAG_COOKIE, DEMO_COOKIE_DAYS,
} from '@/modules/demo';

/**
 * The one thing the demo asks for before it opens.
 *
 * Zod at the boundary like every other action (CLAUDE.md), though the shape is
 * about as small as a boundary gets.
 */
const nameSchema = z.object({
  name: z.string().trim().min(1, 'A name — even just the first one.').max(60),
});

export interface DemoNameState {
  error?: string;
}

/**
 * ─── Why this does the whole job rather than redirecting to /demo/enter ────
 *
 * The first version ended with `redirect('/demo/enter')` and the form silently
 * did nothing: a Server Action's redirect is followed by the CLIENT router,
 * and the App Router cannot navigate to a Route Handler — there is no page to
 * render at the other end, so it resolves to nothing at all and the visitor is
 * left looking at the form they just submitted.
 *
 * A Server Action can set cookies, which is the only reason `/demo/enter`
 * exists as a handler in the first place. So this opens the session itself and
 * redirects to the guest home, which IS a page.
 *
 * `/demo/enter` stays, and is still reached — by the returning visitor whose
 * name cookie is already set. That path is a server-side 307 from `/demo`,
 * which the browser follows before any router is involved.
 */
export async function enterDemo(
  _state: DemoNameState,
  form: FormData,
): Promise<DemoNameState> {
  const parsed = nameSchema.safeParse({ name: form.get('name') });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'A name — even just the first one.' };
  }

  const name = cleanVisitorName(parsed.data.name);
  if (!name) return { error: 'A name — even just the first one.' };

  const code = await resolveDemoRoomCode();
  if (!code) {
    return {
      error:
        'The demo room isn’t open right now — its data hasn’t been loaded into ' +
        'this deployment. Nothing is wrong with what you typed.',
    };
  }

  const head = await headers();

  /**
   * The guest book is written first, and its failure is swallowed inside
   * `recordDemoVisitor()`. Somebody who clicked "See how it works" is owed the
   * demo; they are not owed an error page because a table this product could
   * lose entirely was briefly unreachable.
   */
  await recordDemoVisitor({
    name,
    roomNumber: null,
    userAgent: head.get('user-agent'),
  });

  let home: string;
  let cookieValue: string;
  let expiresAt: Date;

  try {
    const demo = await openDemoSession(code, {
      ipAddress: head.get('x-forwarded-for')?.split(',')[0]?.trim(),
      userAgent: head.get('user-agent') ?? undefined,
    });
    home = demo.home;
    cookieValue = demo.cookieValue;
    expiresAt = demo.session.expiresAt;
  } catch (error) {
    // The seeded stay has aged past its checkout window. `pnpm demo:reset` is
    // the fix, and the visitor should be told it is not their fault.
    if (error instanceof QrNotUsableError) {
      return {
        error:
          'The demo room isn’t open right now — its seeded stay has ended. ' +
          'Nothing is wrong with what you typed.',
      };
    }
    throw error;
  }

  const store = await cookies();
  const base = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  };

  store.set(GUEST_SESSION_COOKIE, cookieValue, { ...base, expires: expiresAt });

  // Both of these outlive the guest session on purpose: together they are what
  // stops the name being asked for again next week, after the session behind
  // them has lapsed and the visitor has to rescan.
  store.set(DEMO_NAME_COOKIE, name, { ...base, maxAge: DEMO_COOKIE_DAYS * 24 * 60 * 60 });
  store.set(DEMO_FLAG_COOKIE, '1', { ...base, maxAge: DEMO_COOKIE_DAYS * 24 * 60 * 60 });

  redirect(home);
}
