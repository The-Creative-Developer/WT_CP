import { beforeEach, describe, expect, it } from 'vitest';
import { applyTheme, getSavedTheme } from './theme';

describe('theme', () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it('returns null when nothing is saved', () => {
    expect(getSavedTheme()).toBeNull();
  });

  it('applies and persists a theme', () => {
    applyTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(getSavedTheme()).toBe('dark');
  });

  it('ignores invalid saved values', () => {
    localStorage.setItem('devverse-theme', 'purple');
    expect(getSavedTheme()).toBeNull();
  });
});
