import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import type pg from 'pg';
import { withTenant } from '@/db';
import {
  requestCode, verifyCode, resolveCustomerSession, revokeCustomerSession,
  revokeAllCustomerSessions, getProfile, updateProfile,
  listAddresses, createAddress, updateAddress, archiveAddress,
} from '@/modules/customer';
import { upsertGuestByPhone } from '@/modules/stay';
import { ValidationError, TooManyAttemptsError } from '@/lib/errors';
import { ownerClient, seedTenant, cleanup, TENANT_A, TENANT_B, type Fixture } from './setup';

/**
 * Customer accounts. D-081.
 *
 * The OTP code never leaves the server, so a test cannot read it from a
 * return value — which is the property the whole design rests on. It is read
 * from `otp_challenges` with the owner connection, exactly as an attacker with
 * database access could, and never from an API surface.
 */
describe('customer sign-in', () => {
  let owner: pg.Client;
  let a: Fixture;
  const PHONE = '+91 98290 54321';

  const scoped = <T>(fn: Parameters<typeof withTenant<T>>[1]) =>
    withTenant<T>({ tenantId: a.tenantId }, fn);

  /** The live code for a number, straight out of the table. */
  async function liveCodeHashCount(phone: string): Promise<number> {
    const r = await owner.query(
      `SELECT count(*)::int n FROM otp_challenges
        WHERE phone = $1 AND consumed_at IS NULL AND superseded_at IS NULL`,
      [phone]);
    return r.rows[0].n;
  }

  /**
   * The sender is the seam the test uses to learn the code — which is exactly
   * how a real SMS provider would learn it, and the only way anything outside
   * this module ever does.
   */
  let sent: Array<{ phone: string; code: string }> = [];
  beforeAll(async () => {
    owner = ownerClient();
    await owner.connect();
    const senderModule = await import('@/modules/customer/otp-sender');
    vi.spyOn(senderModule, 'otpSender').mockImplementation(() => ({
      name: 'test',
      async send(input) { sent.push({ phone: input.phone, code: input.code }); },
    }));
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await cleanup(owner);
    await owner.end();
  });

  beforeEach(async () => {
    sent = [];
    await cleanup(owner);
    a = await seedTenant(owner, TENANT_A, 'A');
  });

  it('issues a session for the right code, and a guest row for a new number', async () => {
    await requestCode({ tenantId: a.tenantId, phone: PHONE });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.code).toMatch(/^\d{6}$/);

    const verified = await verifyCode({
      tenantId: a.tenantId, phone: PHONE, code: sent[0]!.code, name: 'Priya',
    });

    const session = await resolveCustomerSession(verified.token);
    expect(session?.guestId).toBe(verified.guestId);

    const profile = await scoped((tx) => getProfile(tx, verified.guestId));
    expect(profile?.phoneVerified).toBe(true);
    // Normalised on the way in — the unique index is only worth anything if
    // one human number produces one string.
    expect(profile?.phone).toBe('+919829054321');
  });

  it('recognises a number that already ordered anonymously, without renaming them', async () => {
    // A front desk created this person. Their name is on a folio.
    const existing = await scoped((tx) => upsertGuestByPhone(tx, {
      tenantId: a.tenantId, phone: PHONE, fullName: 'Anjali Menon',
    }));

    await requestCode({ tenantId: a.tenantId, phone: PHONE });
    const verified = await verifyCode({
      tenantId: a.tenantId, phone: PHONE, code: sent[0]!.code, name: 'anj',
    });

    // EXTENSION-POINTS §2 — one person, one row, no merge script later.
    expect(verified.guestId).toBe(existing);

    // And the desk's copy is untouched. `full_name` is what a folio is made
    // out to; a customer who proved a phone number may not rewrite it.
    const row = await owner.query('SELECT full_name, display_name FROM guests WHERE id = $1', [existing]);
    expect(row.rows[0].full_name).toBe('Anjali Menon');
    // Nor may it arrive by the side door: a real name on the row means the
    // customer's own column stays empty too, or the app would show "anj" to
    // somebody the hotel knows as Anjali Menon.
    expect(row.rows[0].display_name).toBeNull();
  });

  it('records the name somebody types when the row has none to protect', async () => {
    // The first sign-in offered no name, so the row holds the placeholder.
    await requestCode({ tenantId: a.tenantId, phone: PHONE });
    const first = await verifyCode({ tenantId: a.tenantId, phone: PHONE, code: sent[0]!.code });
    expect((await scoped((tx) => getProfile(tx, first.guestId)))?.name).toBe('Guest');

    // They come back and type one. It has to stick — this is the name the
    // account screen greets them with and the kitchen reads off the ticket,
    // and dropping it left the app calling somebody "Guest" to their face.
    await requestCode({ tenantId: a.tenantId, phone: PHONE });
    const second = await verifyCode({
      tenantId: a.tenantId, phone: PHONE, code: sent[1]!.code, name: 'Nikhil Rao',
    });
    expect(second.guestId).toBe(first.guestId);

    const row = await owner.query('SELECT full_name, display_name FROM guests WHERE id = $1', [first.guestId]);
    expect(row.rows[0].display_name).toBe('Nikhil Rao');
    // Written to the customer's column, never the desk's.
    expect(row.rows[0].full_name).toBe('Guest');
    expect((await scoped((tx) => getProfile(tx, first.guestId)))?.name).toBe('Nikhil Rao');
  });

  it('a customer-set name never touches the desk’s copy', async () => {
    await requestCode({ tenantId: a.tenantId, phone: PHONE });
    const v = await verifyCode({
      tenantId: a.tenantId, phone: PHONE, code: sent[0]!.code, name: 'Guest',
    });

    await scoped((tx) => updateProfile(tx, {
      tenantId: a.tenantId, guestId: v.guestId, name: 'Priya S', email: 'p@example.com',
    }));

    const row = await owner.query('SELECT full_name, display_name FROM guests WHERE id = $1', [v.guestId]);
    expect(row.rows[0].display_name).toBe('Priya S');
    expect(row.rows[0].full_name).toBe('Guest');

    const profile = await scoped((tx) => getProfile(tx, v.guestId));
    expect(profile?.name).toBe('Priya S');
  });

  it('keeps at most one live code per number', async () => {
    for (let i = 0; i < 3; i += 1) {
      await requestCode({ tenantId: a.tenantId, phone: PHONE });
    }
    // Enforced by a partial unique index in 0009 — five simultaneously-valid
    // six-digit codes make every guess five times likelier to land.
    expect(await liveCodeHashCount('+919829054321')).toBe(1);

    // And only the newest works.
    await expect(verifyCode({
      tenantId: a.tenantId, phone: PHONE, code: sent[0]!.code,
    })).rejects.toThrow(ValidationError);

    const ok = await verifyCode({
      tenantId: a.tenantId, phone: PHONE, code: sent[2]!.code,
    });
    expect(ok.guestId).toBeTruthy();
  });

  it('locks out per PHONE across challenges, not per challenge', async () => {
    // The bug this guards: request → 5 wrong → request again → 5 more. 200
    // requests is 1,000 guesses, which is every six-digit code.
    await requestCode({ tenantId: a.tenantId, phone: PHONE });

    for (let i = 0; i < 5; i += 1) {
      await expect(verifyCode({
        tenantId: a.tenantId, phone: PHONE, code: '000000',
      })).rejects.toThrow();
    }

    // A FRESH challenge must not reset the count.
    await requestCode({ tenantId: a.tenantId, phone: PHONE });
    await expect(verifyCode({
      tenantId: a.tenantId, phone: PHONE, code: sent.at(-1)!.code,
    })).rejects.toThrow(TooManyAttemptsError);
  });

  it('answers a never-seen number exactly as a known one', async () => {
    // The whole point: this endpoint must not be an oracle for "does this
    // person have an account here".
    const unknown = requestCode({ tenantId: a.tenantId, phone: '+91 90000 00001' });
    await expect(unknown).resolves.toBeUndefined();

    await scoped((tx) => upsertGuestByPhone(tx, {
      tenantId: a.tenantId, phone: '+91 90000 00002', fullName: 'Known',
    }));
    const known = requestCode({ tenantId: a.tenantId, phone: '+91 90000 00002' });
    await expect(known).resolves.toBeUndefined();

    // And neither created a guest row — the row is made at VERIFY, after the
    // handset is proved, so this endpoint cannot be used to fill the table.
    const n = await owner.query(
      `SELECT count(*)::int n FROM guests WHERE phone = '+919000000001'`);
    expect(n.rows[0].n).toBe(0);
  });

  it('throttles repeated sends to one number, silently', async () => {
    for (let i = 0; i < 8; i += 1) {
      await requestCode({ tenantId: a.tenantId, phone: PHONE });
    }
    // Five an hour. The caller is told nothing — saying "throttled" would say
    // the number is one somebody has been asking about.
    expect(sent.length).toBe(5);
  });

  it('a revoked session stops resolving, on one device and on all', async () => {
    await requestCode({ tenantId: a.tenantId, phone: PHONE });
    const v = await verifyCode({
      tenantId: a.tenantId, phone: PHONE, code: sent[0]!.code,
    });

    const session = (await resolveCustomerSession(v.token))!;
    await scoped((tx) => revokeCustomerSession(tx, session.id));
    expect(await resolveCustomerSession(v.token)).toBeNull();

    // Sign out everywhere.
    await requestCode({ tenantId: a.tenantId, phone: PHONE });
    const again = await verifyCode({
      tenantId: a.tenantId, phone: PHONE, code: sent.at(-1)!.code,
    });
    expect(await resolveCustomerSession(again.token)).not.toBeNull();
    await scoped((tx) => revokeAllCustomerSessions(tx, again.guestId));
    expect(await resolveCustomerSession(again.token)).toBeNull();
  });

  it('a session from one tenant does not resolve in another', async () => {
    const b = await seedTenant(owner, TENANT_B, 'B');
    await requestCode({ tenantId: a.tenantId, phone: PHONE });
    const v = await verifyCode({
      tenantId: a.tenantId, phone: PHONE, code: sent[0]!.code,
    });

    const session = await resolveCustomerSession(v.token);
    expect(session?.tenantId).toBe(a.tenantId);
    expect(session?.tenantId).not.toBe(b.tenantId);

    // The token carries its own tenant; swapping it resolves to nothing
    // rather than to somebody else's account.
    const swapped = `${b.tenantId}.${v.token.split('.')[1]}`;
    expect(await resolveCustomerSession(swapped)).toBeNull();
  });
});

