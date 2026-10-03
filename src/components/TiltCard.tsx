import {
  forwardRef,
  useCallback,
  useRef,
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type PointerEvent,
} from "react";
import { cn } from "../utils/cn";
import { assignRef, prefersReducedMotion } from "../utils/interaction";

export interface TiltCardProps extends ComponentPropsWithoutRef<"div"> {
  /** Maximum tilt in degrees on each axis. */
  max?: number;
  /** Scale applied while the pointer is over the card. */
  scale?: number;
  /** Specular glare that follows the pointer. */
  glare?: boolean;
  /** CSS perspective distance in px. Lower is more dramatic. */
  perspective?: number;
  /** Extra class for the tilting surface (the outer element takes `className`). */
  surfaceClassName?: string;
}

/**
 * Card that leans toward the pointer in 3D, with an optional glare.
 *
 * The outer element receives pointer events and never moves; only the
 * inner surface is transformed. Measuring a rotated element feeds its own
 * motion back into the tilt math and makes the edges flicker.
 *
 *     <TiltCard max={12}>
 *       <h3>Frontier access</h3>
 *     </TiltCard>
 */
export const TiltCard = forwardRef<HTMLDivElement, TiltCardProps>(
  (
    {
      max = 10,
      scale = 1.03,
      glare = true,
      perspective = 900,
      className,
      surfaceClassName,
      style,
      onPointerMove,
      onPointerLeave,
      children,
      ...rest
    },
    ref,
  ) => {
    const local = useRef<HTMLDivElement | null>(null);
    const setRefs = useCallback(
      (node: HTMLDivElement | null) => {
        local.current = node;
        assignRef(ref, node);
      },
      [ref],
    );

    const handleMove = (e: PointerEvent<HTMLDivElement>) => {
      onPointerMove?.(e);
      const el = local.current;
      if (!el || e.pointerType === "touch" || prefersReducedMotion()) return;
      const r = el.getBoundingClientRect();
      const px = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      const py = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
      el.style.setProperty("--pui-tilt-rx", `${(0.5 - py) * 2 * max}deg`);
      el.style.setProperty("--pui-tilt-ry", `${(px - 0.5) * 2 * max}deg`);
      el.style.setProperty("--pui-tilt-gx", `${px * 100}%`);
      el.style.setProperty("--pui-tilt-gy", `${py * 100}%`);
      el.dataset.active = "true";
    };

    const handleLeave = (e: PointerEvent<HTMLDivElement>) => {
      onPointerLeave?.(e);
      const el = local.current;
      if (!el) return;
      delete el.dataset.active;
      el.style.removeProperty("--pui-tilt-rx");
      el.style.removeProperty("--pui-tilt-ry");
    };

    return (
      <div
        ref={setRefs}
        className={cn("pui-tilt", className)}
        style={
          {
            "--pui-tilt-scale": scale,
            "--pui-tilt-perspective": `${perspective}px`,
            ...style,
          } as CSSProperties
        }
        onPointerMove={handleMove}
        onPointerLeave={handleLeave}
        {...rest}
      >
        <div
          className={cn(
            "pui-tilt__surface",
            glare && "pui-tilt__surface--glare",
            surfaceClassName,
          )}
        >
          {children}
        </div>
      </div>
    );
  },
);
TiltCard.displayName = "TiltCard";
