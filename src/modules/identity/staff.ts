import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { recordEvent, type Tx } from '@/db';
import {
  staffUsers, staffInvites, staffPropertyRoles, roles,
} from '@/db/schema/identity';
import { issueToken, hashToken } from '@/lib/tokens';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { hashPassword } from './password';
import { revokeAllSessionsFor } from './sessions';

/**
 * Staff, and the roles they hold at a property.
 *
 * P3.5. `provisionProperty()` has created exactly one PROPERTY_ADMIN as INVITED
 * with `password_hash` NULL since P0, and S5 never built the flow that fills it
 * in — so a hotel's second staff member was a seeder run, and `staff:invite`,
 * `staff:update`, `staff:deactivate` and `role:assign` have been declared
 * permissions with no caller anywhere.
 *
 * ─── The invariant this file exists to protect ─────────────────────────────
 *
 * A property must never be left with no active PROPERTY_ADMIN. Everything here
 * is guarded by `assertNotTheLastAdmin()`, because the alternative is a hotel
 * that locks itself out of its own console on a Tuesday afternoon and has no
 * route back that does not involve us and a database.
 */

const INVITE_TTL_HOURS = 72;

/* ── Reading ────────────────────────────────────────────────────────────── */

export interface StaffMember {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  status: string;
  lastLoginAt: Date | null;
  /** Role keys held AT THIS PROPERTY. Empty means they can sign in and see nothing. */
  roleKeys: string[];
  /** True while an unaccepted, unexpired, unrevoked invite exists. */
  inviteLive: boolean;
}

/**
 * Everybody who holds a role at this property, plus anyone invited to it.
 *
 * `staff_users` is tenant-scoped and `staff_property_roles` is what makes
 * someone staff HERE — a group F&B manager holds roles at three hotels and
 * belongs on three screens. Someone with no role at this property is not listed,
 * because they are another hotel's problem; the exception is a live invite,
 * which is how somebody appears before they have accepted anything.
 */
export async function listStaffAtProperty(
  tx: Tx,
  input: { propertyId: string },
): Promise<StaffMember[]> {
  /**
   * Raw SQL for the two aggregates. The alternative is three round trips and an
   * assembly in memory, and this is a single narrow read inside the tenant
   * transaction — the same projection shape `listRolesAtProperty()` takes.
   */
  const rows = await tx.execute<{
    id: string; email: string; full_name: string; phone: string | null;
    // A raw `execute` hands timestamps back unparsed, so this is whatever the
    // driver gave us and is re-wrapped below — the same thing `scanQrCode()`
    // does with `scheduled_checkout_at`. Typing it as a Date here and passing it
    // straight to `Intl` is how this screen threw "Invalid time value".
    status: string; last_login_at: string | Date | null;
    role_keys: string[] | null; invite_live: boolean;
  }>(sql`
    SELECT su.id, su.email, su.full_name, su.phone, su.status, su.last_login_at,
           array_remove(array_agg(DISTINCT r.key), NULL) AS role_keys,
           bool_or(
             si.id IS NOT NULL
             AND si.accepted_at IS NULL
             AND si.revoked_at IS NULL
             AND si.expires_at > now()
           ) AS invite_live
    FROM staff_users su
    LEFT JOIN staff_property_roles spr
      ON spr.staff_user_id = su.id AND spr.property_id = ${input.propertyId}
    LEFT JOIN roles r ON r.id = spr.role_id
    LEFT JOIN staff_invites si
      ON si.staff_user_id = su.id AND si.property_id = ${input.propertyId}
    WHERE spr.id IS NOT NULL OR si.id IS NOT NULL
    GROUP BY su.id, su.email, su.full_name, su.phone, su.status, su.last_login_at
    ORDER BY su.full_name
  `);

  return rows.rows.map((row) => ({
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    phone: row.phone,
    status: row.status,
    lastLoginAt: asDate(row.last_login_at),
    roleKeys: row.role_keys ?? [],
    inviteLive: Boolean(row.invite_live),
  }));
}

