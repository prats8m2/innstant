import { describe, it, expect } from 'vitest';
import {
  escapeLike, likeContains, likePrefix, looksLikeName, normaliseQuery, orderNeedle,
  SEARCH_MAX_LENGTH,
} from './search';

describe('escapeLike', () => {
  it('makes LIKE wildcards literal', () => {
    expect(escapeLike('50%_off')).toBe('50\\%\\_off');
  });
  it('escapes the escape character itself', () => {
    expect(escapeLike('a\\b')).toBe('a\\\\b');
  });
  it('leaves ordinary text alone', () => {
    expect(escapeLike('Priya Nair')).toBe('Priya Nair');
  });
});

describe('likePrefix / likeContains', () => {
  it('anchors a prefix at the start only', () => {
    expect(likePrefix('21')).toBe('21%');
  });
  it('wraps a contains on both sides, escaped', () => {
    expect(likeContains('a_b')).toBe('%a\\_b%');
  });
});

describe('normaliseQuery', () => {
  it('trims and collapses inner whitespace', () => {
    expect(normaliseQuery('  priya   nair \n')).toBe('priya nair');
  });
  it('cuts to the maximum length', () => {
    expect(normaliseQuery('x'.repeat(200))).toHaveLength(SEARCH_MAX_LENGTH);
  });
  it('is empty for whitespace', () => {
    expect(normaliseQuery('   ')).toBe('');
  });
});

describe('orderNeedle', () => {
  it.each([
    ['KE-1186', 'KE1186'],
    ['ke 1186', 'KE1186'],
    ['#1186', '1186'],
    ['1186', '1186'],
  ])('reads %s as %s', (typed, needle) => {
    expect(orderNeedle(typed)).toBe(needle);
  });
  it('is null without a digit, so a name never scans orders', () => {
    expect(orderNeedle('Priya')).toBeNull();
    expect(orderNeedle('KE-')).toBeNull();
  });
});

describe('looksLikeName', () => {
  it('needs two characters and a letter', () => {
    expect(looksLikeName('P')).toBe(false);
    expect(looksLikeName('214')).toBe(false);
    expect(looksLikeName('Pr')).toBe(true);
  });
  it('accepts a name in Devanagari', () => {
    expect(looksLikeName('प्रिया')).toBe(true);
  });
});
