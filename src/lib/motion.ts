/**
 * motion.ts — Thin anime.js (v4) wrapper for the handful of places that
 * benefit from a real spring/easing animation instead of a CSS transition:
 * the new Smart Analyze results (file cards re-ordering + AI tag chips
 * popping in) and the new Settings sections (Device, Performance, AI
 * Engine) revealing themselves. Everything else in the app already has a
 * tuned CSS-transition system (see --t2/--t3/--ease-fluid in style.css) —
 * this is additive, not a replacement for it, and is dynamically imported
 * so idle page-loads never pay for it.
 *
 * `respectsMotionPreference` is checked on every call: prefers-reduced-motion
 * users get an instant, no-animation apply instead of being skipped
 * silently — the value still changes, just without motion.
 */
import { animate, stagger } from 'animejs';

function reduced(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/** Fade+rise a group of elements in with a slight stagger — used when a settings section or a batch of file cards first appears. */
export function revealStagger(els: Element[] | NodeListOf<Element>, opts: { delay?: number } = {}) {
  const list = Array.from(els);
  if (!list.length) return;
  if (reduced()) { list.forEach(el => ((el as HTMLElement).style.opacity = '1')); return; }
  animate(list, {
    opacity: [0, 1],
    translateY: [10, 0],
    duration: 420,
    delay: stagger(45, { start: opts.delay ?? 0 }),
    ease: 'outQuint',
  });
}

/** Single-element pop-in — used for a newly-applied AI tag chip. */
export function popIn(el: Element) {
  if (reduced()) return;
  animate(el, {
    scale: [0.6, 1],
    opacity: [0, 1],
    duration: 360,
    ease: 'outElastic(1, .6)',
  });
}

/** Pulse an element once — used to draw the eye to a card whose settings/order just changed. */
export function pulse(el: Element) {
  if (reduced()) return;
  animate(el, {
    scale: [1, 1.015, 1],
    duration: 420,
    ease: 'outQuad',
  });
}

/** Smoothly animate a progress bar's width to a new percentage (0-100). */
export function progressTo(el: Element, pct: number) {
  if (reduced()) { (el as HTMLElement).style.width = `${pct}%`; return; }
  animate(el, { width: `${pct}%`, duration: 260, ease: 'outCubic' });
}
