/**
 * The saved theme preference.
 *
 * Lives here rather than in the hook because `localStorage` access belongs to
 * this layer — a rule the architecture test enforces, and the reason a quota
 * error or a locked-down browser can never take the app down.
 *
 * The key is shared with `public/theme.js`, which applies the choice before
 * the first paint so a light-mode user never sees a dark flash.
 */

export type ThemeChoice = 'system' | 'light' | 'dark';

export const THEME_KEY = 'gimnasio.theme.v1';

export function readThemeChoice(): ThemeChoice {
  try {
    const value = globalThis.localStorage?.getItem(THEME_KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

export function saveThemeChoice(choice: ThemeChoice): void {
  try {
    const store = globalThis.localStorage;
    if (!store) return;
    if (choice === 'system') store.removeItem(THEME_KEY);
    else store.setItem(THEME_KEY, choice);
  } catch {
    /* a blocked storage only costs the preference, not the app */
  }
}
