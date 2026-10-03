import {
  useEffect,
  useRef,
  type ComponentPropsWithoutRef,
} from "react";
import { cn } from "../utils/cn";
import { prefersReducedMotion } from "../utils/interaction";

export interface CursorTrailProps extends ComponentPropsWithoutRef<"div"> {
  /** Character drawn for each particle. Pass an empty string for plain dots. */
  glyph?: string;
  /** Spawn a radial burst on pointer down. */
  burst?: boolean;
  /** Pixels of pointer travel between particles. Lower is denser. */
  spacing?: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  rot: number;
  spin: number;
  color: string;
}

const MAX_PARTICLES = 160;
const FALLBACK = ["#7c3aed", "#ec4899", "#06b6d4"];

/**
 * Leaves a fading trail of glyphs behind the pointer inside its box.
 * The animation loop only runs while particles are alive, so an idle
 * trail costs nothing.
 *
 *     <CursorTrail style={{ height: 320 }}>
 *       <h2>Move fast and ship tokens</h2>
 *     </CursorTrail>
 *
 * Particle colors come from the `--pui-grad-*` tokens. Renders nothing
 * extra when the user prefers reduced motion.
 */
export function CursorTrail({
  glyph = "\u2726",
  burst = true,
  spacing = 18,
  className,
  children,
  ...rest
}: CursorTrailProps) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const host = box.current;
    const cv = canvas.current;
    const ctx = cv?.getContext("2d");
    if (!host || !cv || !ctx || prefersReducedMotion()) return;

    const particles: Particle[] = [];
    let colors = FALLBACK;
    let w = 0;
    let h = 0;
    let raf = 0;
    let last = 0;
    let lastX = 0;
    let lastY = 0;
    let acc = 0;
    let hasLast = false;

    const readColors = () => {
      const cs = getComputedStyle(host);
      const read = ["--pui-grad-from", "--pui-grad-mid", "--pui-grad-to"].map(
        (name, i) => cs.getPropertyValue(name).trim() || FALLBACK[i],
      );
      colors = read;
    };

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      w = host.clientWidth;
      h = host.clientHeight;
      cv.width = Math.max(1, Math.round(w * dpr));
      cv.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const spawn = (x: number, y: number, speed: number, angle?: number) => {
      if (particles.length >= MAX_PARTICLES) particles.shift();
      const a = angle ?? Math.random() * Math.PI * 2;
      const v = speed * (0.4 + Math.random() * 0.6);
      particles.push({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        life: 0,
        max: 38 + Math.random() * 28,
        size: 9 + Math.random() * 10,
        rot: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 0.12,
        color: colors[Math.floor(Math.random() * colors.length)],
      });
    };

    const frame = (now: number) => {
      const dt = Math.min(3, (now - last) / 16.667 || 1);
      last = now;
      ctx.clearRect(0, 0, w, h);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life += dt;
        if (p.life >= p.max) {
          particles.splice(i, 1);
          continue;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 0.03 * dt;
        p.vx *= 0.985;
        p.rot += p.spin * dt;
        const t = 1 - p.life / p.max;
        ctx.globalAlpha = t;
        ctx.fillStyle = p.color;
        if (glyph) {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.font = `${p.size * (0.5 + t * 0.5)}px sans-serif`;
          ctx.fillText(glyph, 0, 0);
          ctx.restore();
        } else {
          ctx.beginPath();
          ctx.arc(p.x, p.y, (p.size / 3) * (0.5 + t * 0.5), 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      raf = particles.length ? requestAnimationFrame(frame) : 0;
    };
    const wake = () => {
      if (!raf) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };

    const local = (e: PointerEvent) => {
      const r = host.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    const onEnter = () => {
      readColors();
      hasLast = false;
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const { x, y } = local(e);
      if (!hasLast) {
        lastX = x;
        lastY = y;
        hasLast = true;
        return;
      }
      acc += Math.hypot(x - lastX, y - lastY);
      lastX = x;
      lastY = y;
      let n = 0;
      while (acc >= spacing && n++ < 4) {
        acc -= spacing;
        spawn(x, y, 0.5);
      }
      if (n >= 4) acc = 0;
      wake();
    };
    const onDown = (e: PointerEvent) => {
      if (!burst) return;
      const { x, y } = local(e);
      const count = 14;
      for (let i = 0; i < count; i++) {
        spawn(x, y, 2.4, (i / count) * Math.PI * 2 + Math.random() * 0.3);
      }
      wake();
    };
    const onLeave = () => {
      hasLast = false;
      acc = 0;
    };

    readColors();
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    host.addEventListener("pointerenter", onEnter);
    host.addEventListener("pointermove", onMove);
    host.addEventListener("pointerdown", onDown);
    host.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(raf);
      // Without this the last drawn frame stays on the canvas, frozen,
      // when props change mid-animation.
      ctx.clearRect(0, 0, cv.width, cv.height);
      ro.disconnect();
      host.removeEventListener("pointerenter", onEnter);
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerdown", onDown);
      host.removeEventListener("pointerleave", onLeave);
    };
  }, [glyph, burst, spacing]);

  return (
    <div ref={box} className={cn("pui-cursor-trail", className)} {...rest}>
      {children}
      <canvas ref={canvas} className="pui-cursor-trail__canvas" aria-hidden />
    </div>
  );
}
