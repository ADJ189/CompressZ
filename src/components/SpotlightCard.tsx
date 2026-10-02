import {
  forwardRef,
  useCallback,
  useRef,
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type PointerEvent,
} from "react";
import { cn } from "../utils/cn";
import { assignRef } from "../utils/interaction";

export interface SpotlightCardProps extends ComponentPropsWithoutRef<"div"> {
  /** Radius of the light, in px. */
  radius?: number;
  /** Also light the border on the side facing the pointer. */
  edge?: boolean;
}

/**
 * Card with a light source that follows the pointer. One pointermove
 * handler writes two CSS variables; the gradients read them, so moving
 * the mouse never re-renders React.
 *
 *     <SpotlightCard>
 *       <h3>Reason</h3>
 *       <p>Multi-step, multi-modal, multi-vendor.</p>
 *     </SpotlightCard>
 */
export const SpotlightCard = forwardRef<HTMLDivElement, SpotlightCardProps>(
  (
    {
      radius = 320,
      edge = true,
      className,
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
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty("--pui-spot-x", `${e.clientX - r.left}px`);
      el.style.setProperty("--pui-spot-y", `${e.clientY - r.top}px`);
      el.dataset.active = "true";
    };

    const handleLeave = (e: PointerEvent<HTMLDivElement>) => {
      onPointerLeave?.(e);
      delete local.current?.dataset.active;
    };

    return (
      <div
        ref={setRefs}
        className={cn(
          "pui-spotlight",
          edge && "pui-spotlight--edge",
          className,
        )}
        style={{ "--pui-spot-r": `${radius}px`, ...style } as CSSProperties}
        onPointerMove={handleMove}
        onPointerLeave={handleLeave}
        {...rest}
      >
        {children}
      </div>
    );
  },
);
SpotlightCard.displayName = "SpotlightCard";
