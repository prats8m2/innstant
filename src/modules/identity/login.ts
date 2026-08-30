import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { withTenant, recordEvent, type Tx } from '@/db';
import { staffUsers } from '@/db/schema/identity';
import { UnauthenticatedError, ValidationError } from '@/lib/errors';
import { verifyPassword, hashPassword } from './password';
import { createStaffSession, type IssuedSession } from './sessions';

/** Zod at the boundary; the service below takes parsed types only. */
export const loginInputSchema = z.object({
  tenantSlug: z.string().min(1).max(64),
  email: z.string().email().max(320).toLowerCase().trim(),
  password: z.string().min(1).max(1024),
});
export type LoginInput = z.infer<typeof loginInputSchema>;

/**
 * A hash of a password nobody has, computed once. Used to burn the same CPU on
 * a missing account as on a real one, so response time does not reveal which
 * emails exist. Without it, login is a free user-enumeration oracle.
 */
let decoyHashPromise: Promise<string> | undefined;
function decoyHash(): Promise<string> {
  decoyHashPromise ??= hashPassword('decoy-password-that-nobody-uses-000');
  return decoyHashPromise;
}

export interface LoginContext {
  tenantId: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Email + password login. S5 — no reset flow, no invite flow yet.
 *
 * Every failure returns the same error and takes roughly the same time: a
 * distinct "no such user" would let anyone enumerate a hotel's staff list, and
 * staff emails are usually firstname@thehotel.com.
 */
export async function login(input: LoginInput, ctx: LoginContext): Promise<IssuedSession> {
  if (!input.email || !input.password) {
    throw new ValidationError('Enter your email and password.');
  }

  return withTenant({ tenantId: ctx.tenantId }, async (tx) => {
    const rows = await tx
      .select({
        id: staffUsers.id,
        passwordHash: staffUsers.passwordHash,
        status: staffUsers.status,
      })
      .from(staffUsers)
      .where(and(eq(staffUsers.tenantId, ctx.tenantId), eq(staffUsers.email, input.email)))
      .limit(1);

    const user = rows[0];

    // Always verify against SOMETHING, so timing does not distinguish a missing
    // account from a wrong password.
    const stored = user?.passwordHash ?? (await decoyHash());
    const passwordOk = await verifyPassword(input.password, stored);

    if (!user || !passwordOk || user.status !== 'ACTIVE') {
      throw new UnauthenticatedError('Check your email and password and try again.', {
        email: input.email,
        reason: !user ? 'no_user' : !passwordOk ? 'bad_password' : 'inactive',
      });
    }

    const session = await createStaffSession(tx, {
      tenantId: ctx.tenantId,
      staffUserId: user.id,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    await tx.update(staffUsers).set({ lastLoginAt: new Date() }).where(eq(staffUsers.id, user.id));

    await recordEvent(tx, {
      tenantId: ctx.tenantId,
      entityType: 'staff_user',
      entityId: user.id,
      eventType: 'staff.logged_in',
      actor: { kind: 'STAFF', staffUserId: user.id },
      payload: { ip: ctx.ipAddress ?? null },
    });

    return session;
  });
}

/**
 * The public error message is identical for every failure above. This exists so
 * a caller cannot accidentally surface the `reason` in `context`, which is for
 * the log only.
 */
export const LOGIN_FAILED_MESSAGE = 'Check your email and password and try again.';

export async function setStaffPassword(
  tx: Tx, staffUserId: string, plaintext: string,
): Promise<void> {
  const passwordHash = await hashPassword(plaintext);
  await tx.update(staffUsers)
    .set({ passwordHash, status: 'ACTIVE' })
    .where(eq(staffUsers.id, staffUserId));
}
