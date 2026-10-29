import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type pg from 'pg';
import { withTenant } from '@/db';
import { getPropertyProfile, updateGuestInfo, updateBranding } from '@/modules/identity';
import { ownerClient, seedTenant, cleanup, TENANT_A, TENANT_B, type Fixture } from './setup';

/**
 * D-087: what a guest reads about the hotel, and how it looks to them.
 */
describe('property profile', () => {
  let owner: pg.Client;
  let a: Fixture;
  let b: Fixture;
  const staff = '11111111-1111-4111-8111-111111111111';

  const blank = {
    contactPhone: null, contactWhatsapp: null, contactEmail: null, addressLine: null,
    city: null, checkInTime: null, checkOutTime: null, wifiNetwork: null, wifiPassword: null,
  };

  beforeAll(async () => {
    owner = ownerClient();
    await owner.connect();
    await cleanup(owner);
    a = await seedTenant(owner, TENANT_A, 'A');
    b = await seedTenant(owner, TENANT_B, 'B');
  });

  afterAll(async () => {
    await cleanup(owner);
    await owner.end();
  });

  it('stores guest info and logs which fields changed, never the values', async () => {
    await withTenant({ tenantId: a.tenantId, propertyId: a.propertyId }, (tx) => updateGuestInfo(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, staffUserId: staff,
      info: { ...blank, wifiNetwork: 'Kesari Guest', wifiPassword: 'haveli-1932', checkOutTime: '11:00' },
    }));

    const profile = await withTenant({ tenantId: a.tenantId, propertyId: a.propertyId },
      (tx) => getPropertyProfile(tx, a.propertyId));
    expect(profile?.guestInfo.wifiPassword).toBe('haveli-1932');
    expect(profile?.guestInfo.checkOutTime).toBe('11:00');
    expect(profile?.guestInfo.contactPhone).toBeNull();

    const events = await owner.query<{ payload: { changed: string[] }; actor_staff_id: string }>(
      `SELECT payload, actor_staff_id FROM event_log
       WHERE entity_id = $1 AND event_type = 'property.guest_info_updated'`, [a.propertyId]);
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0]!.payload.changed.sort()).toEqual(['checkOutTime', 'city', 'wifiNetwork', 'wifiPassword']); // the fixture's city, cleared: the form saves every field
    expect(JSON.stringify(events.rows[0]!.payload)).not.toContain('haveli-1932');
    expect(events.rows[0]!.actor_staff_id).toBe(staff);
  });

  it('writes no event when nothing changed', async () => {
    const before = await owner.query(`SELECT count(*)::int AS n FROM event_log WHERE entity_id = $1`, [a.propertyId]);
    await withTenant({ tenantId: a.tenantId, propertyId: a.propertyId }, (tx) => updateGuestInfo(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, staffUserId: staff,
      info: { ...blank, wifiNetwork: 'Kesari Guest', wifiPassword: 'haveli-1932', checkOutTime: '11:00' },
    }));
    const after = await owner.query(`SELECT count(*)::int AS n FROM event_log WHERE entity_id = $1`, [a.propertyId]);
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it('refuses an unreadable accent and leaves the branding as it was', async () => {
    await expect(withTenant({ tenantId: a.tenantId, propertyId: a.propertyId }, (tx) => updateBranding(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, staffUserId: staff,
      branding: { accent: '#1F2A44' },
    }))).rejects.toThrow(/too dark/);

    const saved = await withTenant({ tenantId: a.tenantId, propertyId: a.propertyId }, (tx) => updateBranding(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, staffUserId: staff,
      branding: { accent: '#5fc4b8', logoUrl: 'https://cdn.example.com/logo.png' },
    }));
    expect(saved).toEqual({ accent: '#5FC4B8', logoUrl: 'https://cdn.example.com/logo.png', coverUrl: null });

    const event = await owner.query<{ payload: { changed: Record<string, unknown> } }>(
      `SELECT payload FROM event_log WHERE entity_id = $1 AND event_type = 'property.branding_updated'`,
      [a.propertyId]);
    expect(event.rows).toHaveLength(1);
    expect(Object.keys(event.rows[0]!.payload.changed).sort()).toEqual(['accent', 'logoUrl']);
  });

  it('never shows one hotel another hotel\'s wifi', async () => {
    const leaked = await withTenant({ tenantId: b.tenantId, propertyId: b.propertyId },
      (tx) => getPropertyProfile(tx, a.propertyId));
    expect(leaked).toBeNull();
  });
});
