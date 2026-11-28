<script lang="ts">
  import MacIcon from "./MacIcon.svelte";

  interface Props {
    id: string;
    name: string;
    description: string;
    icon: string;
    badge?: string;
    active?: boolean;
    category?: string;
    onclick?: () => void;
  }

  let {
    id,
    name,
    description,
    icon,
    badge,
    active = false,
    category,
    onclick,
  }: Props = $props();

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onclick?.();
    }
  }

  function getBadgeTone(label?: string): "info" | "accent" | "caution" | "neutral" {
    const key = (label ?? "").trim().toLowerCase();
    if (key === "fast" || key === "webcodecs fast path" || key === "fast ooxml" || key === "layout") {
      return "info";
    }
    if (key === "aes-256" || key === "true purge" || key === "privacy" || key === "security") {
      return "caution";
    }
    if (key === "new" || key === "studio") {
      return "accent";
    }
    return "neutral";
  }

  const badgeTone = $derived(getBadgeTone(badge));
</script>

<div
  class="cz-tool-card {active ? 'is-active' : ''}"
  role="button"
  tabindex="0"
  aria-pressed={active}
  aria-label={name}
  title={description}
  data-tool-id={id}
  {onclick}
  onkeydown={handleKeydown}
>
  <div class="cz-tool-card-icon-wrap" aria-hidden="true">
    <MacIcon name={icon} variant="squircle" squircleSize={44} strokeWidth={2.05} />
  </div>

  <div class="cz-tool-card-body">
    <div class="cz-tool-card-title-row">
      <div class="cz-tool-card-title-group">
        <h4 class="cz-tool-card-title">{name}</h4>
        {#if badge}
          <span class="cz-tool-card-badge is-{badgeTone}">{badge}</span>
        {/if}
      </div>
      <span class="cz-tool-card-arrow" aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </span>
    </div>
    <p class="cz-tool-card-desc">{description}</p>
    {#if category}
      <span class="cz-tool-card-category">{category}</span>
    {/if}
  </div>
</div>

<style>
  .cz-tool-card {
    position: relative;
    display: flex;
    align-items: flex-start;
    gap: 0.9rem;
    flex: 1;
    width: 100%;
    padding: 0.95rem 1.05rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r, 16px);
    cursor: pointer;
    text-align: left;
    outline: none;
    overflow: hidden;
    user-select: none;
    -webkit-user-select: none;
    min-height: 94px;
    box-shadow: var(--hairline, inset 0 1px 0 rgba(255, 255, 255, 0.7)), var(--shadow-xs, 0 1px 2px rgba(0, 0, 0, 0.04));
    transition:
      transform 0.18s cubic-bezier(0.22, 1, 0.36, 1),
      border-color 0.18s cubic-bezier(0.22, 1, 0.36, 1),
      box-shadow 0.18s cubic-bezier(0.22, 1, 0.36, 1),
      background-color 0.18s cubic-bezier(0.22, 1, 0.36, 1);
  }

  /* Apple-style pointer specular interaction layer */
  .cz-tool-card::before {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: linear-gradient(
      145deg,
      rgba(255, 255, 255, 0.42) 0%,
      rgba(255, 255, 255, 0) 52%
    );
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.18s cubic-bezier(0.22, 1, 0.36, 1);
  }

  :global([data-theme="dark"]) .cz-tool-card::before {
    background: linear-gradient(
      145deg,
      rgba(255, 255, 255, 0.08) 0%,
      rgba(255, 255, 255, 0) 52%
    );
  }

  @media (hover: hover) and (pointer: fine) {
    .cz-tool-card:hover {
      transform: translateY(-2px);
      border-color: var(--border-strong, #b0b0a8);
      box-shadow:
        var(--hairline, inset 0 1px 0 rgba(255, 255, 255, 0.7)),
        0 6px 20px rgba(0, 0, 0, 0.07),
        0 2px 5px rgba(0, 0, 0, 0.04);
      background: var(--surface2);
    }
    .cz-tool-card:hover::before {
      opacity: 1;
    }
    .cz-tool-card:hover .cz-tool-card-icon-wrap :global(.cz-squircle) {
      transform: translateY(-1px) scale(1.03);
      box-shadow:
        inset 0 1px 1px rgba(255, 255, 255, 0.5),
        inset 0 -1px 1px rgba(0, 0, 0, 0.14),
        0 6px 16px rgba(0, 0, 0, 0.16);
    }
    .cz-tool-card:hover .cz-tool-card-arrow {
      color: var(--accent-ink, var(--accent));
      opacity: 1;
      transform: translateX(3px);
    }
  }

  .cz-tool-card:active {
    transform: translateY(0) scale(0.985);
  }

  .cz-tool-card:active .cz-tool-card-icon-wrap :global(.cz-squircle) {
    transform: scale(0.96);
  }

  .cz-tool-card:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-color: var(--accent);
  }

  .cz-tool-card.is-active {
    border-color: var(--accent);
    background: var(--accent-soft, rgba(16, 185, 129, 0.09));
    background: color-mix(in oklab, var(--accent) 8%, var(--surface));
    box-shadow:
      0 0 0 1px var(--accent),
      var(--hairline, inset 0 1px 0 rgba(255, 255, 255, 0.7)),
      var(--shadow-sm);
  }

  .cz-tool-card-icon-wrap {
    position: relative;
    flex-shrink: 0;
    margin-top: 1px;
  }

  .cz-tool-card-body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.28rem;
    position: relative;
    z-index: 1;
  }

  .cz-tool-card-title-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .cz-tool-card-title-group {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.42rem;
    min-width: 0;
  }

  .cz-tool-card-title {
    margin: 0;
    font-family: var(--display, var(--sans));
    font-size: 0.94rem;
    font-weight: 650;
    color: var(--text);
    line-height: 1.3;
    letter-spacing: -0.012em;
  }

  /* Inline macOS-style capsule placed beside the title inside the card */
  .cz-tool-card-badge {
    display: inline-flex;
    align-items: center;
    padding: 0.14rem 0.48rem;
    font-size: 0.68rem;
    font-weight: 600;
    line-height: 1.15;
    border-radius: 6px;
    letter-spacing: -0.005em;
    white-space: nowrap;
    flex-shrink: 0;
    border: 1px solid transparent;
  }

  .cz-tool-card-badge.is-info {
    background: rgba(10, 132, 255, 0.11);
    color: #0066cc;
    border-color: rgba(10, 132, 255, 0.2);
  }
  .cz-tool-card-badge.is-accent {
    background: var(--accent-soft, rgba(16, 185, 129, 0.1));
    color: var(--accent-ink, var(--accent));
    border-color: color-mix(in oklab, var(--accent) 24%, transparent);
  }
  .cz-tool-card-badge.is-caution {
    background: rgba(217, 119, 6, 0.11);
    color: #b45309;
    border-color: rgba(217, 119, 6, 0.22);
  }
  .cz-tool-card-badge.is-neutral {
    background: var(--surface2);
    color: var(--text-2);
    border-color: var(--border);
  }

  :global([data-theme="dark"]) .cz-tool-card-badge.is-info {
    background: rgba(56, 189, 248, 0.14);
    color: #7dd3fc;
    border-color: rgba(56, 189, 248, 0.24);
  }
  :global([data-theme="dark"]) .cz-tool-card-badge.is-caution {
    background: rgba(251, 191, 36, 0.14);
    color: #fcd34d;
    border-color: rgba(251, 191, 36, 0.24);
  }

  .cz-tool-card-arrow {
    display: flex;
    align-items: center;
    margin-top: 2px;
    color: var(--text-4, #a1a1aa);
    opacity: 0.65;
    transition: transform 0.18s cubic-bezier(0.22, 1, 0.36, 1), color 0.18s ease, opacity 0.18s ease;
    flex-shrink: 0;
  }

  .cz-tool-card-desc {
    margin: 0;
    font-size: 0.79rem;
    color: var(--text-3);
    line-height: 1.44;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .cz-tool-card-category {
    align-self: flex-start;
    margin-top: 0.2rem;
    padding: 0.14rem 0.48rem;
    font-size: 0.69rem;
    font-weight: 600;
    border-radius: 6px;
    background: var(--surface2);
    border: 1px solid var(--border);
    color: var(--text-3);
  }

  @media (max-width: 480px) {
    .cz-tool-card {
      padding: 0.85rem 0.95rem;
      gap: 0.75rem;
      min-height: auto;
    }
    .cz-tool-card-title {
      font-size: 0.9rem;
    }
    .cz-tool-card-desc {
      font-size: 0.76rem;
    }
  }

  @container (max-width: 240px) {
    .cz-tool-card {
      padding: 0.85rem;
      gap: 0.7rem;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .cz-tool-card,
    .cz-tool-card::before,
    .cz-tool-card-arrow {
      transition: none;
    }
    .cz-tool-card:hover,
    .cz-tool-card:active,
    .cz-tool-card:hover .cz-tool-card-icon-wrap :global(.cz-squircle),
    .cz-tool-card:active .cz-tool-card-icon-wrap :global(.cz-squircle),
    .cz-tool-card:hover .cz-tool-card-arrow {
      transform: none;
    }
  }
</style>
