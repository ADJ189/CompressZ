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
export type ColorScheme = 'polished' | 'origin' | 'blood-moon';

export const THEME_KEY = 'theme';
export const THEME_EVENT = 'cz-theme-change';
export const COLOR_SCHEME_KEY = 'cz-color-scheme';
export const COLOR_SCHEME_EVENT = 'cz-color-scheme-change';

export function getColorScheme(): ColorScheme {
  try {
    const raw = localStorage.getItem(COLOR_SCHEME_KEY);
    if (raw === 'polished' || raw === 'origin' || raw === 'blood-moon') return raw;
  } catch {
    /* storage disabled */
  }
  return 'polished';
}

export function setColorScheme(scheme: ColorScheme): ColorScheme {
  const chosen: ColorScheme =
    scheme === 'origin' || scheme === 'blood-moon' ? scheme : 'polished';
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-color-scheme', chosen);
  }
  try {
    localStorage.setItem(COLOR_SCHEME_KEY, chosen);
  } catch {
    /* ignore */
  }
  if (typeof document !== 'undefined') {
    document.dispatchEvent(
      new CustomEvent(COLOR_SCHEME_EVENT, { detail: { scheme: chosen } }),
    );
  }
  return chosen;
}

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

export const setThemePreference = applyThemePreference;

/** Flip between light and dark. Picking a side opts out of `system`. */
export function toggleTheme(): ResolvedTheme {
  const current = resolveThemePreference();
  return applyThemePreference(current === 'dark' ? 'light' : 'dark');
}

let started = false;

/** Apply the stored preference once and keep `system` in sync. */
export function initTheme(): ResolvedTheme {
  setColorScheme(getColorScheme());
  const resolved = applyThemePreference(getThemePreference());
  if (started) return resolved;
  started = true;
  const query = darkQuery();
  query?.addEventListener?.('change', () => {
    if (getThemePreference() === 'system') applyThemePreference('system');
  });
  return resolved;
}