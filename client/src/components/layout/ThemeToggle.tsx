import { useState } from 'react';
import { applyTheme, getEffectiveTheme, type Theme } from '../../lib/theme';

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(getEffectiveTheme);
  const next: Theme = theme === 'dark' ? 'light' : 'dark';

  return (
    <button
      type="button"
      onClick={() => {
        applyTheme(next);
        setTheme(next);
      }}
      aria-label={`Switch to ${next} theme`}
      className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-2"
    >
      <span aria-hidden="true">{theme === 'dark' ? '☀️' : '🌙'}</span>
    </button>
  );
}
