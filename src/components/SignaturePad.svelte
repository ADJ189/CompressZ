<script lang="ts">
  import { onMount } from "svelte";

  interface Props {
    onSave: (dataUrl: string) => void;
    onCancel?: () => void;
  }

  let { onSave, onCancel }: Props = $props();

  let mode = $state<"draw" | "type">("draw");
  let canvasEl = $state<HTMLCanvasElement>();
  let ctx: CanvasRenderingContext2D | null = null;
  let isDrawing = $state(false);
  let hasInk = $state(false);

  // Drawing settings
  let strokeColor = $state<string>("#000000");
  let strokeWidth = $state<number>(3);

  // Type mode settings
  let typedName = $state<string>("");
  let selectedFont = $state<string>("Caveat");

  const FONTS = ["Caveat", "Dancing Script", "Great Vibes", "Brush Script MT", "cursive"];
  const COLORS = [
    { label: "Black", hex: "#000000" },
    { label: "Navy", hex: "#0f2b5c" },
    { label: "Blue", hex: "#1d4ed8" },
  ];

  onMount(() => {
    if (canvasEl) {
      ctx = canvasEl.getContext("2d");
      if (ctx) {
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
      }
    }
  });

  function getCanvasPos(e: MouseEvent | TouchEvent): { x: number; y: number } {
    const rect = canvasEl.getBoundingClientRect();
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
    const scaleX = canvasEl.width / rect.width;
    const scaleY = canvasEl.height / rect.height;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  }

  function startDrawing(e: MouseEvent | TouchEvent) {
    if (!ctx) return;
    isDrawing = true;
    hasInk = true;
    const pos = getCanvasPos(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidth;
  }

  function draw(e: MouseEvent | TouchEvent) {
    if (!isDrawing || !ctx) return;
    e.preventDefault();
    const pos = getCanvasPos(e);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
  }

  function stopDrawing() {
    if (!isDrawing || !ctx) return;
    isDrawing = false;
    ctx.closePath();
  }

  function handleClear() {
    if (!ctx) return;
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
    hasInk = false;
  }

  function renderTypedSignature(): string {
    const offCanvas = document.createElement("canvas");
    offCanvas.width = 600;
    offCanvas.height = 200;
    const offCtx = offCanvas.getContext("2d")!;
    offCtx.fillStyle = strokeColor;
    offCtx.font = `italic 56px ${selectedFont}, cursive`;
    offCtx.textAlign = "center";
    offCtx.textBaseline = "middle";
    offCtx.fillText(typedName.trim() || "Signature", 300, 100);
    return offCanvas.toDataURL("image/png");
  }

  function handleConfirm() {
    if (mode === "draw") {
      if (!hasInk) return;
      onSave(canvasEl.toDataURL("image/png"));
    } else {
      if (!typedName.trim()) return;
      onSave(renderTypedSignature());
    }
  }
</script>

<div class="cz-signature-modal" role="dialog" aria-label="Sign document">
  <div class="cz-sig-header">
    <div class="cz-sig-tabs">
      <button
        type="button"
        class="cz-sig-tab {mode === 'draw' ? 'is-active' : ''}"
        onclick={() => (mode = 'draw')}
      >
        ✏️ Draw Signature
      </button>
      <button
        type="button"
        class="cz-sig-tab {mode === 'type' ? 'is-active' : ''}"
        onclick={() => (mode = 'type')}
      >
        ⌨️ Type Signature
      </button>
    </div>

    {#if onCancel}
      <button type="button" class="cz-btn-ghost cz-btn-sm" onclick={onCancel}>✕</button>
    {/if}
  </div>

  <div class="cz-sig-body">
    {#if mode === "draw"}
      <div class="cz-sig-canvas-container">
        <canvas
          bind:this={canvasEl}
          width="600"
          height="220"
          class="cz-sig-canvas"
          onmousedown={startDrawing}
          onmousemove={draw}
          onmouseup={stopDrawing}
          onmouseleave={stopDrawing}
          ontouchstart={startDrawing}
          ontouchmove={draw}
          ontouchend={stopDrawing}
        ></canvas>
        <div class="cz-sig-baseline" aria-hidden="true"></div>
      </div>

      <div class="cz-sig-controls">
        <div class="cz-sig-color-picker">
          {#each COLORS as c}
            <button
              type="button"
              class="cz-sig-color-dot {strokeColor === c.hex ? 'is-selected' : ''}"
              style="background: {c.hex};"
              title={c.label}
              onclick={() => (strokeColor = c.hex)}
            ></button>
          {/each}
        </div>

        <div class="cz-sig-stroke-picker">
          <button
            type="button"
            class="cz-sig-stroke-pill {strokeWidth === 2 ? 'is-active' : ''}"
            onclick={() => (strokeWidth = 2)}
          >
            Fine
          </button>
          <button
            type="button"
            class="cz-sig-stroke-pill {strokeWidth === 3 ? 'is-active' : ''}"
            onclick={() => (strokeWidth = 3)}
          >
            Medium
          </button>
          <button
            type="button"
            class="cz-sig-stroke-pill {strokeWidth === 5 ? 'is-active' : ''}"
            onclick={() => (strokeWidth = 5)}
          >
            Bold
          </button>
        </div>

        <button
          type="button"
          class="cz-btn-ghost cz-btn-sm"
          onclick={handleClear}
          disabled={!hasInk}
        >
          Clear
        </button>
      </div>
    {:else}
      <div class="cz-sig-type-container">
        <input
          type="text"
          class="cz-sig-type-input"
          placeholder="Type your legal name..."
          bind:value={typedName}
        />

        <div class="cz-sig-font-choices">
          {#each FONTS as font}
            <button
              type="button"
              class="cz-sig-font-card {selectedFont === font ? 'is-selected' : ''}"
              style="font-family: {font}, cursive; color: {strokeColor};"
              onclick={() => (selectedFont = font)}
            >
              {typedName.trim() || "Your Name"}
            </button>
          {/each}
        </div>

        <div class="cz-sig-color-picker">
          {#each COLORS as c}
            <button
              type="button"
              class="cz-sig-color-dot {strokeColor === c.hex ? 'is-selected' : ''}"
              style="background: {c.hex};"
              title={c.label}
              onclick={() => (strokeColor = c.hex)}
            ></button>
          {/each}
        </div>
      </div>
    {/if}
  </div>

  <div class="cz-sig-footer">
    <span class="cz-sig-badge">Vector Cryptographic Stamp Ready</span>
    <div class="cz-sig-footer-actions">
      {#if onCancel}
        <button type="button" class="cz-btn-ghost cz-btn-sm" onclick={onCancel}>
          Cancel
        </button>
      {/if}
      <button
        type="button"
        class="cz-btn cz-btn-primary cz-btn-sm"
        disabled={mode === "draw" ? !hasInk : !typedName.trim()}
        onclick={handleConfirm}
      >
        Adopt & Stamp Signature
      </button>
    </div>
  </div>
</div>

<style>
  .cz-signature-modal {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r);
    padding: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    box-shadow: var(--shadow-xl);
    max-width: 640px;
    width: 100%;
  }

  .cz-sig-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .cz-sig-tabs {
    display: flex;
    background: var(--surface2);
    border-radius: 100px;
    padding: 0.2rem;
    border: 1px solid var(--border);
  }

  .cz-sig-tab {
    padding: 0.35rem 0.85rem;
    font-size: 0.82rem;
    font-weight: 500;
    border-radius: 100px;
    background: transparent;
    border: none;
    cursor: pointer;
    color: var(--text-2);
    transition: background var(--t), color var(--t);
  }

  .cz-sig-tab.is-active {
    background: var(--surface);
    color: var(--text);
    font-weight: 600;
    box-shadow: var(--shadow-sm);
  }

  .cz-sig-canvas-container {
    position: relative;
    border: 1px dashed var(--border-2);
    border-radius: var(--r-sm);
    background: #ffffff;
    overflow: hidden;
  }

  .cz-sig-canvas {
    width: 100%;
    height: 200px;
    display: block;
    cursor: crosshair;
    touch-action: none;
  }

  .cz-sig-baseline {
    position: absolute;
    bottom: 45px;
    left: 40px;
    right: 40px;
    height: 1px;
    background: rgba(0, 0, 0, 0.15);
    pointer-events: none;
  }

  .cz-sig-controls {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 0.75rem;
  }

  .cz-sig-color-picker {
    display: flex;
    gap: 0.5rem;
  }

  .cz-sig-color-dot {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    border: 2px solid transparent;
    cursor: pointer;
    transition: transform var(--t);
  }

  .cz-sig-color-dot.is-selected {
    transform: scale(1.15);
    border-color: var(--accent);
    box-shadow: 0 0 0 2px white, 0 0 6px var(--accent);
  }

  .cz-sig-stroke-picker {
    display: flex;
    background: var(--surface2);
    border-radius: 6px;
    padding: 0.15rem;
    border: 1px solid var(--border);
  }

  .cz-sig-stroke-pill {
    padding: 0.2rem 0.55rem;
    font-size: 0.75rem;
    border-radius: 4px;
    background: transparent;
    border: none;
    cursor: pointer;
    color: var(--text-2);
  }

  .cz-sig-stroke-pill.is-active {
    background: var(--surface);
    color: var(--text);
    font-weight: 600;
  }

  .cz-sig-type-container {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }

  .cz-sig-type-input {
    width: 100%;
    padding: 0.65rem 0.85rem;
    border-radius: var(--r-sm);
    border: 1px solid var(--border);
    background: var(--surface2);
    color: var(--text);
    font-size: 1rem;
    outline: none;
  }

  .cz-sig-type-input:focus {
    border-color: var(--accent);
  }

  .cz-sig-font-choices {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
  }

  .cz-sig-font-card {
    background: #ffffff;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    padding: 0.75rem;
    font-size: 1.4rem;
    cursor: pointer;
    text-align: center;
    transition: border-color var(--t), box-shadow var(--t);
  }

  .cz-sig-font-card.is-selected {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }

  .cz-sig-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-top: 1px solid var(--border);
    padding-top: 0.85rem;
  }

  .cz-sig-badge {
    font-size: 0.72rem;
    color: var(--text-3);
  }

  .cz-sig-footer-actions {
    display: flex;
    gap: 0.5rem;
  }
</style>
