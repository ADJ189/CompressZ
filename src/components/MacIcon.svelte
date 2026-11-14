<script lang="ts">
  interface Props {
    name: string;
    size?: number;
    variant?: "glyph" | "squircle";
    color?: string;
    squircleSize?: number;
    strokeWidth?: number;
  }

  let {
    name,
    size = 18,
    variant = "glyph",
    color = "currentColor",
    squircleSize = 34,
    strokeWidth = 2,
  }: Props = $props();
</script>

{#if variant === "squircle"}
  <div
    class="cz-squircle cz-sq-{name}"
    style="width: {squircleSize}px; height: {squircleSize}px;"
    aria-hidden="true"
  >
    <svg
      width={Math.round(squircleSize * 0.52)}
      height={Math.round(squircleSize * 0.52)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="white"
      stroke-width={strokeWidth}
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      {#if name === "home"}
        <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1V9.5z" />
      {:else if name === "tools"}
        <rect x="3" y="3" width="7" height="7" rx="2" />
        <rect x="14" y="3" width="7" height="7" rx="2" />
        <rect x="3" y="14" width="7" height="7" rx="2" />
        <rect x="14" y="14" width="7" height="7" rx="2" />
      {:else if name === "pdf" || name === "pdf-suite"}
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="9" y1="15" x2="15" y2="15" />
      {:else if name === "image" || name === "images"}
        <rect x="3" y="3" width="18" height="18" rx="3" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <polyline points="21 15 16 10 5 21" />
      {:else if name === "video"}
        <polygon points="23 7 16 12 23 17 23 7" />
        <rect x="1" y="5" width="15" height="14" rx="3" />
      {:else if name === "audio"}
        <path d="M12 2v20M17 5v14M7 8v8M2 11v2M22 11v2" />
      {:else if name === "convert"}
        <path d="M21 7H7a4 4 0 0 0-4 4v1" />
        <polyline points="18 4 21 7 18 10" />
        <path d="M3 17h14a4 4 0 0 0 4-4v-1" />
        <polyline points="6 20 3 17 6 14" />
      {:else if name === "ocr"}
        <path d="M4 7V4h3M17 4h3v3M4 17v3h3M20 17v3h-3" />
        <line x1="9" y1="12" x2="15" y2="12" />
        <line x1="12" y1="9" x2="12" y2="15" />
      {:else if name === "gif"}
        <rect x="2" y="4" width="20" height="16" rx="3" />
        <path d="M6 12h2a1 1 0 0 1 1 1v1a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h3" />
        <line x1="12" y1="9" x2="12" y2="15" />
        <path d="M16 15V9h3M16 12h2" />
      {:else if name === "merge"}
        <path d="M8 7v10a4 4 0 0 0 8 0V5a2.5 2.5 0 0 0-5 0v11a1 1 0 0 0 2 0V7" />
      {:else if name === "split"}
        <circle cx="6" cy="6" r="3" />
        <circle cx="6" cy="18" r="3" />
        <line x1="20" y1="4" x2="8.12" y2="15.88" />
        <line x1="14.47" y1="14.48" x2="20" y2="20" />
        <line x1="8.12" y1="8.12" x2="12" y2="12" />
      {:else if name === "organize"}
        <rect x="3" y="3" width="7" height="9" rx="1.5" />
        <rect x="14" y="3" width="7" height="5" rx="1.5" />
        <rect x="14" y="12" width="7" height="9" rx="1.5" />
        <rect x="3" y="16" width="7" height="5" rx="1.5" />
      {:else if name === "studio"}
        <path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
      {:else if name === "sign"}
        <path d="M20 19.5c-3 0-5-2-7-2s-4 2-7 2M4 11s1.5-3 4-3 4 5 7 5 3-4 5-4" />
      {:else if name === "watermark"}
        <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" />
      {:else if name === "crop"}
        <path d="M6 2v14a2 2 0 0 0 2 2h14M18 22V8a2 2 0 0 0-2-2H2" />
      {:else if name === "forms"}
        <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
        <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
        <path d="M9 12l2 2 4-4" />
      {:else if name === "redact"}
        <rect x="3" y="5" width="18" height="14" rx="2" fill="white" opacity="0.4" />
        <line x1="3" y1="12" x2="21" y2="12" stroke-width="4" />
      {:else if name === "security"}
        <rect x="3" y="11" width="18" height="11" rx="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      {:else if name === "repair"}
        <path d="M12 2v20M2 12h20" stroke-width="3" />
        <circle cx="12" cy="12" r="9" />
      {:else if name === "docs"}
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15z" />
      {:else if name === "word"}
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M9 16l2-6 2 6 2-6" />
      {:else if name === "excel"}
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M9 10l6 6M15 10l-6 6" />
      {:else if name === "ppt"}
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <circle cx="12" cy="14" r="3" />
      {:else if name === "markdown" || name === "pdf-markdown"}
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M7 15V9l2.5 3L12 9v6M17 12l-2 3M15 12l2-3" />
      {:else}
        <circle cx="12" cy="12" r="8" />
      {/if}
    </svg>
  </div>
{:else}
  <svg
    class="cz-mac-glyph"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    stroke-width={strokeWidth}
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    {#if name === "home"}
      <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1V9.5z" />
    {:else if name === "tools"}
      <rect x="3" y="3" width="7" height="7" rx="2" />
      <rect x="14" y="3" width="7" height="7" rx="2" />
      <rect x="3" y="14" width="7" height="7" rx="2" />
      <rect x="14" y="14" width="7" height="7" rx="2" />
    {:else if name === "pdf" || name === "pdf-suite"}
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    {:else if name === "image" || name === "images" || name === "compress"}
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    {:else if name === "video"}
      <polygon points="23 7 16 12 23 17 23 7" />
      <rect x="1" y="5" width="15" height="14" rx="3" />
    {:else if name === "audio"}
      <path d="M12 2v20M17 5v14M7 8v8M2 11v2M22 11v2" />
    {:else if name === "convert"}
      <path d="M21 7H7a4 4 0 0 0-4 4v1" />
      <polyline points="18 4 21 7 18 10" />
      <path d="M3 17h14a4 4 0 0 0 4-4v-1" />
      <polyline points="6 20 3 17 6 14" />
    {:else if name === "ocr"}
      <path d="M4 7V4h3M17 4h3v3M4 17v3h3M20 17v3h-3" />
      <line x1="9" y1="12" x2="15" y2="12" />
      <line x1="12" y1="9" x2="12" y2="15" />
    {:else if name === "docs"}
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15z" />
    {:else if name === "search"}
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    {:else if name === "settings"}
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    {:else if name === "sun"}
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    {:else if name === "moon"}
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    {:else if name === "upload"}
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    {:else if name === "download"}
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    {:else if name === "chevron-down"}
      <polyline points="6 9 12 15 18 9" />
    {:else if name === "chevron-right"}
      <polyline points="9 18 15 12 9 6" />
    {:else if name === "copy"}
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    {:else if name === "check"}
      <polyline points="20 6 9 17 4 12" />
    {:else if name === "arrow-up-right"}
      <path d="M7 17L17 7M7 7h10v10" />
    {:else if name === "close" || name === "x"}
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    {:else}
      <circle cx="12" cy="12" r="5" />
    {/if}
  </svg>
{/if}

<style>
  .cz-squircle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 22.37%;
    position: relative;
    box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.4), 0 3px 10px rgba(0, 0, 0, 0.16);
    flex-shrink: 0;
    transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .cz-mac-glyph {
    display: inline-block;
    vertical-align: middle;
    flex-shrink: 0;
    transition: color 0.16s ease, transform 0.16s ease;
  }

  /* Authentic Apple macOS System Gradients */
  .cz-sq-home { background: linear-gradient(135deg, #0a84ff, #0066cc); }
  .cz-sq-tools { background: linear-gradient(135deg, #5e5ce6, #0a84ff); }
  .cz-sq-pdf, .cz-sq-pdf-suite { background: linear-gradient(135deg, #ff453a, #ff2d55); }
  .cz-sq-image, .cz-sq-images, .cz-sq-compress { background: linear-gradient(135deg, #0a84ff, #5e5ce6); }
  .cz-sq-video { background: linear-gradient(135deg, #5e5ce6, #bf5af2); }
  .cz-sq-audio { background: linear-gradient(135deg, #ff9f0a, #ff375f); }
  .cz-sq-convert { background: linear-gradient(135deg, #30d158, #0a84ff); }
  .cz-sq-ocr { background: linear-gradient(135deg, #bf5af2, #ff375f); }
  .cz-sq-gif { background: linear-gradient(135deg, #ff375f, #ff9f0a); }
  .cz-sq-merge { background: linear-gradient(135deg, #ff453a, #ff9f0a); }
  .cz-sq-split { background: linear-gradient(135deg, #ff2d55, #ff375f); }
  .cz-sq-organize { background: linear-gradient(135deg, #0a84ff, #30d158); }
  .cz-sq-studio { background: linear-gradient(135deg, #ffd60a, #ff9f0a); }
  .cz-sq-sign { background: linear-gradient(135deg, #64d2ff, #0a84ff); }
  .cz-sq-watermark { background: linear-gradient(135deg, #64d2ff, #5e5ce6); }
  .cz-sq-crop { background: linear-gradient(135deg, #30d158, #34c759); }
  .cz-sq-forms { background: linear-gradient(135deg, #ff9f0a, #ffd60a); }
  .cz-sq-redact { background: linear-gradient(135deg, #3a3a3c, #1c1c1e); }
  .cz-sq-security { background: linear-gradient(135deg, #30d158, #107c41); }
  .cz-sq-repair { background: linear-gradient(135deg, #ff453a, #ff9f0a); }
  .cz-sq-docs { background: linear-gradient(135deg, #ff9f0a, #ffd60a); }
  .cz-sq-word { background: linear-gradient(135deg, #0078d4, #005a9e); }
  .cz-sq-excel { background: linear-gradient(135deg, #107c41, #0b5a2e); }
  .cz-sq-ppt { background: linear-gradient(135deg, #d83b01, #a82a00); }
  .cz-sq-markdown, .cz-sq-pdf-markdown { background: linear-gradient(135deg, #0a84ff, #30d158); }
</style>