describe('customer addresses', () => {
  let owner: pg.Client;
  let a: Fixture;
  let guestId = '';

  const scoped = <T>(fn: Parameters<typeof withTenant<T>>[1]) =>
    withTenant<T>({ tenantId: a.tenantId }, fn);

  beforeAll(async () => { owner = ownerClient(); await owner.connect(); });
  afterAll(async () => { await cleanup(owner); await owner.end(); });

  beforeEach(async () => {
    await cleanup(owner);
    a = await seedTenant(owner, TENANT_A, 'A');
    guestId = await scoped((tx) => upsertGuestByPhone(tx, {
      tenantId: a.tenantId, phone: '+919829054321', fullName: 'Priya',
    }));
  });

  const add = (label: string, line: string, isDefault?: boolean) =>
    scoped((tx) => createAddress(tx, { tenantId: a.tenantId, guestId, label, line, isDefault }));

  it('makes the first address the default without being asked', async () => {
    const home = await add('Home', '12 MG Road');
    expect(home.isDefault).toBe(true);
  });

  it('moves the default rather than keeping two', async () => {
    await add('Home', '12 MG Road');
    const work = await add('Work', '4 Lake Palace Road', true);

    const all = await scoped((tx) => listAddresses(tx, guestId));
    expect(all.filter((x) => x.isDefault).map((x) => x.id)).toEqual([work.id]);
  });

  it('refuses to touch another customer’s address', async () => {
    const mine = await add('Home', '12 MG Road');
    const other = await scoped((tx) => upsertGuestByPhone(tx, {
      tenantId: a.tenantId, phone: '+919000011111', fullName: 'Someone else',
    }));

    // RLS confines these rows to the TENANT; the guest_id predicate is what
    // confines them to the person. The id travels in a URL.
    await expect(scoped((tx) => updateAddress(tx, {
      tenantId: a.tenantId, guestId: other, addressId: mine.id,
      label: 'Stolen', line: 'Somewhere',
    }))).rejects.toThrow();

    await expect(scoped((tx) => archiveAddress(tx, {
      guestId: other, addressId: mine.id,
    }))).rejects.toThrow();
  });

  it('archives rather than deletes, and stops offering it', async () => {
    const home = await add('Home', '12 MG Road');
    await add('Work', '4 Lake Palace Road');
    await scoped((tx) => archiveAddress(tx, { guestId, addressId: home.id }));

    const live = await scoped((tx) => listAddresses(tx, guestId));
    expect(live.map((x) => x.label)).toEqual(['Work']);

    // Still there — an order that went to it keeps its own snapshot (#6), and
    // nothing that pointed at this row breaks.
    const row = await owner.query('SELECT archived_at FROM guest_addresses WHERE id = $1', [home.id]);
    expect(row.rows[0].archived_at).not.toBeNull();
  });

  it('rejects an address a kitchen ticket could not print', async () => {
    await expect(add('', '12 MG Road')).rejects.toThrow(ValidationError);
    await expect(add('Home', '')).rejects.toThrow(ValidationError);
    await expect(add('Home', 'x'.repeat(401))).rejects.toThrow(ValidationError);
  });
});
