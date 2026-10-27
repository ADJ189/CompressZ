/**
 * recents.ts — pinned + recently-used tool lists for the home workbench.
 *
 * Kept dependency-free so `main.ts` can record a visit without pulling the
 * whole workbench/queue bundle into the initial chunk.
 *
 * localStorage keys: `cz-recent-tools`, `cz-favourite-tools`.
 * Only route names are stored — never file names or file contents.
 */
const RECENT_KEY = 'cz-recent-tools';
const FAVOURITE_KEY = 'cz-favourite-tools';
const MAX_RECENT = 5;

function readList(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === 'string')
      : [];
  } catch {
    return [];
  }
}

function writeList(key: string, list: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    /* storage disabled — the lists simply stay empty */
  }
}

export function getRecents(): string[] {
  return readList(RECENT_KEY);
}

export function getFavourites(): string[] {
  return readList(FAVOURITE_KEY);
}

/** Record a successful route visit. Home and unknown routes are ignored. */
export function trackRecent(route: string): void {
  if (!route || route === 'settings') return;
  const list = readList(RECENT_KEY).filter((r) => r !== route);
  list.unshift(route);
  writeList(RECENT_KEY, list.slice(0, MAX_RECENT));
}

export function toggleFavourite(route: string): boolean {
  const list = readList(FAVOURITE_KEY);
  const on = !list.includes(route);
  writeList(
    FAVOURITE_KEY,
    on ? [...list, route] : list.filter((r) => r !== route),
  );
  return on;
}
