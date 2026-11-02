import { describe, it, expect } from 'vitest';
import { isConsoleAppearance, renderedConsole } from './console-appearance';

describe('console appearance', () => {
  it('accepts only the three choices', () => {
    expect(isConsoleAppearance('light')).toBe(true);
    expect(isConsoleAppearance('dark')).toBe(true);
    expect(isConsoleAppearance('system')).toBe(true);
    expect(isConsoleAppearance('auto')).toBe(false);
    expect(isConsoleAppearance(undefined)).toBe(false);
  });
  it('renders follow-the-device as light until the browser says otherwise', () => {
    expect(renderedConsole('system')).toBe('light');
    expect(renderedConsole('dark')).toBe('dark');
    expect(renderedConsole('light')).toBe('light');
  });
});
