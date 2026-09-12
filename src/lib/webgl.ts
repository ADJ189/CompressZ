/**
 * webgl.ts — Single shared WebGL2 context for feature-detection purposes.
 *
 * Both platform.ts (device-tier scoring, GPU renderer string for the
 * Settings page) and gpu.ts (per-engine GPU-acceleration gating) need to
 * know "does this browser support WebGL2 at all". They used to each create
 * their own throwaway `<canvas>`/context for that check, which meant every
 * session opened two live WebGL contexts before either engine had actually
 * done any work. That matters because WebGL context budgets are a real,
 * fairly low ceiling on some browsers/devices (notably Safari, which has
 * historically capped a page around 8–16 simultaneous contexts before
 * evicting the oldest) — worth not spending two of them on detection alone.
 *
 * This module creates at most one context, lazily, on first use, and both
 * platform.ts and gpu.ts import from here instead of rolling their own.
 * Deliberately has zero imports itself so importing it can never create a
 * circular-dependency loop with platform.ts/settings.ts/gpu.ts.
 */

let _ctx: WebGL2RenderingContext | null | undefined; // undefined = not yet attempted

export function getSharedWebGL2Context(): WebGL2RenderingContext | null {
  if (_ctx !== undefined) return _ctx;
  try {
    const canvas =
      typeof OffscreenCanvas !== "undefined"
        ? new OffscreenCanvas(1, 1)
        : document.createElement("canvas");
    _ctx =
      ((canvas as any).getContext("webgl2") as WebGL2RenderingContext | null) ??
      null;
  } catch {
    _ctx = null;
  }
  return _ctx;
}

export function hasWebGL2(): boolean {
  return getSharedWebGL2Context() !== null;
}
