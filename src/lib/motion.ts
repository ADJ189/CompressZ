/**
 * motion.ts — Native Web Animations API (WAAPI) and CSS transition helpers.
 *
 * Replaces external animation libraries with native browser primitives
 * (Element.animate), zero external dependencies, zero bundle weight,
 * and instant fallback when prefers-reduced-motion is active.
 *
 * Rules:
 *   - Only animate transform and opacity. Never animate width, height, top, or left.
 *   - Respect prefers-reduced-motion: reduce on every call: apply end-state instantly.
 *   - Animations cancel cleanly when elements or components are unmounted.
 */

function reduced(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches)
  );
}

/** Fade and rise a group of elements in with a slight stagger. */
export function revealStagger(
  els: Element[] | NodeListOf<Element>,
  opts: { delay?: number } = {},
): void {
  const list = Array.from(els);
  if (!list.length) return;
  if (reduced()) {
    for (const el of list) {
      (el as HTMLElement).style.opacity = "1";
      (el as HTMLElement).style.transform = "none";
    }
    return;
  }

  const baseDelay = opts.delay ?? 0;
  list.forEach((el, index) => {
    el.animate(
      [
        { opacity: "0", transform: "translateY(8px)" },
        { opacity: "1", transform: "translateY(0)" },
      ],
      {
        duration: 320,
        delay: baseDelay + index * 40,
        easing: "cubic-bezier(0.16, 1, 0.3, 1)",
        fill: "forwards",
      },
    );
  });
}

/** Single-element pop-in for badges and chips. */
export function popIn(el: Element): void {
  if (reduced()) {
    (el as HTMLElement).style.opacity = "1";
    (el as HTMLElement).style.transform = "none";
    return;
  }
  el.animate(
    [
      { opacity: "0", transform: "scale(0.85)" },
      { opacity: "1", transform: "scale(1)" },
    ],
    {
      duration: 280,
      easing: "cubic-bezier(0.34, 1.56, 0.64, 1)",
      fill: "forwards",
    },
  );
}

/** Subtle pulse to draw attention to a card or status without jarring motion. */
export function pulse(el: Element): void {
  if (reduced()) return;
  el.animate(
    [
      { transform: "scale(1)" },
      { transform: "scale(1.02)" },
      { transform: "scale(1)" },
    ],
    {
      duration: 340,
      easing: "ease-in-out",
    },
  );
}

/** Smoothly update progress percentage on a bar element. */
export function progressTo(el: Element, pct: number): void {
  const clamped = Math.max(0, Math.min(100, pct));
  const htmlEl = el as HTMLElement;
  if (reduced()) {
    htmlEl.style.width = `${clamped}%`;
    return;
  }
  htmlEl.style.transition = "width 240ms cubic-bezier(0.2, 0, 0, 1)";
  htmlEl.style.width = `${clamped}%`;
}

/** Pop a toast notice into view. */
export function toastIn(el: Element): void {
  if (reduced()) {
    (el as HTMLElement).style.opacity = "1";
    (el as HTMLElement).style.transform = "none";
    return;
  }
  el.animate(
    [
      { opacity: "0", transform: "translateY(12px) scale(0.96)" },
      { opacity: "1", transform: "translateY(0) scale(1)" },
    ],
    {
      duration: 260,
      easing: "cubic-bezier(0.16, 1, 0.3, 1)",
      fill: "forwards",
    },
  );
}

/** Fade out and dismiss a toast notice. Resolves when the animation completes. */
export function toastOut(el: Element): Promise<void> {
  if (reduced()) {
    (el as HTMLElement).style.opacity = "0";
    return Promise.resolve();
  }
  const anim = el.animate(
    [
      { opacity: "1", transform: "translateY(0)" },
      { opacity: "0", transform: "translateY(6px)" },
    ],
    {
      duration: 200,
      easing: "ease-in",
      fill: "forwards",
    },
  );
  return new Promise<void>((resolve) => {
    anim.onfinish = () => resolve();
    anim.oncancel = () => resolve();
  });
}
