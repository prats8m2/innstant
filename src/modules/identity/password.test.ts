import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from './password';

describe('password hashing', () => {
  it('produces an Argon2id hash — not argon2i or argon2d', async () => {
    // The algorithm is written as a numeric literal because @node-rs exposes it
    // as an ambient const enum. This asserts the literal is still the right one.
    const h = await hashPassword('correct horse battery staple');
    expect(h.startsWith('$argon2id$')).toBe(true);
  });

  it('uses the OWASP parameters', async () => {
    const h = await hashPassword('correct horse battery staple');
    expect(h).toContain('m=19456');
    expect(h).toContain('t=2');
    expect(h).toContain('p=1');
  });

  it('salts — the same password hashes differently every time', async () => {
    const [a, b] = await Promise.all([
      hashPassword('correct horse battery staple'),
      hashPassword('correct horse battery staple'),
    ]);
    expect(a).not.toBe(b);
  });

  it('verifies a correct password and rejects a wrong one', async () => {
    const h = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', h)).toBe(true);
    expect(await verifyPassword('Correct horse battery staple', h)).toBe(false);
    expect(await verifyPassword('', h)).toBe(false);
  });

  it('returns false rather than throwing on a corrupt hash', async () => {
    // A corrupt row must read as "wrong password", not as a 500 that tells an
    // attacker the account is special.
    for (const bad of ['', 'not-a-hash', '$argon2id$garbage']) {
      expect(await verifyPassword('anything', bad)).toBe(false);
    }
  });

  it('refuses a password under 12 characters', async () => {
    await expect(hashPassword('short')).rejects.toThrow(/12 characters/);
  });
});
