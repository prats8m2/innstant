import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import sharp from 'sharp';
import { withTenant } from '@/db';
import { ownerClient, seedTenant, cleanup, TENANT_A, TENANT_B, type Fixture } from './setup';

/**
 * D-093 against a real database: an upload is stored, recorded with its audit
 * row, served back, and only ever usable by the property that uploaded it.
 */
describe('uploaded pictures', () => {
  let owner: pg.Client;
  let a: Fixture;
  let b: Fixture;
  let staff: string;
  let folder: string;
  let media: typeof import('@/modules/media');
  let serve: typeof import('@/app/media/[id]/[file]/route');

  const scoped = <T>(fn: Parameters<typeof withTenant<T>>[1]) =>
    withTenant<T>({ tenantId: a.tenantId, propertyId: a.propertyId }, fn);

  async function upload(purpose: 'dish' | 'logo' = 'dish') {
    const prepared = await media.prepareMedia(
      await sharp({ create: { width: 1600, height: 1200, channels: 3, background: '#B4552D' } }).jpeg().toBuffer(),
      purpose,
    );
    await media.storeMedia(prepared);
    return scoped((tx) => media.recordMedia(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, staffUserId: staff, prepared,
    }));
  }

  beforeAll(async () => {
    // A folder of its own, set before storage is first asked for.
    folder = await mkdtemp(join(tmpdir(), 'innstant-media-'));
    process.env.MEDIA_DIR = folder;
    media = await import('@/modules/media');
    serve = await import('@/app/media/[id]/[file]/route');

    owner = ownerClient();
    await owner.connect();
    await cleanup(owner);
    a = await seedTenant(owner, TENANT_A, 'A');
    b = await seedTenant(owner, TENANT_B, 'B');
    staff = (await owner.query<{ id: string }>(
      `INSERT INTO staff_users (tenant_id, email, full_name, status)
       VALUES ($1, 'gm@a.example', 'GM', 'ACTIVE') RETURNING id`, [a.tenantId])).rows[0]!.id;
  });

  afterAll(async () => {
    await cleanup(owner);
    await owner.end();
    await rm(folder, { recursive: true, force: true });
  });

  it('records an upload, with who did it, in the event log', async () => {
    const saved = await upload();
    expect(saved.path).toBe(`/media/${saved.id}/1280.webp`);
    expect(saved.blurhash).toBeTruthy();

    const row = await owner.query<{ purpose: string; widths: number[]; uploaded_by_staff_id: string }>(
      `SELECT purpose, widths, uploaded_by_staff_id FROM media_assets WHERE id = $1`, [saved.id]);
    expect(row.rows[0]).toEqual({ purpose: 'dish', widths: [320, 640, 1280], uploaded_by_staff_id: staff });

    const event = await owner.query<{ actor_staff_id: string; payload: { purpose: string } }>(
      `SELECT actor_staff_id, payload FROM event_log
       WHERE event_type = 'media.uploaded' AND entity_id = $1`, [saved.id]);
    expect(event.rows).toHaveLength(1);
    expect(event.rows[0]!.actor_staff_id).toBe(staff);
    expect(event.rows[0]!.payload.purpose).toBe('dish');
  });

  it('serves every stored width, cacheable for a year, and 404s anything else', async () => {
    const saved = await upload();
    for (const width of [320, 640, 1280]) {
      const res = await serve.GET(new Request('http://x'), { params: Promise.resolve({ id: saved.id, file: `${width}.webp` }) });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('image/webp');
      expect(res.headers.get('cache-control')).toContain('immutable');
      expect((await sharp(Buffer.from(await res.arrayBuffer())).metadata()).width).toBe(width);
    }
    const missing = await serve.GET(new Request('http://x'), { params: Promise.resolve({ id: randomUUID(), file: '1280.webp' }) });
    expect(missing.status).toBe(404);
    const escape = await serve.GET(new Request('http://x'), { params: Promise.resolve({ id: '..', file: 'passwd' }) });
    expect(escape.status).toBe(404);
  });

  it('lets a save use its own property\'s upload, and brings the blurhash', async () => {
    const saved = await upload();
    const own = await scoped((tx) => media.checkOwnMedia(tx, {
      propertyId: a.propertyId, value: saved.path, label: 'The photo',
    }));
    expect(own).toEqual({ isUpload: true, blurhash: saved.blurhash });

    // A pasted URL, or nothing, is not this function's business.
    expect(await scoped((tx) => media.checkOwnMedia(tx, {
      propertyId: a.propertyId, value: 'https://images.example/curry.jpg', label: 'The photo',
    }))).toEqual({ isUpload: false, blurhash: null });
  });

  it('refuses another property\'s upload, and another hotel\'s', async () => {
    const saved = await upload();

    // Same hotel, a different property id: the row is visible, and refused.
    await expect(scoped((tx) => media.checkOwnMedia(tx, {
      propertyId: randomUUID(), value: saved.path, label: 'The photo',
    }))).rejects.toThrow(/not a picture uploaded here/);

    // Another hotel cannot even see it.
    await expect(withTenant({ tenantId: b.tenantId, propertyId: b.propertyId }, (tx) =>
      media.checkOwnMedia(tx, { propertyId: b.propertyId, value: saved.path, label: 'The logo' }),
    )).rejects.toThrow(/not a picture uploaded here/);
    const theirs = await withTenant({ tenantId: b.tenantId, propertyId: b.propertyId },
      (tx) => media.findMediaAsset(tx, { propertyId: a.propertyId, id: saved.id }));
    expect(theirs).toBeNull();
  });
});