/* ── Inviting ───────────────────────────────────────────────────────────── */

export interface InviteInput {
  tenantId: string;
  propertyId: string;
  email: string;
  fullName: string;
  phone?: string | null;
  /** A system role key — PROPERTY_ADMIN, FRONT_DESK, KITCHEN and so on. */
  roleKey: string;
  staffUserId: string;
}

export interface IssuedInvite {
  staffUserId: string;
  /**
   * The plaintext token, which exists ONLY in this return value. Only its
   * SHA-256 is stored (#10), so a manager who loses the link issues another
   * rather than recovering this one.
   */
  token: string;
  expiresAt: Date;
  /** True when the row already existed — a rehire, or a second property. */
  rejoined: boolean;
}

/**
 * Invite somebody, or add an existing colleague to this property.
 *
 * ─── Why the same function does both ───────────────────────────────────────
 *
 * `staff_users_tenant_email_uq` makes an email one account per TENANT, and that
 * is deliberate (D-006): a group with six hotels is one tenant, and its F&B
 * manager is one person with roles at three of them, not three logins. So
 * "invite anita@ to this property" is a new row the first time and a new
 * `staff_property_roles` grant every time after — and a screen that offered two
 * different buttons for those would need the manager to know which, when the
 * answer lives in a table they cannot see.
 */
export async function inviteStaff(
  tx: Tx,
  input: InviteInput,
): Promise<IssuedInvite> {
  const email = cleanEmail(input.email);
  const fullName = cleanName(input.fullName);
  const role = await findRole(tx, { tenantId: input.tenantId, propertyId: input.propertyId, key: input.roleKey });

  const existing = await tx.select({
    id: staffUsers.id, status: staffUsers.status, passwordHash: staffUsers.passwordHash,
  }).from(staffUsers)
    .where(and(eq(staffUsers.tenantId, input.tenantId), eq(staffUsers.email, email)))
    .limit(1);

  let staffUserId = existing[0]?.id;
  const rejoined = Boolean(staffUserId);

  if (!staffUserId) {
    const [created] = await tx.insert(staffUsers).values({
      tenantId: input.tenantId,
      email,
      fullName,
      phone: input.phone?.trim() || null,
      // No password. The invite is what sets one, and until it is accepted
      // `login()` refuses because the status is not ACTIVE.
      passwordHash: null,
      status: 'INVITED',
    }).returning({ id: staffUsers.id });
    staffUserId = created!.id;
  } else if (existing[0]!.status === 'DISABLED') {
    // A rehire. Back to INVITED rather than straight to ACTIVE: their old
    // password was revoked with them, and the new link is how they get one.
    await tx.update(staffUsers)
      .set({ status: 'INVITED', passwordHash: null, updatedAt: new Date() })
      .where(eq(staffUsers.id, staffUserId));
  }

  await grantRole(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    staffUserId,
    roleId: role.id,
  });

  /**
   * An already-ACTIVE colleague gaining a second property needs no invite —
   * they have a password and can already sign in. Minting one would put a live
   * credential-setting link in a chat window for no reason.
   */
  const needsInvite = !existing[0] || existing[0].status !== 'ACTIVE';

  const { token, tokenHash } = issueToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 3_600_000);

  if (needsInvite) {
    // Revoke first: `staff_invites_one_live_per_staff` allows exactly one live
    // row, and re-inviting has to mean the newest link is the only one that
    // works — otherwise revoking the link a manager can see leaves an older one
    // alive, which is the opposite of what they just did.
    await revokeLiveInvites(tx, staffUserId);

    await tx.insert(staffInvites).values({
      tenantId: input.tenantId,
      propertyId: input.propertyId,
      staffUserId,
      tokenHash,
      invitedByStaffId: input.staffUserId,
      expiresAt,
    });
  }

  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'staff_user',
    entityId: staffUserId,
    eventType: rejoined ? 'staff.role_granted' : 'staff.invited',
    actor: { kind: 'STAFF', staffUserId: input.staffUserId },
    // The token is never logged — `event_log` is readable by anything holding
    // `audit:read`, and this one sets a password.
    payload: { email, roleKey: role.key, invited: needsInvite },
  });

  return { staffUserId, token: needsInvite ? token : '', expiresAt, rejoined };
}

