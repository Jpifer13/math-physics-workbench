import { describe, expect, it } from 'vitest';
import { nextChoice, resolveTheme } from './theme';

describe('appearance', () => {
  it('follows the system unless told otherwise', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('steps through the choices and comes back round', () => {
    expect(nextChoice('system')).toBe('light');
    expect(nextChoice('light')).toBe('dark');
    expect(nextChoice('dark')).toBe('system');
  });
});
