<script lang="ts">
  import {
    detectFileTypeAndActions,
    readFileHeaderBytes,
    type DetectionResult,
    type FileAction,
  } from "../lib/fileRouter";
  import { formatBytes } from "../lib/types";
  import { stagedUniversalFile } from "../store";
  import { navigate } from "../router";
  import { toast } from "../toast";
  import MacIcon from "./MacIcon.svelte";

  interface Props {
    file: File | null;
    open: boolean;
    onClose: () => void;
    onActionSelected?: (action: FileAction) => void;
  }

  let { file, open, onClose, onActionSelected }: Props = $props();

  let detection = $state<DetectionResult | null>(null);
  let isLoading = $state(false);

  $effect(() => {
    if (file && open) {
      const currentFile = file;
      let cancelled = false;
      isLoading = true;
      readFileHeaderBytes(currentFile)
        .then((headerBytes) => {
          if (!cancelled && file === currentFile && open) {
            detection = detectFileTypeAndActions(currentFile, headerBytes);
          }
        })
        .catch(() => {
          if (!cancelled && file === currentFile && open) {
            detection = detectFileTypeAndActions(currentFile);
          }
        })
        .finally(() => {
          if (!cancelled && file === currentFile && open) {
            isLoading = false;
          }
        });
      return () => {
        cancelled = true;
      };
    } else {
      detection = null;
      isLoading = false;
    }
  });

  function handleSelectAction(action: FileAction) {
    if (!file) return;
    stagedUniversalFile.set({
      file,
      actionId: action.id,
      sourceHub: action.hub,
      targetRoute: action.route,
    });
    onActionSelected?.(action);
    onClose();
    navigate(action.route);
    toast(`Routing to ${action.name}`, "info");
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && open) {
      onClose();
    }
  }

  function getActionIcon(actionId: string, hub: string): string {
    const MAP: Record<string, string> = {
      "edit-sign": "studio",
      "fill-forms": "forms",
      "compress-pdf": "pdf",
      "pdf-to-word": "word",
      "pdf-to-excel": "excel",
      "pdf-to-ppt": "ppt",
      "pdf-to-images": "image",
      "split-pdf": "split",
      "organize-pdf": "organize",
      "watermark-pdf": "watermark",
      "crop-pdf": "crop",
      "redact-pdf": "redact",
      "protect-pdf": "security",
      "ocr-pdf": "ocr",
      "pdf-markdown": "markdown",
      "repair-pdf": "repair",
      "docx-to-pdf": "pdf",
      "docx-to-txt": "docs",
      "pptx-to-pdf": "pdf",
      "pptx-to-txt": "docs",
      "xlsx-to-pdf": "pdf",
      "xlsx-to-csv": "excel",
      "compress-image": "image",
      "images-to-pdf": "pdf",
      "convert-image": "convert",
      "ocr-image": "ocr",
      "compress-video": "video",
      "convert-video": "convert",
      "video-to-gif": "gif",
      "compress-audio": "audio",
      "convert-audio": "convert",
      "repair-general": "repair",
      "convert-general": "convert",
    };
    if (MAP[actionId]) return MAP[actionId];
    if (hub === "pdf") return "pdf";
    if (hub === "compress") return "compress";
    if (hub === "convert") return "convert";
    if (hub === "ai") return "ocr";
    return "tools";
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open && file}
  <div class="cz-palette-backdrop" onclick={onClose} role="presentation"></div>
  <div
    class="cz-palette-dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby="cz-palette-title"
  >
    <div class="cz-palette-header">
      <div class="cz-palette-file-info">
        <span class="cz-palette-icon" aria-hidden="true">
          <MacIcon name="upload" size={18} strokeWidth={2.4} />
        </span>
        <div>
          <h2 id="cz-palette-title" class="cz-palette-filename" title={file.name}>
            {file.name}
          </h2>
          <div class="cz-palette-meta">
            <span class="cz-badge">{formatBytes(file.size)}</span>
            {#if detection}
              <span class="cz-badge is-highlight">{detection.label}</span>
            {/if}
          </div>
        </div>
      </div>
      <button
        type="button"
        class="cz-btn cz-btn-ghost cz-btn-sm"
        aria-label="Close dialog"
        onclick={onClose}
      >
        <MacIcon name="close" size={13} strokeWidth={2.4} />
      </button>
    </div>

    <div class="cz-palette-body">
      {#if isLoading}
        <div class="cz-palette-loading">
          <div class="cz-spinner"></div>
          <span>Inspecting file structure...</span>
        </div>
      {:else if detection}
        <div class="cz-palette-prompt">
          Choose an action for this file:
        </div>
        <div class="cz-palette-grid">
          {#each detection.actions as action}
            <button
              type="button"
              class="cz-palette-card"
              onclick={() => handleSelectAction(action)}
            >
              <div class="cz-palette-card-top">
                <span class="cz-palette-card-icon" aria-hidden="true">
                  <MacIcon name={getActionIcon(action.id, action.hub)} variant="squircle" squircleSize={32} />
                </span>
                <span class="cz-palette-card-hub">{action.hub.toUpperCase()}</span>
              </div>
              <div class="cz-palette-card-name">{action.name}</div>
              <div class="cz-palette-card-desc">{action.desc}</div>
            </button>
          {/each}
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .cz-palette-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(6px);
    z-index: 1100;
  }
  .cz-palette-dialog {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 92vw;
    max-width: 680px;
    max-height: 85vh;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r-xl);
    z-index: 1101;
    display: flex;
    flex-direction: column;
    box-shadow: var(--shadow-xl);
    overflow: hidden;
  }
  .cz-palette-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem 1.4rem;
    border-bottom: 1px solid var(--border);
    background: var(--surface2);
  }
  .cz-palette-file-info {
    display: flex;
    align-items: center;
    gap: 0.85rem;
    min-width: 0;
  }
  .cz-palette-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: var(--r-md);
    background: var(--brand-glow);
    color: var(--brand);
    font-size: 1.15rem;
    flex-shrink: 0;
  }
  .cz-palette-filename {
    font-size: 1rem;
    font-weight: 600;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 380px;
    margin: 0;
  }
  .cz-palette-meta {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.2rem;
  }
  .cz-palette-body {
    padding: 1.25rem 1.4rem;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }
  .cz-palette-prompt {
    font-size: 0.85rem;
    color: var(--text-2);
    font-weight: 500;
  }
  .cz-palette-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 0.75rem;
  }
  .cz-palette-card {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    padding: 0.9rem;
    border-radius: var(--r-md);
    background: var(--surface2);
    border: 1px solid var(--border);
    cursor: pointer;
    text-align: left;
    transition: transform var(--t-fast), border-color var(--t-fast), background var(--t-fast), box-shadow var(--t-fast);
  }
  .cz-palette-card:hover {
    border-color: var(--brand);
    background: var(--surface3, var(--surface2));
    transform: translateY(-2px);
    box-shadow: var(--shadow-md);
  }
  .cz-palette-card-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
    margin-bottom: 0.5rem;
  }
  .cz-palette-card-icon {
    font-size: 1.35rem;
  }
  .cz-palette-card-hub {
    font-size: 0.65rem;
    font-weight: 700;
    color: var(--brand);
    background: var(--brand-glow);
    padding: 2px 6px;
    border-radius: 4px;
    letter-spacing: 0.5px;
  }
  .cz-palette-card-name {
    font-size: 0.88rem;
    font-weight: 600;
    color: var(--text);
    margin-bottom: 0.25rem;
  }
  .cz-palette-card-desc {
    font-size: 0.75rem;
    color: var(--text-3);
    line-height: 1.3;
  }
  .cz-palette-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    padding: 2.5rem 0;
    color: var(--text-2);
    font-size: 0.9rem;
  }
</style>
