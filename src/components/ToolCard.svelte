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
  <div class="cz-tool-card-icon-wrap">
    <MacIcon name={icon} variant="squircle" squircleSize={44} strokeWidth={2.1} />
    {#if badge}
      <span class="cz-tool-card-badge">{badge}</span>
    {/if}
  </div>

  <div class="cz-tool-card-body">
    <div class="cz-tool-card-title-row">
      <h4 class="cz-tool-card-title">{name}</h4>
      <span class="cz-tool-card-arrow" aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
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
    gap: 1rem;
    padding: 1.15rem 1.25rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r, 16px);
    cursor: pointer;
    text-align: left;
    outline: none;
    user-select: none;
    -webkit-user-select: none;
    min-height: 96px;
    box-shadow: var(--shadow-xs, 0 1px 2px rgba(0, 0, 0, 0.04));
    transition:
      transform 0.18s cubic-bezier(0.16, 1, 0.3, 1),
      border-color 0.18s cubic-bezier(0.16, 1, 0.3, 1),
      box-shadow 0.18s cubic-bezier(0.16, 1, 0.3, 1),
      background-color 0.18s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .cz-tool-card:hover {
    transform: translateY(-2px);
    border-color: var(--border-strong, #b0b0a8);
    box-shadow: var(--shadow-md, 0 4px 16px rgba(0, 0, 0, 0.07));
    background: var(--surface2);
  }

  .cz-tool-card:active {
    transform: translateY(0) scale(0.985);
  }

  .cz-tool-card:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-color: var(--accent);
  }

  .cz-tool-card.is-active {
    border-color: var(--accent);
    background: var(--accent-soft, rgba(16, 185, 129, 0.09));
    box-shadow: 0 0 0 1px var(--accent), var(--shadow-sm);
  }

  .cz-tool-card-icon-wrap {
    position: relative;
    flex-shrink: 0;
  }

  .cz-tool-card-badge {
    position: absolute;
    top: -6px;
    right: -6px;
    padding: 0.15rem 0.4rem;
    font-size: 0.65rem;
    font-weight: 700;
    line-height: 1;
    border-radius: 100px;
    background: var(--accent);
    color: #ffffff;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
    letter-spacing: 0.02em;
  }

  .cz-tool-card-body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .cz-tool-card-title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .cz-tool-card-title {
    margin: 0;
    font-family: var(--display, var(--sans));
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--text);
    line-height: 1.3;
    letter-spacing: -0.01em;
  }

  .cz-tool-card-arrow {
    display: flex;
    align-items: center;
    color: var(--text-4, #a1a1aa);
    opacity: 0.6;
    transition: transform 0.18s ease, color 0.18s ease, opacity 0.18s ease;
    flex-shrink: 0;
  }

  .cz-tool-card:hover .cz-tool-card-arrow {
    color: var(--accent);
    opacity: 1;
    transform: translateX(3px);
  }

  .cz-tool-card-desc {
    margin: 0;
    font-size: 0.8rem;
    color: var(--text-3);
    line-height: 1.42;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .cz-tool-card-category {
    align-self: flex-start;
    margin-top: 0.25rem;
    padding: 0.15rem 0.5rem;
    font-size: 0.7rem;
    font-weight: 600;
    border-radius: var(--r-xs, 6px);
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

  @media (prefers-reduced-motion: reduce) {
    .cz-tool-card {
      transition: none;
    }
    .cz-tool-card:hover {
      transform: none;
    }
    .cz-tool-card:active {
      transform: none;
    }
    .cz-tool-card-arrow {
      transition: none;
    }
    .cz-tool-card:hover .cz-tool-card-arrow {
      transform: none;
    }
  }
</style>
