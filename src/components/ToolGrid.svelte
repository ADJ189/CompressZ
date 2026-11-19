<script lang="ts">
  import ToolCard from "./ToolCard.svelte";

  export interface ToolItem {
    id: string;
    name: string;
    description: string;
    icon: string;
    badge?: string;
    category?: string;
    route?: string;
  }

  interface Props {
    tools: ToolItem[];
    activeToolId?: string;
    onSelectTool: (id: string, tool: ToolItem) => void;
    title?: string;
    subtitle?: string;
  }

  let {
    tools,
    activeToolId = "",
    onSelectTool,
    title,
    subtitle,
  }: Props = $props();
</script>

<div class="cz-tool-grid-wrapper">
  {#if title}
    <div class="cz-tool-grid-header">
      <h3 class="cz-tool-grid-title">{title}</h3>
      {#if subtitle}
        <p class="cz-tool-grid-subtitle">{subtitle}</p>
      {/if}
    </div>
  {/if}

  <div class="cz-tool-grid" role="list">
    {#each tools as tool (tool.id)}
      <div role="listitem">
        <ToolCard
          id={tool.id}
          name={tool.name}
          description={tool.description}
          icon={tool.icon}
          badge={tool.badge}
          category={tool.category}
          active={activeToolId === tool.id}
          onclick={() => onSelectTool(tool.id, tool)}
        />
      </div>
    {/each}
  </div>
</div>

<style>
  .cz-tool-grid-wrapper {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    width: 100%;
  }

  .cz-tool-grid-header {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    margin-bottom: 0.25rem;
  }

  .cz-tool-grid-title {
    margin: 0;
    font-family: var(--display, var(--sans));
    font-size: 1.1rem;
    font-weight: 700;
    color: var(--text);
    letter-spacing: -0.015em;
  }

  .cz-tool-grid-subtitle {
    margin: 0;
    font-size: 0.82rem;
    color: var(--text-3);
    line-height: 1.4;
  }

  .cz-tool-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 0.85rem;
    width: 100%;
  }

  @media (max-width: 640px) {
    .cz-tool-grid {
      grid-template-columns: 1fr;
      gap: 0.75rem;
    }
  }
</style>
