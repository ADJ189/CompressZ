<script lang="ts">
  import { onMount, tick } from "svelte";
  import UniversalUpload from "./UniversalUpload.svelte";
  import MacIcon from "./MacIcon.svelte";

  export interface HubToolItem {
    id: string;
    name: string;
    icon: string;
    desc?: string;
  }

  interface Props {
    title: string;
    description: string;
    icon: string;
    tools: HubToolItem[];
    activeToolId?: string;
    onSelectTool?: (toolId: string) => void;
  }

  let {
    title,
    description,
    icon,
    tools,
    activeToolId = "",
    onSelectTool,
  }: Props = $props();

  let tablistEl: HTMLElement | undefined = $state();
  let hasScrolledInitial = false;

  async function scrollActiveChipIntoView(instant = false) {
    await tick();
    const list = tablistEl;
    if (!list || list.scrollWidth <= list.clientWidth) return;

    const activeChip = list.querySelector<HTMLElement>(".cz-hub-tool-chip.is-active");
    if (!activeChip) return;

    const listRect = list.getBoundingClientRect();
    const chipRect = activeChip.getBoundingClientRect();
    const chipLeftInScroll = chipRect.left - listRect.left + list.scrollLeft;
    const maxScroll = Math.max(0, list.scrollWidth - list.clientWidth);
    const targetScroll = Math.min(
      maxScroll,
      Math.max(0, chipLeftInScroll - (list.clientWidth - chipRect.width) / 2),
    );

    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (instant || prefersReducedMotion) {
      list.scrollLeft = targetScroll;
    } else {
      list.scrollTo({ left: targetScroll, behavior: "smooth" });
    }
  }

  onMount(() => {
    let destroyed = false;
    void scrollActiveChipIntoView(true);
    const onResize = () => {
      if (!destroyed) void scrollActiveChipIntoView(true);
    };
    window.addEventListener("resize", onResize, { passive: true });
    if (typeof document !== "undefined" && document.fonts) {
      document.fonts.addEventListener?.("loadingdone", onResize);
      if (document.fonts.ready) {
        void document.fonts.ready.then(onResize);
      }
    }
    return () => {
      destroyed = true;
      window.removeEventListener("resize", onResize);
      if (typeof document !== "undefined" && document.fonts) {
        document.fonts.removeEventListener?.("loadingdone", onResize);
      }
    };
  });

  $effect(() => {
    const _list = tablistEl;
    const _tools = tools;
    if (!_list || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      void scrollActiveChipIntoView(true);
    });
    ro.observe(_list);
    for (const chip of _list.querySelectorAll<HTMLElement>(".cz-hub-tool-chip")) {
      ro.observe(chip);
    }
    return () => ro.disconnect();
  });

  $effect(() => {
    const _tool = activeToolId;
    const _list = tablistEl;
    if (!_list) return;
    const instant = !hasScrolledInitial;
    hasScrolledInitial = true;
    void scrollActiveChipIntoView(instant);
  });

  function handleTabKeydown(e: KeyboardEvent, idx: number) {
    if (!tools.length) return;
    let nextIdx = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      nextIdx = (idx + 1) % tools.length;
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      nextIdx = (idx - 1 + tools.length) % tools.length;
    } else if (e.key === "Home") {
      nextIdx = 0;
    } else if (e.key === "End") {
      nextIdx = tools.length - 1;
    }
    if (nextIdx >= 0) {
      e.preventDefault();
      const btns = tablistEl?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
      btns?.[nextIdx]?.focus();
    }
  }
</script>

