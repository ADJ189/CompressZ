import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
} from "react";
import { cn } from "../utils/cn";
import { prefersReducedMotion } from "../utils/interaction";

export interface ScrambleTextProps extends Omit<
  ComponentPropsWithoutRef<"span">,
  "children"
> {
  /** The text that the animation resolves to. */
  text: string;
  /** When to play. `hover` also plays on keyboard focus within. */
  trigger?: "hover" | "mount" | "visible";
  /** Total time for the last character to lock in, in ms. */
  durationMs?: number;
  /** Characters cycled through before each position resolves. */
  chars?: string;
}

const DEFAULT_CHARS = "!<>-_\\/[]{}=+*^?#0123456789";
// How often the unresolved characters change. Redrawing every frame reads
// as static rather than as decoding.
const SWAP_MS = 45;

// Cheap deterministic pick so rendering stays pure and testable.
function pick(chars: string, i: number, tick: number): string {
  const n = Math.imul(i + 1, 374761393) ^ Math.imul(tick + 1, 668265263);
  const alphabet = chars || DEFAULT_CHARS;
  return alphabet[Math.abs(n ^ (n >>> 13)) % alphabet.length];
}

function maskText(text: string, chars: string): string {
  return Array.from(text, (ch, i) =>
    /\s/.test(ch) ? ch : pick(chars, i, 0),
  ).join("");
}

// Code points, not UTF-16 units: indexing a string splits emoji and other
// astral characters in half, which renders as replacement glyphs mid-scramble.

/**
 * Text that decodes itself, one character at a time. Screen readers get
 * the real string immediately; the scramble is visual only.
 *
 *     <ScrambleText text="Frontier-grade synergy" trigger="mount" />
 *
 * Uses the mono font by default because proportional fonts reflow as the
 * glyphs change width. Override `font-family` on `.pui-scramble__visual`
 * if you accept that.
 */
export function ScrambleText({
  text,
  trigger = "hover",
  durationMs = 700,
  chars = DEFAULT_CHARS,
  className,
  onPointerEnter,
  onFocus,
  ...rest
}: ScrambleTextProps) {
  // Start masked for triggers that play without a pointer, so the real
  // text never flashes for a frame before the scramble begins.
  const [shown, setShown] = useState(() =>
    trigger === "hover" ? text : maskText(text, chars),
  );
  const root = useRef<HTMLSpanElement>(null);
  const raf = useRef(0);

  const stop = useCallback(() => {
    cancelAnimationFrame(raf.current);
    raf.current = 0;
  }, []);

  const play = useCallback(() => {
    stop();
    if (prefersReducedMotion() || !text) {
      setShown(text);
      return;
    }
    const glyphs = Array.from(text);
    const n = glyphs.length;
    // Left to right with a little overlap, so the front of the resolve is ragged.
    const reveal = glyphs.map(
      (_, i) =>
        (i / Math.max(1, n)) * durationMs * 0.75 +
        ((i * 37) % 11) * (durationMs * 0.025),
    );
    const start = performance.now();
    const tick = (now: number) => {
      const t = now - start;
      const swap = Math.floor(t / SWAP_MS);
      let out = "";
      let done = true;
      for (let i = 0; i < n; i++) {
        const ch = glyphs[i];
        if (/\s/.test(ch) || t >= reveal[i]) out += ch;
        else {
          out += pick(chars, i, swap);
          done = false;
        }
      }
      setShown((prev) => (prev === out ? prev : out));
      raf.current = done ? 0 : requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }, [text, chars, durationMs, stop]);

  useEffect(() => {
    stop();
    if (trigger === "mount") play();
    else if (trigger === "hover" || prefersReducedMotion()) setShown(text);
    else setShown(maskText(text, chars));
    return stop;
  }, [trigger, text, chars, play, stop]);

  useEffect(() => {
    if (trigger !== "visible" || prefersReducedMotion()) return;
    const el = root.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setShown(text);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          play();
          io.disconnect();
        }
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [trigger, text, play]);

  return (
    <span
      ref={root}
      className={cn("pui-scramble", className)}
      onPointerEnter={(e) => {
        onPointerEnter?.(e);
        if (trigger === "hover" && !raf.current) play();
      }}
      onFocus={(e) => {
        onFocus?.(e);
        if (trigger === "hover" && !raf.current) play();
      }}
      {...rest}
    >
      <span className="pui-scramble__sr">{text}</span>
      <span className="pui-scramble__visual" aria-hidden>
        {shown}
      </span>
    </span>
  );
}
