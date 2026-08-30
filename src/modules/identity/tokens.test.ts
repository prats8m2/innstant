import { describe, it, expect } from 'vitest';
import { issueToken, hashToken, tokenHashEquals } from './tokens';

describe('session tokens', () => {
  it('hashes to exactly 64 hex chars — the length 0002 constrains', () => {
    const { tokenHash } = issueToken();
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('never returns the raw token as the stored value', () => {
    const { token, tokenHash } = issueToken();
    expect(tokenHash).not.toBe(token);
    expect(tokenHash).toBe(hashToken(token));
  });

  it('issues unique tokens', () => {
    const seen = new Set(Array.from({ length: 500 }, () => issueToken().token));
    expect(seen.size).toBe(500);
  });

  it('produces a URL-safe token with at least 256 bits of entropy', () => {
    const { token } = issueToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
  });

  it('compares hashes in constant time, and by value', () => {
    const a = hashToken('one');
    expect(tokenHashEquals(a, hashToken('one'))).toBe(true);
    expect(tokenHashEquals(a, hashToken('two'))).toBe(false);
    expect(tokenHashEquals(a, 'short')).toBe(false);
  });
});
