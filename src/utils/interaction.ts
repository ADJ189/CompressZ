import type { MutableRefObject, Ref } from "react";

// Cached because these are called from pointermove handlers. Creating a
// MediaQueryList per event allocates on the hottest path in the library.
// `.matches` stays live, so a mid-session settings change is still seen.
const cache = new Map<string, MediaQueryList>();
function matches(query: string): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  let mql = cache.get(query);
  if (mql === undefined) {
    mql = window.matchMedia(query);
    cache.set(query, mql);
  }
  return mql.matches;
}

/** True when the user has asked their OS or browser to minimise motion. */
export function prefersReducedMotion(): boolean {
  return matches("(prefers-reduced-motion: reduce)");
}

/** True for a real hover-capable pointer (mouse, trackpad). False on touch-only devices. */
export function canHover(): boolean {
  return matches("(hover: hover) and (pointer: fine)");
}

/** Assign a node to a callback ref or a ref object. Lets a component keep its own ref and still forward one. */
export function assignRef<T>(ref: Ref<T> | undefined, node: T | null): void {
  if (typeof ref === "function") ref(node);
  else if (ref) (ref as MutableRefObject<T | null>).current = node;
}
