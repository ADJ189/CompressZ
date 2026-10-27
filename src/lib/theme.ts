/**
 * theme.ts — light / dark / follow-system appearance.
 *
 * The stored preference is one of `light`, `dark`, `system`. `data-theme` on
 * `<html>` always receives the *resolved* value (`light` or `dark`) so every
 * existing `[data-theme="dark"]` rule keeps working untouched. When the
 * preference is `system`, a live `prefers-color-scheme` listener re-applies it.
 *
 * Persisted key: `theme` (unchanged, so existing users keep their choice).
 * Nothing here touches the network or stores anything beyond the preference.
 */
export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_KEY = 'theme';
export const THEME_EVENT = 'cz-theme-change';

function darkQuery(): MediaQueryList | null {
  if (typeof window === 'undefined' || !window.matchMedia) return null;
  return window.matchMedia('(prefers-color-scheme: dark)');
}

export function getThemePreference(): ThemePreference {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  } catch {
    /* storage disabled — follow the system below */
  }
  return 'system';
}

export function resolveThemePreference(
  preference: ThemePreference = getThemePreference(),
): ResolvedTheme {
  if (preference === 'light' || preference === 'dark') return preference;
  return darkQuery()?.matches ? 'dark' : 'light';
}

/**
 * Apply a preference to the document and announce it so header/settings UI can
 * refresh their labels. Returns the resolved theme.
 */
export function applyThemePreference(
  preference: ThemePreference,
): ResolvedTheme {
  const resolved = resolveThemePreference(preference);
  document.documentElement.setAttribute('data-theme', resolved);
  try {
    localStorage.setItem(THEME_KEY, preference);
  } catch {
    /* ignore */
  }
  document.dispatchEvent(
    new CustomEvent(THEME_EVENT, { detail: { preference, resolved } }),
  );
  return resolved;
}

/** Flip between light and dark. Picking a side opts out of `system`. */
export function toggleTheme(): ResolvedTheme {
  const current = resolveThemePreference();
  return applyThemePreference(current === 'dark' ? 'light' : 'dark');
}

let started = false;

/** Apply the stored preference once and keep `system` in sync. */
export function initTheme(): ResolvedTheme {
  const resolved = applyThemePreference(getThemePreference());
  if (started) return resolved;
  started = true;
  const query = darkQuery();
  query?.addEventListener?.('change', () => {
    if (getThemePreference() === 'system') applyThemePreference('system');
  });
  return resolved;
}
