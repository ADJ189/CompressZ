import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
} from "react";
import { cn } from "../utils/cn";
import { prefersReducedMotion } from "../utils/interaction";
import { Button } from "./Button";

export interface OversubscribedMeterProps extends Omit<
  ComponentPropsWithoutRef<"div">,
  "children"
> {
  /** Final subscription, in percent. Anything above 100 overflows the round. */
  target?: number;
  /** Name of the round. */
  label?: string;
  /** Size of the round in $M, used for the "committed" line. */
  raise?: number;
  /** `click` shows a button; `mount` and `visible` play on their own. */
  trigger?: "click" | "mount" | "visible";
  /** Time for the count to reach the target, in ms. */
  durationMs?: number;
}

const fmt = (n: number) => String(Math.round(n * 10) / 10);

/**
 * A funding round that was never going to stay under 100%. The 100% mark
 * is fixed on the track and everything past it is drawn in the hot color,
 * so the overflow reads as an achievement rather than a rendering bug.
 *
 *     <OversubscribedMeter target={340} raise={25} label="Series B" />
 *
 * With reduced motion it jumps straight to the final value.
 */
export function OversubscribedMeter({
  target = 340,
  label = "Series B",
  raise = 25,
  trigger = "click",
  durationMs = 1800,
  className,
  ...rest
}: OversubscribedMeterProps) {
  const goal = Number.isFinite(target) ? Math.max(0, target) : 0;
  const axisMax = Math.max(goal, 100);
  const over = goal > 100;

  const root = useRef<HTMLDivElement>(null);
  const raf = useRef(0);
  const [pct, setPct] = useState(0);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);

  const stop = useCallback(() => {
    cancelAnimationFrame(raf.current);
    raf.current = 0;
  }, []);

  const play = useCallback(() => {
    stop();
    setDone(false);
    if (prefersReducedMotion() || durationMs <= 0) {
      setPct(goal);
      setRunning(false);
      setDone(true);
      return;
    }
    setPct(0);
    setRunning(true);
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      setPct(Math.round(goal * (1 - Math.pow(1 - t, 3))));
      if (t < 1) {
        raf.current = requestAnimationFrame(tick);
      } else {
        raf.current = 0;
        setRunning(false);
        setDone(true);
      }
    };
    raf.current = requestAnimationFrame(tick);
  }, [goal, durationMs, stop]);

  // Reset whenever the inputs change, then start if this trigger plays itself.
  useEffect(() => {
    stop();
    setPct(0);
    setRunning(false);
    setDone(false);
    if (trigger === "mount") {
      play();
      return stop;
    }
    if (trigger === "visible") {
      const el = root.current;
      if (!el || typeof IntersectionObserver === "undefined") {
        play();
        return stop;
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
      return () => {
        io.disconnect();
        stop();
      };
    }
    return stop;
  }, [trigger, play, stop]);

  const base = Math.min(pct, 100);
  const extra = Math.max(pct - 100, 0);
  const crossed = over && pct >= 100;

  return (
    <div
      ref={root}
      className={cn("pui-meter", className)}
      data-over={crossed ? "true" : undefined}
      data-state={running ? "running" : done ? "done" : "idle"}
      {...rest}
    >
      <div className="pui-meter__head">
        <span className="pui-meter__label">{label}</span>
        <span className="pui-meter__pct" aria-hidden="true">
          {pct}%
        </span>
      </div>

      <div
        className={cn("pui-meter__track", over && "pui-meter__track--marked")}
        role="progressbar"
        aria-label={`${label} subscription`}
        aria-valuemin={0}
        aria-valuemax={axisMax}
        aria-valuenow={pct}
        aria-valuetext={`${pct}% subscribed`}
      >
        <div
          className="pui-meter__fill"
          style={{ width: `${(base / axisMax) * 100}%` }}
        />
        {over && (
          <>
            <div
              className="pui-meter__fill pui-meter__fill--over"
              style={{
                left: `${(100 / axisMax) * 100}%`,
                width: `${(extra / axisMax) * 100}%`,
              }}
            />
            <div
              className="pui-meter__tick"
              style={{ left: `${(100 / axisMax) * 100}%` }}
            />
          </>
        )}
      </div>

      <div className="pui-meter__foot">
        <span className="pui-meter__sum">
          ${fmt((raise * pct) / 100)}M committed of ${fmt(raise)}M
        </span>
        {done && over && (
          <span className="pui-meter__stamp">Oversubscribed</span>
        )}
        {trigger === "click" && (
          <Button
            variant="ghost"
            size="sm"
            onClick={play}
            disabled={running}
            className="pui-meter__btn"
          >
            {done ? "Replay" : "Close the round"}
          </Button>
        )}
      </div>
    </div>
  );
}