/** A fresh link for somebody who lost theirs, or whose 72 hours ran out. */
export async function reissueInvite(
  tx: Tx,
  input: { tenantId: string; propertyId: string; targetStaffId: string; staffUserId: string },
): Promise<{ token: string; expiresAt: Date }> {
  const target = await requireStaffAtProperty(tx, input);
  if (target.status === 'ACTIVE') {
    throw new ConflictError(`${target.fullName} already has a password. Nothing to send.`);
  }

  await revokeLiveInvites(tx, input.targetStaffId);

  const { token, tokenHash } = issueToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 3_600_000);

  await tx.insert(staffInvites).values({
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    staffUserId: input.targetStaffId,
    tokenHash,
    invitedByStaffId: input.staffUserId,
    expiresAt,
  });

  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'staff_user',
    entityId: input.targetStaffId,
    eventType: 'staff.invite_reissued',
    actor: { kind: 'STAFF', staffUserId: input.staffUserId },
    payload: { email: target.email },
  });

  return { token, expiresAt };
}

export interface InviteDetails {
  staffUserId: string;
  fullName: string;
  email: string;
  propertyId: string;
}

/**
 * Read an invite token without accepting it, so the page can greet the person
 * by name and say which hotel they are joining.
 *
 * Returns null for every failure — unknown, expired, revoked, already accepted.
 * One answer, like `QrNotUsableError`: somebody probing this endpoint learns
 * nothing from which, and the person holding a real link needs the same
 * instruction either way, which is to ask for a new one.
 */
export async function describeInvite(
  tx: Tx,
  token: string,
): Promise<InviteDetails | null> {
  const found = await liveInviteFor(tx, token);
  if (!found) return null;

  const user = await tx.select({ fullName: staffUsers.fullName, email: staffUsers.email })
    .from(staffUsers).where(eq(staffUsers.id, found.staffUserId)).limit(1);
  if (!user[0]) return null;

  return {
    staffUserId: found.staffUserId,
    fullName: user[0].fullName,
    email: user[0].email,
    propertyId: found.propertyId,
  };
}

/**
 * Accept it: set the password, become ACTIVE, and burn the token.
 *
 * All in one transaction. A password written without `accepted_at` being set
 * leaves a live link that can set it again, which is a credential reset anybody
 * holding the old chat message can perform.
 */
export async function acceptInvite(
  tx: Tx,
  input: { tenantId: string; token: string; password: string },
): Promise<{ staffUserId: string }> {
  const found = await liveInviteFor(tx, input.token);
  if (!found) {
    throw new NotFoundError('That link has expired or has already been used. Ask for a new one.');
  }

  // `hashPassword()` enforces the 12-character floor and says so itself.
  const passwordHash = await hashPassword(input.password);
  const now = new Date();

  await tx.update(staffUsers)
    .set({ passwordHash, status: 'ACTIVE', updatedAt: now })
    .where(eq(staffUsers.id, found.staffUserId));

  await tx.update(staffInvites)
    .set({ acceptedAt: now })
    .where(eq(staffInvites.id, found.id));

  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: found.propertyId,
    entityType: 'staff_user',
    entityId: found.staffUserId,
    eventType: 'staff.invite_accepted',
    // Themselves. Nobody else is in this transaction, and attributing it to the
    // manager who sent the link would make the audit trail say they set
    // somebody else's password.
    actor: { kind: 'STAFF', staffUserId: found.staffUserId },
    payload: {},
  });

  return { staffUserId: found.staffUserId };
}

