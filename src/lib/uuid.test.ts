import { describe, it, expect } from 'vitest';

/** Mirrors the guard in src/db/client.ts. Kept as a test because the first
 *  version enforced RFC 4122 variant bits and rejected every seed fixture. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('tenant id guard', () => {
  it('accepts ids Postgres accepts, including non-v4 fixtures', () => {
    for (const id of [
      '11111111-1111-1111-1111-111111111111',
      '00000000-0000-0000-0000-000000000000',
      'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      'A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11',
    ]) expect(UUID_RE.test(id), id).toBe(true);
  });

  it('rejects what would corrupt the tenant context', () => {
    // '' is the dangerous one: the policy's nullif turns it into "match
    // nothing", so it fails silently rather than loudly (D-020).
    for (const bad of ['', ' ', 'not-a-uuid', '11111111-1111-1111-1111', "'; drop table stays;--"])
      expect(UUID_RE.test(bad), JSON.stringify(bad)).toBe(false);
  });
});
