import { hash, verify } from '@node-rs/argon2';

/**
 * Argon2id. S5.
 *
 * Parameters follow OWASP's current recommendation (19 MiB, 2 iterations,
 * 1 degree of parallelism). Argon2id rather than argon2i or argon2d because it
 * resists both side-channel and GPU attacks, which is the right default when
 * the threat is an offline crack of a stolen table.
 *
 * `@node-rs/argon2` ships prebuilt binaries, so a Railway build does not need
 * node-gyp. It is well over CLAUDE.md's ~50KB dependency threshold (~600KB per
 * platform), which is accepted because S5 names Argon2id explicitly and a
 * pure-JS implementation would be too slow to use at these parameters.
 */
/** `Algorithm.Argon2id`. Written as the literal because it is an ambient const
 *  enum, which `isolatedModules` cannot inline. Asserted in password.test.ts. */
const ARGON2ID = 2;

const OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19_456, // KiB
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(plaintext: string): Promise<string> {
  if (plaintext.length < 12) {
    // Staff credentials sit behind a shared kitchen screen and a front desk
    // that turns over. Length is the only knob that reliably helps.
    throw new Error('Password must be at least 12 characters.');
  }
  return hash(plaintext, OPTIONS);
}

/**
 * Returns false rather than throwing on a malformed hash — a corrupt row must
 * read as "wrong password", not as a 500 that tells an attacker the account is
 * special.
 */
export async function verifyPassword(plaintext: string, stored: string): Promise<boolean> {
  try {
    return await verify(stored, plaintext, OPTIONS);
  } catch {
    return false;
  }
}