/* ── Editing ────────────────────────────────────────────────────────────── */

export async function updateStaff(
  tx: Tx,
  input: {
    tenantId: string; propertyId: string; targetStaffId: string;
    fullName: string; phone?: string | null; staffUserId: string;
  },
): Promise<void> {
  const fullName = cleanName(input.fullName);
  const previous = await requireStaffAtProperty(tx, input);
  const phone = input.phone?.trim() || null;

  if (previous.fullName === fullName && previous.phone === phone) return;

  await tx.update(staffUsers)
    .set({ fullName, phone, updatedAt: new Date() })
    .where(eq(staffUsers.id, input.targetStaffId));

  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'staff_user',
    entityId: input.targetStaffId,
    eventType: 'staff.updated',
    actor: { kind: 'STAFF', staffUserId: input.staffUserId },
    payload: { fullName },
  });
}

/**
 * Turn somebody off.
 *
 * Three things in one transaction, and the third is the one that matters:
 * status DISABLED, every session revoked, and their roles at this property
 * left in place. The roles stay because a disabled account cannot sign in at
 * all — `login()` requires ACTIVE — so removing them would lose the record of
 * what they did and make a rehire a rebuild.
 *
 * Revoking the sessions is not optional. A staff session lives for its TTL, so
 * a deactivation that only flipped the status would leave the kitchen screen
 * they are still logged into working until the cookie aged out.
 */
export async function deactivateStaff(
  tx: Tx,
  input: { tenantId: string; propertyId: string; targetStaffId: string; staffUserId: string },
): Promise<{ fullName: string }> {
  const target = await requireStaffAtProperty(tx, input);
  if (target.status === 'DISABLED') {
    throw new ConflictError(`${target.fullName} is already switched off.`);
  }

  // Yourself is the fastest way to lock a hotel out, and the person doing it is
  // by definition the one who cannot then undo it.
  if (input.targetStaffId === input.staffUserId) {
    throw new ConflictError('You cannot switch off your own account.');
  }

  await assertNotTheLastAdmin(tx, input);

  await tx.update(staffUsers)
    .set({ status: 'DISABLED', updatedAt: new Date() })
    .where(eq(staffUsers.id, input.targetStaffId));

  await revokeAllSessionsFor(tx, input.targetStaffId);
  await revokeLiveInvites(tx, input.targetStaffId);

  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'staff_user',
    entityId: input.targetStaffId,
    eventType: 'staff.deactivated',
    actor: { kind: 'STAFF', staffUserId: input.staffUserId },
    payload: { email: target.email },
  });

  return { fullName: target.fullName };
}

/** Back on. They still need a password — the invite link is how (D-044). */
export async function reactivateStaff(
  tx: Tx,
  input: { tenantId: string; propertyId: string; targetStaffId: string; staffUserId: string },
): Promise<{ needsInvite: boolean }> {
  const target = await requireStaffAtProperty(tx, input);
  if (target.status !== 'DISABLED') {
    throw new ConflictError(`${target.fullName} is not switched off.`);
  }

  // INVITED, not ACTIVE: `deactivateStaff()` left the password hash alone, and
  // handing an old password back to somebody who was walked out of the building
  // is not a decision a Reactivate button should make silently.
  await tx.update(staffUsers)
    .set({ status: 'INVITED', passwordHash: null, updatedAt: new Date() })
    .where(eq(staffUsers.id, input.targetStaffId));

  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'staff_user',
    entityId: input.targetStaffId,
    eventType: 'staff.reactivated',
    actor: { kind: 'STAFF', staffUserId: input.staffUserId },
    payload: { email: target.email },
  });

  return { needsInvite: true };
}

/* ── Roles ──────────────────────────────────────────────────────────────── */

