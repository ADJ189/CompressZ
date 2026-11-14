<script lang="ts">
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
</script>

<div class="cz-hub-banner">
  <div class="cz-hub-main">
    <div class="cz-hub-heading">
      <span class="cz-hub-icon" aria-hidden="true">{icon}</span>
      <div>
        <h1 class="cz-hub-title">{title}</h1>
        <p class="cz-hub-desc">{description}</p>
      </div>
    </div>

    <div class="cz-hub-tools-row" role="tablist" aria-label="{title} tools">
      {#each tools as tool}
        <button
          type="button"
          class="cz-hub-tool-chip {activeToolId === tool.id ? 'is-active' : ''}"
          role="tab"
          aria-selected={activeToolId === tool.id}
          onclick={() => onSelectTool?.(tool.id)}
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
  }
  @media (max-width: 768px) {
    .cz-hub-banner {
      flex-direction: column;
      align-items: stretch;
      padding: 1rem;
      gap: 1rem;
    }
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
    gap: 0.45rem;
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
    .cz-hub-action-box {
      align-items: flex-start;
    }
  }
</style>
