/**
 * router.ts — History API client router for CompressZ.
 *
 * Dispatches routes and syncs with currentRoute store for Svelte reactivity.
 */

import { currentRoute } from "./store";
import { trackRecent } from "./lib/recents";

type Handler = (params?: Record<string, string>) => void;
const handlers = new Map<string, Handler>();

const BASE: string = (import.meta as any).env?.BASE_URL ?? "/";
const BASE_NORM = BASE.endsWith("/") ? BASE : BASE + "/";

export function on(route: string, fn: Handler) {
  handlers.set(route, fn);
}

export function navigate(route: string, opts: { replace?: boolean } = {}) {
  if (opts.replace) history.replaceState({}, "", BASE_NORM + route);
  else history.pushState({}, "", BASE_NORM + route);
  dispatch(BASE_NORM + route);
}

export function getRouteFromPath(path: string): string {
  const cleanPath = path.split("?")[0].split("#")[0];
  const stripped = cleanPath.startsWith(BASE_NORM)
    ? cleanPath.slice(BASE_NORM.length)
    : cleanPath.replace(/^\//, "");
  return stripped.replace(/\/$/, "");
}

export function dispatch(path: string) {
  const route = getRouteFromPath(path);
  currentRoute.set(route);
  trackRecent(route);
  const handler = handlers.get(route) ?? handlers.get("*");
  handler?.();
}

export function init() {
  window.addEventListener("popstate", () => dispatch(location.pathname + location.search));
  document.addEventListener("click", (e) => {
    const el = (e.target as Element).closest(
      "[data-nav]",
    ) as HTMLElement | null;
    if (!el) return;
    if (
      e.defaultPrevented ||
      e.button !== 0 ||
      e.metaKey ||
      e.ctrlKey ||
      e.shiftKey ||
      e.altKey
    )
      return;
    const href = (el as HTMLAnchorElement).href;
    if (href && new URL(href, location.href).origin !== location.origin) return;
    e.preventDefault();
    navigate(el.dataset.nav ?? "");
  });
  dispatch(location.pathname);
}
