import { describe, it, expect } from 'vitest';
import { cleanVisitorName } from './visitor-name';

/**
 * The name a stranger types on the marketing site.
 *
 * It is shown back to them inside a hotel's own guest app, which is why this is
 * worth a test at all: it is the only string in the product that goes from an
 * anonymous text field straight into a heading. The cleaning has to be
 * conservative — a name is whatever a person says it is — while refusing the
 * two things that would break the screen: nothing at all, and something too
 * long to be a name.
 */
describe('cleanVisitorName', () => {
  it('keeps a name as typed', () => {
    expect(cleanVisitorName('Priya')).toBe('Priya');
  });

  it('collapses the whitespace a phone keyboard adds', () => {
    expect(cleanVisitorName('  Priya   Nair ')).toBe('Priya Nair');
    // A newline pasted from somewhere else would otherwise break the heading
    // in half.
    expect(cleanVisitorName('Priya\n\tNair')).toBe('Priya Nair');
  });

  it('returns null for anything not worth greeting', () => {
    expect(cleanVisitorName('')).toBeNull();
    expect(cleanVisitorName('   ')).toBeNull();
    expect(cleanVisitorName(null)).toBeNull();
    expect(cleanVisitorName(undefined)).toBeNull();
  });

  /**
   * Truncated rather than rejected. Somebody who types a long name has given a
   * real answer, and refusing it at a boundary they cannot see is worse than
   * greeting them by the first sixty characters of it.
   */
  it('caps a name at a length a greeting can hold', () => {
    const long = 'a'.repeat(200);
    expect(cleanVisitorName(long)).toHaveLength(60);
  });

  /**
   * Names are not sanitised beyond whitespace, deliberately. React escapes on
   * render, so the defence is at the output and not here — stripping
   * apostrophes and accents to feel safe would mangle a large share of real
   * names to solve a problem that is already solved.
   */
  it('leaves apostrophes, accents and scripts alone', () => {
    expect(cleanVisitorName("Rhea D'Souza")).toBe("Rhea D'Souza");
    expect(cleanVisitorName('Zoë')).toBe('Zoë');
    expect(cleanVisitorName('प्रतीक')).toBe('प्रतीक');
    expect(cleanVisitorName('<script>')).toBe('<script>');
  });
});
