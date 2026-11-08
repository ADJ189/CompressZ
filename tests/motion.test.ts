import { assert, assertEquals } from "./assert.ts";
import { revealStagger, popIn, pulse, progressTo, toastIn } from "../src/lib/motion.ts";

Deno.test("motion: handles empty array and headless calls safely", () => {
  revealStagger([]);
  assertEquals(true, true);
});

Deno.test("motion: progressTo updates element width", () => {
  const el = { style: { width: "0%" } } as unknown as HTMLElement;
  progressTo(el, 55);
  assertEquals(el.style.width, "55%");

  // Clamping
  progressTo(el, 150);
  assertEquals(el.style.width, "100%");
  progressTo(el, -20);
  assertEquals(el.style.width, "0%");
});

Deno.test("motion: WAAPI animations trigger safely when mock animate provided", () => {
  let popAnimated = false;
  let pulseAnimated = false;

  const mockEl = {
    style: {},
    animate: (_keyframes: unknown, options: unknown) => {
      assert(typeof options === "object");
      return {} as Animation;
    },
  } as unknown as HTMLElement;

  popIn({
    ...mockEl,
    animate: () => {
      popAnimated = true;
      return {} as Animation;
    },
  } as unknown as HTMLElement);

  pulse({
    ...mockEl,
    animate: () => {
      pulseAnimated = true;
      return {} as Animation;
    },
  } as unknown as HTMLElement);

  assert(popAnimated, "popIn should call animate");
  assert(pulseAnimated, "pulse should call animate");
});