<div class="cz-hub-banner">
  <div class="cz-hub-main">
    <div class="cz-hub-heading">
      <span class="cz-hub-icon" aria-hidden="true">
        {#if /^[a-z0-9_-]+$/.test(icon)}
          <MacIcon name={icon} size={22} />
        {:else if icon === "📄"}
          <MacIcon name="pdf" size={22} />
        {:else if icon === "🔄"}
          <MacIcon name="convert" size={22} />
        {:else}
          {icon}
        {/if}
      </span>
      <div>
        <h1 class="cz-hub-title">{title}</h1>
        <p class="cz-hub-desc">{description}</p>
      </div>
    </div>

    <div class="cz-hub-tools-row" role="tablist" aria-label="{title} tools" bind:this={tablistEl}>
      {#each tools as tool, idx}
        <button
          type="button"
          class="cz-hub-tool-chip {activeToolId === tool.id ? 'is-active' : ''}"
          role="tab"
          aria-selected={activeToolId === tool.id}
          tabindex={activeToolId === tool.id ? 0 : -1}
          onclick={() => onSelectTool?.(tool.id)}
          onkeydown={(e) => handleTabKeydown(e, idx)}
        >
          <span class="cz-hub-tool-icon" aria-hidden="true">
            {#if /^[a-z0-9_-]+$/.test(tool.icon)}
              <MacIcon name={tool.icon} size={15} />
            {:else}
              {tool.icon}
            {/if}
          </span>
          <span class="cz-hub-tool-name">{tool.name || (tool as any).label}</span>
        </button>
      {/each}
    </div>
  </div>

  <div class="cz-hub-action-box">
    <UniversalUpload label="Upload to {title}" />
  </div>
</div>

<style>
  .cz-hub-banner {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 1.5rem;
    padding: 1.25rem 1.5rem;
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: var(--r-xl);
    margin-bottom: 1.5rem;
    box-shadow: var(--shadow-sm);
    min-width: 0;
    max-width: 100%;
  }
  .cz-hub-main {
    flex: 1;
    min-width: 0;
  }
  .cz-hub-heading {
    display: flex;
    align-items: center;
    gap: 0.85rem;
    margin-bottom: 0.85rem;
  }
  .cz-hub-icon {
    font-size: 1.75rem;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r-lg);
    box-shadow: var(--shadow-sm);
    flex-shrink: 0;
  }
  .cz-hub-title {
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--text);
    margin: 0;
    line-height: 1.2;
  }
  .cz-hub-desc {
    font-size: 0.82rem;
    color: var(--text-2);
    margin: 0.2rem 0 0 0;
  }
  .cz-hub-tools-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
    max-width: 100%;
    margin-top: 0.25rem;
  }
  .cz-hub-tool-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.35rem 0.65rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r-pill);
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--text-2);
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
    transition: color var(--t-fast), border-color var(--t-fast), background var(--t-fast);
  }
  .cz-hub-tool-chip:hover {
    color: var(--text);
    border-color: var(--border-hover, var(--brand));
    background: var(--surface3, var(--surface));
  }
  .cz-hub-tool-chip.is-active {
    background: var(--brand);
    color: #fff;
    border-color: var(--brand);
    box-shadow: var(--shadow-sm);
  }
  .cz-hub-tool-icon {
    font-size: 0.9rem;
  }
  .cz-hub-action-box {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    flex-shrink: 0;
  }
  @media (max-width: 768px) {
    .cz-hub-banner {
      flex-direction: column;
      align-items: stretch;
      padding: 0.9rem;
      gap: 0.85rem;
      border-radius: var(--r-lg);
      margin-bottom: 1rem;
    }
    .cz-hub-heading {
      gap: 0.65rem;
      margin-bottom: 0.65rem;
    }
    .cz-hub-icon {
      width: 38px;
      height: 38px;
    }
    .cz-hub-title {
      font-size: 1.1rem;
    }
    .cz-hub-desc {
      font-size: 0.78rem;
      line-height: 1.35;
    }
    .cz-hub-tools-row {
      flex-wrap: nowrap;
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
      scrollbar-width: none;
      padding-bottom: 0.2rem;
      gap: 0.4rem;
    }
    .cz-hub-tools-row::-webkit-scrollbar {
      display: none;
    }
    .cz-hub-tool-chip {
      min-height: 36px;
      padding: 0.35rem 0.7rem;
    }
    .cz-hub-action-box {
      align-items: stretch;
      width: 100%;
    }
    .cz-hub-action-box :global(.cz-universal-upload-btn) {
      width: 100%;
      justify-content: center;
    }
  }
</style>
