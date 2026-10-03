import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "../utils/cn";

export interface CommandItem {
  id: string;
  label: string;
  /** Section heading. Only shown while the query is empty. */
  group?: string;
  /** Small right-aligned text, shown when there is no shortcut. */
  hint?: string;
  /** Extra search terms that do not appear in the label. */
  keywords?: string[];
  /** Key caps drawn on the right, e.g. `["G", "H"]`. Display only. */
  shortcut?: string[];
  onSelect?: () => void;
}

export interface CommandPaletteProps {
  items: CommandItem[];
  /** Controlled open state. Omit to let the palette manage itself. */
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Toggle on Cmd+K / Ctrl+K. */
  hotkey?: boolean;
  placeholder?: string;
  emptyText?: string;
  className?: string;
}

interface Match {
  item: CommandItem;
  indices: number[];
}

/**
 * Case- and accent-fold one code point, guaranteeing the result has the same
 * UTF-16 length so highlight indices computed on folded text line up with
 * the original label. Lowercasing a whole string cannot promise that
 * ("\u0130" lowercases to two units), which is why this works per character.
 */
function fold(ch: string): string {
  const base = Array.from(ch.normalize("NFD"))[0] ?? ch;
  const lower = base.toLowerCase();
  if (lower.length === ch.length) return lower;
  const plain = ch.toLowerCase();
  return plain.length === ch.length ? plain : ch;
}

/**
 * Subsequence match with a few bonuses: consecutive runs, word starts, and
 * earlier hits. Returns the matched UTF-16 indices so the label can be
 * highlighted. Null when the query is not a subsequence of the text.
 */
function fuzzy(
  query: string,
  text: string,
): { score: number; indices: number[] } | null {
  const t = Array.from(text, fold).join("");
  const indices: number[] = [];
  let from = 0;
  let prevEnd = -2;
  let score = 0;
  for (const raw of Array.from(query)) {
    if (/\s/.test(raw)) continue;
    const ch = fold(raw);
    const at = t.indexOf(ch, from);
    if (at < 0) return null;
    for (let k = 0; k < ch.length; k++) indices.push(at + k);
    score += 1;
    if (at === prevEnd + 1) score += 3;
    if (at === 0 || /[\s\-_/.]/.test(t[at - 1])) score += 2;
    score -= (at - from) * 0.05;
    prevEnd = at + ch.length - 1;
    from = at + ch.length;
  }
  return { score: score - t.length * 0.01, indices };
}

function rank(items: CommandItem[], query: string): Match[] {
  const q = query.trim();
  if (!q) return items.map((item) => ({ item, indices: [] }));
  const scored: (Match & { score: number; order: number })[] = [];
  items.forEach((item, order) => {
    const hit = fuzzy(q, item.label);
    if (hit) {
      scored.push({ item, indices: hit.indices, score: hit.score + 10, order });
      return;
    }
    const kw = item.keywords?.length ? fuzzy(q, item.keywords.join(" ")) : null;
    if (kw) scored.push({ item, indices: [], score: kw.score, order });
  });
  scored.sort((a, b) => b.score - a.score || a.order - b.order);
  return scored;
}

function Highlighted({ text, indices }: { text: string; indices: number[] }) {
  if (!indices.length) return <>{text}</>;
  const on = new Set(indices);
  const runs: { s: string; hit: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const hit = on.has(i);
    const last = runs[runs.length - 1];
    if (last && last.hit === hit) last.s += text[i];
    else runs.push({ s: text[i], hit });
  }
  return (
    <>
      {runs.map((r, i) =>
        r.hit ? (
          <mark key={i} className="pui-cmd__mark">
            {r.s}
          </mark>
        ) : (
          <Fragment key={i}>{r.s}</Fragment>
        ),
      )}
    </>
  );
}

/**
 * Cmd+K palette. Fuzzy search with highlighted matches, arrow-key
 * navigation, and a highlight that slides between rows instead of
 * snapping. Rendered in a portal, with focus trapped in the input and
 * restored to whatever had it when the palette closes.
 *
 *     <CommandPalette
 *       items={[{ id: "pivot", label: "Pivot to AI", shortcut: ["P"] }]}
 *     />
 *
 * Cmd/Ctrl+K toggles it. Mount only one palette with `hotkey` enabled.
 */
