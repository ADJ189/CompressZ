import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  type ComponentPropsWithoutRef,
} from "react";
import { cn } from "../utils/cn";
import {
  assignRef,
  canHover,
  prefersReducedMotion,
} from "../utils/interaction";

export interface MagneticProps extends ComponentPropsWithoutRef<"span"> {
  /** How much of the pointer offset the element follows, 0 to 1. */
  strength?: number;
  /** Distance in px outside the element's edge where the pull begins. */
  radius?: number;
  /** Turn the effect off without unmounting. */
  disabled?: boolean;
}

/**
 * Wraps any element and pulls it toward the pointer as the cursor
 * approaches, then lets it spring back. The pull starts before the cursor
 * reaches the element, which is what makes it feel magnetic rather than
 * like a hover state.
 *
 *     <Magnetic>
 *       <Button variant="glow">Join the waitlist</Button>
 *     </Magnetic>
 *
 * Does nothing on touch-only devices or when the user prefers reduced motion.
 */
export const Magnetic = forwardRef<HTMLSpanElement, MagneticProps>(
  (
    { strength = 0.35, radius = 80, disabled, className, children, ...rest },
    ref,
  ) => {
    const local = useRef<HTMLSpanElement | null>(null);
    const setRefs = useCallback(
      (node: HTMLSpanElement | null) => {
        local.current = node;
        assignRef(ref, node);
      },
      [ref],
    );

    useEffect(() => {
      const el = local.current;
      if (!el || disabled || prefersReducedMotion() || !canHover()) return;

      let curX = 0;
      let curY = 0;
      let tx = 0;
      let ty = 0;
      let raf = 0;

      const step = () => {
        curX += (tx - curX) * 0.18;
        curY += (ty - curY) * 0.18;
        if (Math.abs(tx - curX) < 0.05 && Math.abs(ty - curY) < 0.05) {
          curX = tx;
          curY = ty;
          raf = 0;
        } else {
          raf = requestAnimationFrame(step);
        }
        el.style.transform = `translate3d(${curX}px, ${curY}px, 0)`;
      };
      const wake = () => {
        if (!raf) raf = requestAnimationFrame(step);
      };

      const onMove = (e: PointerEvent) => {
        // Hybrid laptops report canHover() but also deliver touch events.
        if (e.pointerType === "touch") return;
        const r = el.getBoundingClientRect();
        // The rect already includes our own translation. Subtract it so the
        // target is measured from the resting position; otherwise the pull
        // moves the element, which moves the centre, which moves the pull.
        const cx = r.left - curX + r.width / 2;
        const cy = r.top - curY + r.height / 2;
        const ex = Math.max(
          cx - r.width / 2 - e.clientX,
          0,
          e.clientX - (cx + r.width / 2),
        );
        const ey = Math.max(
          cy - r.height / 2 - e.clientY,
          0,
          e.clientY - (cy + r.height / 2),
        );
        if (Math.hypot(ex, ey) < radius) {
          tx = (e.clientX - cx) * strength;
          ty = (e.clientY - cy) * strength;
        } else {
          tx = 0;
          ty = 0;
        }
        wake();
      };
      const release = () => {
        tx = 0;
        ty = 0;
        wake();
      };
      const onOut = (e: PointerEvent) => {
        if (e.relatedTarget === null) release();
      };

      window.addEventListener("pointermove", onMove, { passive: true });
      document.addEventListener("pointerout", onOut);
      window.addEventListener("blur", release);
      return () => {
        window.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerout", onOut);
        window.removeEventListener("blur", release);
        cancelAnimationFrame(raf);
        el.style.transform = "";
      };
    }, [strength, radius, disabled]);

    return (
      <span ref={setRefs} className={cn("pui-magnetic", className)} {...rest}>
        {children}
      </span>
    );
  },
);
Magnetic.displayName = "Magnetic";
