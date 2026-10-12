import { useSyncExternalStore } from 'react';
import { getEffectiveTheme, type Theme } from '../lib/theme';

function subscribe(onChange: () => void) {
  // The toggle writes data-theme on <html>; the OS setting applies when no explicit choice was made.
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const media = window.matchMedia?.('(prefers-color-scheme: dark)');
  media?.addEventListener('change', onChange);
  return () => {
    observer.disconnect();
    media?.removeEventListener('change', onChange);
  };
}

// [CONCEPT: useSyncExternalStore] Subscribes React to state that lives outside it (a DOM attribute, a media query).
export function useEffectiveTheme(): Theme {
  return useSyncExternalStore(subscribe, getEffectiveTheme, () => 'light');
}
