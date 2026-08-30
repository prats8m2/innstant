import { describe, it, expect } from 'vitest';
import { authorize, can, requireSession, type StaffSession } from './authorize';
import { ForbiddenError, NotFoundError, UnauthenticatedError } from '@/lib/errors';
import { httpStatusFor } from '@/lib/errors';
import { SYSTEM_ROLES, type Permission } from './permissions';

const PROP_A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const PROP_B = 'bbbbbbbb-0000-4000-8000-00000000000b';

function sessionWith(
  roleKey: keyof typeof SYSTEM_ROLES,
  properties: readonly string[] = [PROP_A],
  expiresAt = new Date(Date.now() + 3_600_000),
): StaffSession {
  const perms = new Set<Permission>(SYSTEM_ROLES[roleKey].permissions);
  return {
    staffUserId: 'user-1', tenantId: 'tenant-1',
    email: 'a@example.com', fullName: 'Test',
    properties: new Map(properties.map((p) => [p, perms])),
    expiresAt,
  };
}

describe('S5 done condition', () => {
  it('FRONT_DESK gets 403 on an admin-only action at their OWN property', () => {
    const session = sessionWith('FRONT_DESK', [PROP_A]);
    try {
      authorize(session, PROP_A, 'role:manage');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ForbiddenError);
      expect(httpStatusFor(e)).toBe(403);
    }
  });

  it('FRONT_DESK gets 404 on ANYTHING at another property', () => {
    const session = sessionWith('FRONT_DESK', [PROP_A]);
    // Even a permission the role definitely holds.
    for (const perm of ['stay:read', 'role:manage'] as Permission[]) {
      try {
        authorize(session, PROP_B, perm);
        expect.unreachable('should have thrown');
      } catch (e) {
        expect(e, perm).toBeInstanceOf(NotFoundError);
        expect(httpStatusFor(e)).toBe(404);
      }
    }
  });

  it('404 not 403 across properties — a 403 would confirm the property exists', () => {
    const session = sessionWith('PROPERTY_ADMIN', [PROP_A]);
    // Even a full admin learns nothing about a property they hold no role at.
    expect(() => authorize(session, PROP_B, 'property:read')).toThrow(NotFoundError);
  });
});

describe('authorize', () => {
  it('allows a permission the role holds', () => {
    expect(() => authorize(sessionWith('FRONT_DESK'), PROP_A, 'stay:check_in')).not.toThrow();
  });

  it('rejects a missing session as 401', () => {
    try {
      authorize(null, PROP_A, 'stay:read');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(UnauthenticatedError);
      expect(httpStatusFor(e)).toBe(401);
    }
  });

  it('rejects an expired session as 401, even with the permission', () => {
    const expired = sessionWith('PROPERTY_ADMIN', [PROP_A], new Date(Date.now() - 1000));
    expect(() => authorize(expired, PROP_A, 'stay:read')).toThrow(UnauthenticatedError);
  });

  it('supports a group GM holding roles at several properties', () => {
    const session = sessionWith('PROPERTY_ADMIN', [PROP_A, PROP_B]);
    expect(() => authorize(session, PROP_A, 'analytics:read')).not.toThrow();
    expect(() => authorize(session, PROP_B, 'analytics:read')).not.toThrow();
  });
});

describe('role boundaries that matter', () => {
  it('KITCHEN can 86 a dish but cannot reprice it', () => {
    const s = sessionWith('KITCHEN');
    expect(can(s, PROP_A, 'catalog:availability')).toBe(true);
    expect(can(s, PROP_A, 'catalog:pricing')).toBe(false);
    expect(can(s, PROP_A, 'catalog:manage')).toBe(false);
  });

  it('KITCHEN can reject an order but not cancel an accepted one', () => {
    const s = sessionWith('KITCHEN');
    expect(can(s, PROP_A, 'order:reject')).toBe(true);
    expect(can(s, PROP_A, 'order:cancel')).toBe(false);
  });

  it('FRONT_DESK can capture a payment but never refund one', () => {
    const s = sessionWith('FRONT_DESK');
    expect(can(s, PROP_A, 'payment:capture')).toBe(true);
    expect(can(s, PROP_A, 'payment:refund')).toBe(false);
    expect(can(s, PROP_A, 'folio:adjust')).toBe(false);
  });

  it('only PROPERTY_ADMIN may change the D-012 access policy', () => {
    for (const key of ['FRONT_DESK', 'F_AND_B_MANAGER', 'KITCHEN', 'RUNNER',
                       'HOUSEKEEPING', 'CONCIERGE', 'READ_ONLY'] as const) {
      expect(can(sessionWith(key), PROP_A, 'property:access_policy'), key).toBe(false);
    }
    expect(can(sessionWith('PROPERTY_ADMIN'), PROP_A, 'property:access_policy')).toBe(true);
  });

  it('guest:vouch is front desk and admin only — it bypasses D-012 verification', () => {
    expect(can(sessionWith('FRONT_DESK'), PROP_A, 'guest:vouch')).toBe(true);
    expect(can(sessionWith('PROPERTY_ADMIN'), PROP_A, 'guest:vouch')).toBe(true);
    for (const key of ['F_AND_B_MANAGER', 'KITCHEN', 'RUNNER', 'HOUSEKEEPING',
                       'CONCIERGE', 'READ_ONLY'] as const) {
      expect(can(sessionWith(key), PROP_A, 'guest:vouch'), key).toBe(false);
    }
  });

  it('READ_ONLY holds no write permission at all', () => {
    const s = sessionWith('READ_ONLY');
    const writes = SYSTEM_ROLES.PROPERTY_ADMIN.permissions.filter((p) => !p.endsWith(':read'));
    for (const p of writes) {
      if (p === 'analytics:read' || p === 'audit:read') continue;
      expect(can(s, PROP_A, p), p).toBe(false);
    }
  });

  it('RUNNER can advance an order but not accept one', () => {
    const s = sessionWith('RUNNER');
    expect(can(s, PROP_A, 'order:advance')).toBe(true);
    expect(can(s, PROP_A, 'order:accept')).toBe(false);
  });
});

describe('requireSession', () => {
  it('passes a live session and rejects a missing or expired one', () => {
    expect(() => requireSession(sessionWith('KITCHEN'))).not.toThrow();
    expect(() => requireSession(null)).toThrow(UnauthenticatedError);
    expect(() => requireSession(sessionWith('KITCHEN', [PROP_A], new Date(0))))
      .toThrow(UnauthenticatedError);
  });
});
