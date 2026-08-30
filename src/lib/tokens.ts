import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

/**
 * Session tokens. CLAUDE.md #10 — stored as SHA-256 only, never in the clear.
 *
 * The token is 32 random bytes. It is not a JWT and carries no claims: a
 * revoked stateless token stays valid until it expires, and checkout must be
 * able to kill a session immediately (#10). The database row IS the session.
 *
 * SHA-256 rather than Argon2 here, deliberately. A session token is 256 bits of
 * uniform randomness, so there is no dictionary to attack and no work factor
 * worth paying — and this runs on every authenticated request. Password hashing
 * is the opposite case and uses Argon2id.
 */
export interface IssuedToken {
  /** Goes to the client in an httpOnly cookie. Never persisted. */
  token: string;
  /** Goes to the database. 64 hex characters — constrained in 0002. */
  tokenHash: string;
}

export function issueToken(): IssuedToken {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Constant-time compare, for anywhere a hash is checked outside a SQL lookup. */
export function tokenHashEquals(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
