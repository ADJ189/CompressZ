<script lang="ts">
  import type { EngineWarning } from "../lib/types";
  import { deduplicateWarnings } from "../lib/warnings";

  interface Props {
    warnings: ReadonlyArray<EngineWarning>;
    title?: string;
    onDismiss?: () => void;
  }

  let {
    warnings,
    title = "Fallback & quality notices",
    onDismiss,
  }: Props = $props();

  const items = $derived(deduplicateWarnings(warnings));
</script>

{#if items.length > 0}
  <div class="cz-warn-banner" role="status" aria-live="polite">
    <div class="cz-warn-banner-head">
      <div class="cz-warn-banner-title-wrap">
        <svg
          class="cz-warn-banner-icon"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        <strong class="cz-warn-banner-title">{title}</strong>
      </div>
      {#if onDismiss}
        <button
          type="button"
          class="cz-warn-banner-dismiss"
          onclick={onDismiss}
          aria-label="Dismiss notices"
        >
          Dismiss
        </button>
      {/if}
    </div>

    <ul class="cz-warn-banner-list">
      {#each items as item (`${item.code}:${item.engine}:${item.message}:${item.detail ?? ""}`)}
        <li class="cz-warn-banner-item">
          <div class="cz-warn-banner-msg">
            <span>{item.message}</span>
            {#if item.count > 1}
              <span class="cz-warn-banner-count">({item.count} files)</span>
            {/if}
          </div>
          {#if item.detail}
            <details class="cz-warn-banner-details">
              <summary>Details</summary>
              <pre>{item.detail}</pre>
            </details>
          {/if}
        </li>
      {/each}
    </ul>
  </div>
{/if}