export async function assignRole(
  tx: Tx,
  input: {
    tenantId: string; propertyId: string; targetStaffId: string;
    roleKey: string; staffUserId: string;
  },
): Promise<void> {
  const target = await requireStaffAtProperty(tx, input);
  const role = await findRole(tx, { ...input, key: input.roleKey });

  const granted = await grantRole(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    staffUserId: input.targetStaffId,
    roleId: role.id,
  });
  if (!granted) throw new ConflictError(`${target.fullName} already has that role here.`);

  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'staff_user',
    entityId: input.targetStaffId,
    eventType: 'staff.role_granted',
    actor: { kind: 'STAFF', staffUserId: input.staffUserId },
    payload: { roleKey: role.key },
  });
}

/**
 * Take a role away.
 *
 * Refused when it is the property's last active PROPERTY_ADMIN, and refused when
 * it is their only role here: an account with no role at a property can sign in,
 * see a console with nothing in it, and gives nobody any clue why. Deactivating
 * is the honest way to stop somebody working here.
 */
export async function revokeRole(
  tx: Tx,
  input: {
    tenantId: string; propertyId: string; targetStaffId: string;
    roleKey: string; staffUserId: string;
  },
): Promise<void> {
  const target = await requireStaffAtProperty(tx, input);
  const role = await findRole(tx, { ...input, key: input.roleKey });

  const held = await tx.select({ id: staffPropertyRoles.id, roleId: staffPropertyRoles.roleId })
    .from(staffPropertyRoles)
    .where(and(
      eq(staffPropertyRoles.staffUserId, input.targetStaffId),
      eq(staffPropertyRoles.propertyId, input.propertyId),
    ));

  const row = held.find((r) => r.roleId === role.id);
  if (!row) throw new ConflictError(`${target.fullName} does not have that role here.`);

  if (held.length === 1) {
    throw new ConflictError(
      `That is ${target.fullName}'s only role here. Give them another one first, or switch the account off.`,
    );
  }

  if (role.key === 'PROPERTY_ADMIN') await assertNotTheLastAdmin(tx, input);

  await tx.delete(staffPropertyRoles).where(eq(staffPropertyRoles.id, row.id));

  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'staff_user',
    entityId: input.targetStaffId,
    eventType: 'staff.role_revoked',
    actor: { kind: 'STAFF', staffUserId: input.staffUserId },
    payload: { roleKey: role.key },
  });
}

/* ── Shared ─────────────────────────────────────────────────────────────── */

/**
 * The invariant the whole file exists for: a property is never left without an
 * active PROPERTY_ADMIN.
 *
 * Counted EXCLUDING the person being changed, and excluding anyone DISABLED —
 * an INVITED admin counts, because they hold the role and a link that makes them
 * able to use it, which is the same reasoning `listRolesAtProperty()` gives for
 * counting them in the rota.
 *
 * Without this a hotel locks itself out of its own console on a Tuesday
 * afternoon, with no route back that does not involve us and a database prompt.
 */
async function assertNotTheLastAdmin(
  tx: Tx,
  input: { propertyId: string; targetStaffId: string },
): Promise<void> {
  const others = await tx.execute<{ n: number }>(sql`
    SELECT count(DISTINCT su.id)::int AS n
    FROM staff_property_roles spr
    JOIN roles r       ON r.id = spr.role_id AND r.key = 'PROPERTY_ADMIN'
    JOIN staff_users su ON su.id = spr.staff_user_id AND su.status <> 'DISABLED'
    WHERE spr.property_id = ${input.propertyId}
      AND spr.staff_user_id <> ${input.targetStaffId}
  `);

  if (Number(others.rows[0]?.n ?? 0) === 0) {
    throw new ConflictError(
      'This is the only property admin here. Give somebody else that role first, '
      + 'or nobody will be able to manage this hotel.',
    );
  }
}

