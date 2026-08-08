/**
 * Light, dark, or whatever the device says.
 *
 * The choice is written to the root element as `data-theme` and remembered.
 * "Sistema" is the default and stays live: changing the OS setting flips the
 * app without a reload.
 */

import { useCallback, useEffect, useState } from 'react';

import { readThemeChoice, saveThemeChoice, type ThemeChoice } from '../../storage/theme';

export type { ThemeChoice };

/** The theme actually in effect once "system" is resolved. */
export function resolveTheme(choice: ThemeChoice): 'light' | 'dark' {
  if (choice !== 'system') return choice;
  return globalThis.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>(readThemeChoice);
  const [resolved, setResolved] = useState<'light' | 'dark'>(() =>
    resolveTheme(readThemeChoice()),
  );

  useEffect(() => {
    const apply = () => {
      const next = resolveTheme(choice);
      setResolved(next);
      document.documentElement.dataset.theme = next;
      // Tells the browser which scrollbars and form controls to draw.
      document.documentElement.style.colorScheme = next;
    };

    apply();

    // Only follow the OS while the user has not made a choice.
    if (choice !== 'system') return;
    const query = globalThis.matchMedia?.('(prefers-color-scheme: light)');
    query?.addEventListener('change', apply);
    return () => query?.removeEventListener('change', apply);
  }, [choice]);

  const select = useCallback((next: ThemeChoice) => {
    setChoice(next);
    saveThemeChoice(next);
  }, []);

  return { choice, resolved, select };
}