export function CommandPalette({
  items,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  hotkey = true,
  placeholder = "Type a command or search...",
  emptyText = "No results. Have you tried a larger model?",
  className,
}: CommandPaletteProps) {
  const controlled = openProp !== undefined;
  const [inner, setInner] = useState(defaultOpen);
  const open = controlled ? openProp : inner;
  const openRef = useRef(open);
  openRef.current = open;

  const setOpen = useCallback(
    (next: boolean) => {
      if (!controlled) setInner(next);
      onOpenChange?.(next);
    },
    [controlled, onOpenChange],
  );

  // Mount while open, plus a beat after closing so the exit can play.
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (open) {
      setMounted(true);
      let r2 = 0;
      const r1 = requestAnimationFrame(() => {
        r2 = requestAnimationFrame(() => setShown(true));
      });
      return () => {
        cancelAnimationFrame(r1);
        cancelAnimationFrame(r2);
      };
    }
    setShown(false);
    const t = window.setTimeout(() => setMounted(false), 200);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!hotkey) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (
        (e.metaKey || e.ctrlKey) &&
        !e.altKey &&
        e.key.toLowerCase() === "k"
      ) {
        e.preventDefault();
        setOpen(!openRef.current);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hotkey, setOpen]);

  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const hlRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<(HTMLDivElement | null)[]>([]);
  const returnFocus = useRef<HTMLElement | null>(null);
  const lastPointer = useRef({ x: -1, y: -1 });
  const uid = useId();

  // Fresh state each time it opens; remember who had focus, give it back on close.
  useEffect(() => {
    if (!open) return;
    returnFocus.current = document.activeElement as HTMLElement | null;
    setQuery("");
    setActive(0);
    return () => {
      const el = returnFocus.current;
      if (el && el.isConnected) el.focus({ preventScroll: true });
    };
  }, [open]);

  useEffect(() => {
    if (mounted && open) inputRef.current?.focus();
  }, [mounted, open]);

  // Lock page scroll while open. Hiding the scrollbar widens the layout, so
  // pad the body by the scrollbar's width or the page jumps sideways.
  useEffect(() => {
    if (!mounted) return;
    const { overflow, paddingRight } = document.body.style;
    const gap = window.innerWidth - document.documentElement.clientWidth;
    if (gap > 0) {
      const current =
        parseFloat(getComputedStyle(document.body).paddingRight) || 0;
      document.body.style.paddingRight = `${current + gap}px`;
    }
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
      document.body.style.paddingRight = paddingRight;
    };
  }, [mounted]);

  const results = useMemo(() => rank(items, query), [items, query]);
  const count = results.length;
  const idx = count ? Math.min(active, count - 1) : -1;

  // Slide the highlight to the active row and keep that row in view.
  useLayoutEffect(() => {
    const hl = hlRef.current;
    const list = listRef.current;
    const row = idx >= 0 ? optionRefs.current[idx] : null;
    if (!hl || !list) return;
    if (!row) {
      hl.style.opacity = "0";
      return;
    }
    hl.style.opacity = "1";
    hl.style.height = `${row.offsetHeight}px`;
    hl.style.transform = `translateY(${row.offsetTop}px)`;
    if (idx === 0) {
      list.scrollTop = 0;
    } else if (row.offsetTop < list.scrollTop) {
      list.scrollTop = row.offsetTop;
    } else if (
      row.offsetTop + row.offsetHeight >
      list.scrollTop + list.clientHeight
    ) {
      list.scrollTop = row.offsetTop + row.offsetHeight - list.clientHeight;
    }
  }, [idx, results, mounted]);

  const choose = (item: CommandItem) => {
    setOpen(false);
    item.onSelect?.();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    } else if (e.key === "ArrowDown" && count) {
      e.preventDefault();
      setActive((idx + 1) % count);
    } else if (e.key === "ArrowUp" && count) {
      e.preventDefault();
      setActive((idx - 1 + count) % count);
    } else if (e.key === "Enter" && !e.nativeEvent.isComposing && idx >= 0) {
      e.preventDefault();
      choose(results[idx].item);
    } else if (e.key === "Tab") {
      // Focus stays in the input while the palette is open.
      e.preventDefault();
    }
  };

  if (!mounted || typeof document === "undefined") return null;

  const listId = `${uid}-list`;
  const optId = (i: number) => `${uid}-opt-${i}`;
  const grouped = !query.trim();
  optionRefs.current.length = count;

  // Rows are flat for keyboard purposes; headings are only decoration.
  const sections: { name?: string; rows: { m: Match; i: number }[] }[] = [];
  results.forEach((m, i) => {
    const name = grouped ? m.item.group : undefined;
    const last = sections[sections.length - 1];
    if (last && last.name === name) last.rows.push({ m, i });
    else sections.push({ name, rows: [{ m, i }] });
  });

  const renderRow = ({ m, i }: { m: Match; i: number }) => (
    <div
      key={m.item.id}
      ref={(el) => {
        optionRefs.current[i] = el;
      }}
      id={optId(i)}
      role="option"
      aria-selected={i === idx}
      data-active={i === idx ? "true" : undefined}
      className="pui-cmd__row"
      style={{ "--i": Math.min(i, 8) } as CSSProperties}
      onMouseDown={(e: MouseEvent) => e.preventDefault()}
      onPointerMove={(e: PointerEvent) => {
        const p = lastPointer.current;
        if (p.x === e.clientX && p.y === e.clientY) return;
        lastPointer.current = { x: e.clientX, y: e.clientY };
        if (i !== idx) setActive(i);
      }}
      onClick={() => choose(m.item)}
    >
      <span className="pui-cmd__label">
        <Highlighted text={m.item.label} indices={m.indices} />
      </span>
      {m.item.shortcut?.length ? (
        <span className="pui-cmd__keys" aria-hidden="true">
          {m.item.shortcut.map((k, n) => (
            <kbd key={n} className="pui-cmd__kbd">
              {k}
            </kbd>
          ))}
        </span>
      ) : m.item.hint || (!grouped && m.item.group) ? (
        <span className="pui-cmd__hint">{m.item.hint ?? m.item.group}</span>
      ) : null}
    </div>
  );

  return createPortal(
    <div
      className="pui-cmd-overlay"
      data-shown={shown ? "true" : undefined}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className={cn("pui-cmd", className)}
        onKeyDown={onKeyDown}
        // Clicking dead space inside the dialog must not steal focus from the input.
        onMouseDown={(e) => {
          if (e.target !== inputRef.current) e.preventDefault();
        }}
      >
        <input
          ref={inputRef}
          className="pui-cmd__input"
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={idx >= 0 ? optId(idx) : undefined}
          aria-autocomplete="list"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder={placeholder}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
        />
        <div ref={listRef} id={listId} role="listbox" className="pui-cmd__list">
          <div ref={hlRef} className="pui-cmd__hl" aria-hidden="true" />
          {count === 0 ? (
            <div className="pui-cmd__empty" role="presentation">
              {emptyText}
            </div>
          ) : (
            sections.map((s, n) =>
              s.name ? (
                <div
                  key={`g${n}`}
                  role="group"
                  aria-labelledby={`${uid}-g${n}`}
                  className="pui-cmd__group"
                >
                  <div id={`${uid}-g${n}`} className="pui-cmd__heading">
                    {s.name}
                  </div>
                  {s.rows.map(renderRow)}
                </div>
              ) : (
                <Fragment key={`g${n}`}>{s.rows.map(renderRow)}</Fragment>
              ),
            )
          )}
        </div>
        <div className="pui-cmd__foot" aria-hidden="true">
          <span>
            <kbd className="pui-cmd__kbd">{"\u2191"}</kbd>
            <kbd className="pui-cmd__kbd">{"\u2193"}</kbd> navigate
          </span>
          <span>
            <kbd className="pui-cmd__kbd">{"\u21B5"}</kbd> select
          </span>
          <span>
            <kbd className="pui-cmd__kbd">esc</kbd> close
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