async function findRole(
  tx: Tx,
  input: { tenantId: string; propertyId: string; key: string },
): Promise<{ id: string; key: string }> {
  // Tenant-wide system roles and this property's own custom ones both, which is
  // exactly what `roles_tenant_property_key_uq` allows.
  const found = await tx.select({ id: roles.id, key: roles.key, propertyId: roles.propertyId })
    .from(roles)
    .where(and(eq(roles.tenantId, input.tenantId), eq(roles.key, input.key)))
    .orderBy(asc(roles.propertyId));

  const role = found.find((r) => r.propertyId === null || r.propertyId === input.propertyId);
  if (!role) throw new ValidationError('Pick a role that exists here.');
  return { id: role.id, key: role.key };
}

/** Returns false when they already had it — the unique index decides, not a read. */
async function grantRole(
  tx: Tx,
  input: { tenantId: string; propertyId: string; staffUserId: string; roleId: string },
): Promise<boolean> {
  const inserted = await tx.insert(staffPropertyRoles).values({
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    staffUserId: input.staffUserId,
    roleId: input.roleId,
  }).onConflictDoNothing().returning({ id: staffPropertyRoles.id });

  return inserted.length > 0;
}

/**
 * Scoped to the property as well as the tenant, so a staff id from a sister
 * hotel reads as a typo rather than as a permission error — the same reasoning
 * `findRoomAtProperty()` gives, and the same reason `src/lib/errors.ts` prefers
 * NotFoundError to ForbiddenError for a resource somebody cannot see.
 */
async function requireStaffAtProperty(
  tx: Tx,
  input: { propertyId: string; targetStaffId: string },
): Promise<{ id: string; email: string; fullName: string; phone: string | null; status: string }> {
  const found = await tx.select({
    id: staffUsers.id,
    email: staffUsers.email,
    fullName: staffUsers.fullName,
    phone: staffUsers.phone,
    status: staffUsers.status,
  }).from(staffUsers)
    .innerJoin(staffPropertyRoles, eq(staffPropertyRoles.staffUserId, staffUsers.id))
    .where(and(
      eq(staffUsers.id, input.targetStaffId),
      eq(staffPropertyRoles.propertyId, input.propertyId),
    ))
    .limit(1);

  if (!found[0]) throw new NotFoundError('No such staff member at this property.');
  return found[0];
}

async function revokeLiveInvites(tx: Tx, staffUserId: string): Promise<void> {
  await tx.update(staffInvites)
    .set({ revokedAt: new Date() })
    .where(and(
      eq(staffInvites.staffUserId, staffUserId),
      isNull(staffInvites.acceptedAt),
      isNull(staffInvites.revokedAt),
    ));
}

async function liveInviteFor(
  tx: Tx,
  token: string,
): Promise<{ id: string; staffUserId: string; propertyId: string } | null> {
  // Shape check before touching the database — this URL is handed around in
  // chat windows and will be probed.
  if (!token || token.length > 128 || !/^[A-Za-z0-9_-]+$/.test(token)) return null;

  const rows = await tx.select({
    id: staffInvites.id,
    staffUserId: staffInvites.staffUserId,
    propertyId: staffInvites.propertyId,
    expiresAt: staffInvites.expiresAt,
  }).from(staffInvites)
    .where(and(
      eq(staffInvites.tokenHash, hashToken(token)),
      isNull(staffInvites.acceptedAt),
      isNull(staffInvites.revokedAt),
    ))
    .limit(1);

  const invite = rows[0];
  if (!invite || invite.expiresAt.getTime() <= Date.now()) return null;
  return { id: invite.id, staffUserId: invite.staffUserId, propertyId: invite.propertyId };
}

/** Null stays null; anything unparseable also becomes null rather than an
 *  Invalid Date that throws in `Intl` three layers up. */
function asDate(value: string | Date | null): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function cleanEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (!email || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ValidationError('That is not an email address.');
  }
  return email;
}

function cleanName(value: string): string {
  const name = value.trim();
  if (!name) throw new ValidationError('A name, however they give it.');
  if (name.length > 160) throw new ValidationError('That name is too long.');
  return name;
}
