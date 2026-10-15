type Handler = () => void;
const handlers = new Map<string, Handler>();

// Derive the deployment base once (e.g. "/" on root, "/compressz/" on a sub-path).
// Vite injects BASE_URL at build time via import.meta.env (typed by vite/client).
const BASE: string = import.meta.env.BASE_URL ?? "/";
const BASE_NORM = BASE.endsWith("/") ? BASE : BASE + "/";

export function on(route: string, fn: Handler) {
  handlers.set(route, fn);
}

// `replace: true` swaps the current history entry instead of adding one — use it
// for redirects so the Back button doesn't bounce the user straight back to the
// redirecting URL.
export function navigate(route: string, opts: { replace?: boolean } = {}) {
  if (opts.replace) history.replaceState({}, "", BASE_NORM + route);
  else history.pushState({}, "", BASE_NORM + route);
  dispatch(BASE_NORM + route);
}

function dispatch(path: string) {
  // Strip the base prefix, then normalise leading/trailing slashes.
  const stripped = path.startsWith(BASE_NORM)
    ? path.slice(BASE_NORM.length)
    : path.replace(/^\//, "");
  const route = stripped.replace(/\/$/, "");
  const handler = handlers.get(route) ?? handlers.get("*");
  handler?.();
}

export function init() {
  window.addEventListener("popstate", () => dispatch(location.pathname));
  document.addEventListener("click", (e) => {
    const el = (e.target as Element).closest(
      "[data-nav]",
    ) as HTMLElement | null;
    if (!el) return;
    // Let the browser handle "open in new tab/window" gestures natively.
    if (
      e.defaultPrevented ||
      e.button !== 0 ||
      e.metaKey ||
      e.ctrlKey ||
      e.shiftKey ||
      e.altKey
    )
      return;
    // Don't intercept links to another origin. (Comparing origins rather than
    // `href.includes(hostname)`, which a URL like https://evil.test/?x=<host> passes.)
    const href = (el as HTMLAnchorElement).href;
    if (href && new URL(href, location.href).origin !== location.origin) return;
    e.preventDefault();
    navigate(el.dataset.nav ?? "");
  });
  dispatch(location.pathname);
}
