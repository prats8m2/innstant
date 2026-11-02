import { describe, it, expect } from 'vitest';
import { initials } from './initials';

describe('initials', () => {
  it('takes the first and last name', () => expect(initials('Meena Ravi Joshi')).toBe('MJ'));
  it('takes two letters of a single name', () => expect(initials('Meena')).toBe('ME'));
  it('ignores stray spaces', () => expect(initials('  sunita   devi ')).toBe('SD'));
});
