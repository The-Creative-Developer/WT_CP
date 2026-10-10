export type Theme = 'light' | 'dark';
const STORAGE_KEY = 'devverse-theme';

// [CONCEPT: Web Storage] localStorage persists the choice per browser; it can throw in private mode, so access is guarded.
export function getSavedTheme(): Theme | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

export function getSystemTheme(): Theme {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function getEffectiveTheme(): Theme {
  return getSavedTheme() ?? getSystemTheme();
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Storage unavailable: the theme still applies for this page view.
  }
}
