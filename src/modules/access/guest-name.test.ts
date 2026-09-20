import { describe, it, expect } from 'vitest';
import { firstNameOf } from './guest-name';

/**
 * What the room home calls a guest.
 *
 * A hotel's guest list is not a list of "First Last". It has couples booked on
 * one line, mononyms, honorifics, and names typed in the order the passport
 * prints them. Getting this wrong is not a rendering bug — it greets somebody
 * by the wrong half of their name every time they open the app, for the length
 * of their stay.
 *
 * So the rule is conservative: drop a trailing surname only when the shape is
 * unmistakably "something Surname", and keep everything otherwise.
 */
describe('firstNameOf', () => {
  it('takes the first name off a plain two-part name', () => {
    expect(firstNameOf('Anjali Menon')).toBe('Anjali');
    expect(firstNameOf('Marcus Lindqvist')).toBe('Marcus');
  });

  it('keeps both people on a joined booking, and drops the shared surname', () => {
    // Greeting only Farah, on a screen in a room both of them are staying in,
    // is worse than greeting neither.
    expect(firstNameOf('Farah & Omar Haddad')).toBe('Farah & Omar');
    expect(firstNameOf('Sunita and Vikram Rao')).toBe('Sunita and Vikram');
  });

  it('keeps a mononym whole', () => {
    expect(firstNameOf('Prince')).toBe('Prince');
  });

  it('returns null rather than guessing at nothing', () => {
    expect(firstNameOf(null)).toBeNull();
    expect(firstNameOf('')).toBeNull();
    expect(firstNameOf('   ')).toBeNull();
  });

  it('is not confused by the whitespace a desk actually types', () => {
    expect(firstNameOf('  Anjali   Menon  ')).toBe('Anjali');
  });

  /**
   * Three or more parts stay a first name — "Maria del Carmen Rodriguez"
   * greets as "Maria", which is right far more often than any cleverer rule.
   */
  it('does not try to be clever about long names', () => {
    expect(firstNameOf('Maria del Carmen Rodriguez')).toBe('Maria');
  });
});
