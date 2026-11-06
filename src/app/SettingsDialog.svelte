<script lang="ts">
  import {
    getSettings,
    updateSettings,
    resetSettings,
    resolveExecutionProfile,
    type Settings,
  } from "../lib/settings";
  import { getThemePreference, setThemePreference, THEME_EVENT } from "../lib/theme";
  import { toast } from "../toast";
  import { onMount } from "svelte";

  interface Props {
    open: boolean;
    onClose: () => void;
  }

  let { open, onClose }: Props = $props();

  let settings = $state<Settings>(getSettings());
  let themePref = $state<"light" | "dark" | "system">(getThemePreference());
  let activeSection = $state<
    "general" | "appearance" | "performance" | "ai" | "compression" | "privacy" | "diagnostics"
  >("general");

  function reloadSettings() {
    settings = getSettings();
    themePref = getThemePreference();
  }

  onMount(() => {
    reloadSettings();
    document.addEventListener(THEME_EVENT, reloadSettings);
    return () => {
      document.removeEventListener(THEME_EVENT, reloadSettings);
    };
  });

  function saveChanges(patch: Partial<Settings>) {
    updateSettings(patch);
    settings = getSettings();
    toast("Settings updated", "success");
  }

  function handleThemeChange(val: "light" | "dark" | "system") {
    setThemePreference(val);
    themePref = val;
    toast(`Theme set to ${val}`, "success");
  }

  function handleReset() {
    if (confirm("Reset all settings to default values?")) {
      resetSettings();
      settings = getSettings();
      toast("Settings reset to defaults", "success");
    }
  }

  function handleClearData() {
    if (confirm("Clear all locally stored CompressZ settings and recent history?")) {
      localStorage.clear();
      resetSettings();
      settings = getSettings();
      toast("Local data cleared", "success");
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && open) {
      onClose();
    }
  }

  const profile = $derived(resolveExecutionProfile(settings));
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
  <div class="cz-dialog-backdrop" onclick={onClose} role="presentation"></div>
  <div
    class="cz-dialog cz-settings-dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby="settings-dialog-title"
  >
    <div class="cz-dialog-header">
      <h2 id="settings-dialog-title" class="cz-dialog-title">Settings</h2>
      <button
        type="button"
        class="cz-btn cz-btn-ghost cz-btn-sm"
        aria-label="Close dialog"
        onclick={onClose}
      >
        ✕
      </button>
    </div>

    <div class="cz-settings-body">
      <nav class="cz-settings-nav" aria-label="Settings categories">
        <button
          type="button"
          class="cz-settings-nav-btn {activeSection === 'general' ? 'is-active' : ''}"
          onclick={() => (activeSection = "general")}
        >
          General
        </button>
        <button
          type="button"
          class="cz-settings-nav-btn {activeSection === 'appearance' ? 'is-active' : ''}"
          onclick={() => (activeSection = "appearance")}
        >
          Appearance
        </button>
        <button
          type="button"
          class="cz-settings-nav-btn {activeSection === 'performance' ? 'is-active' : ''}"
          onclick={() => (activeSection = "performance")}
        >
          Performance
        </button>
        <button
          type="button"
          class="cz-settings-nav-btn {activeSection === 'ai' ? 'is-active' : ''}"
          onclick={() => (activeSection = "ai")}
        >
          AI Engine
        </button>
        <button
          type="button"
          class="cz-settings-nav-btn {activeSection === 'compression' ? 'is-active' : ''}"
          onclick={() => (activeSection = "compression")}
        >
          Compression Defaults
        </button>
        <button
          type="button"
          class="cz-settings-nav-btn {activeSection === 'privacy' ? 'is-active' : ''}"
          onclick={() => (activeSection = "privacy")}
        >
          Privacy & Data
        </button>
        <button
          type="button"
          class="cz-settings-nav-btn {activeSection === 'diagnostics' ? 'is-active' : ''}"
          onclick={() => (activeSection = "diagnostics")}
        >
          Diagnostics
        </button>
      </nav>

      <div class="cz-settings-content">
        {#if activeSection === "general"}
          <div class="cz-settings-section">
            <h3 class="cz-section-title">Application</h3>
            <div class="cz-field-row">
              <span class="cz-field-label">Version</span>
              <span class="cz-field-val">1.13.0-a1</span>
            </div>
            <div class="cz-field-row">
              <span class="cz-field-label">Architecture</span>
              <span class="cz-field-val">Svelte 5 + Framework-Independent TypeScript</span>
            </div>

            <h3 class="cz-section-title" style="margin-top: 1.5rem">Data Management</h3>
            <div class="cz-btn-group">
              <button type="button" class="cz-btn cz-btn-secondary" onclick={handleReset}>
                Reset all settings
              </button>
              <button type="button" class="cz-btn cz-btn-danger" onclick={handleClearData}>
                Clear local data
              </button>
            </div>
          </div>
        {:else if activeSection === "appearance"}
          <div class="cz-settings-section">
            <h3 class="cz-section-title">Theme</h3>
            <p class="cz-section-desc">Select how CompressZ appears on your screen.</p>
            <div class="cz-radio-group">
              <label class="cz-radio-label">
                <input
                  type="radio"
                  name="theme"
                  checked={themePref === "system"}
                  onchange={() => handleThemeChange("system")}
                />
                <span>Follow system</span>
              </label>
              <label class="cz-radio-label">
                <input
                  type="radio"
                  name="theme"
                  checked={themePref === "light"}
                  onchange={() => handleThemeChange("light")}
                />
                <span>Light mode</span>
              </label>
              <label class="cz-radio-label">
                <input
                  type="radio"
                  name="theme"
                  checked={themePref === "dark"}
                  onchange={() => handleThemeChange("dark")}
                />
                <span>Dark mode</span>
              </label>
            </div>
          </div>
        {:else if activeSection === "performance"}
          <div class="cz-settings-section">
            <h3 class="cz-section-title">Resource Guard</h3>
            <p class="cz-section-desc">Controls worker admission and image size thresholds.</p>
            <div class="cz-field-row">
              <label class="cz-field-label" for="res-mode">Resource Profile</label>
              <select
                id="res-mode"
                class="cz-select"
                value={settings.resourceMode}
                onchange={(e) =>
                  saveChanges({
                    resourceMode: (e.target as HTMLSelectElement).value as any,
                  })}
              >
                <option value="auto">Auto (device-tuned)</option>
                <option value="memory-saver">Memory Saver</option>
                <option value="balanced">Balanced</option>
                <option value="maximum">Maximum</option>
              </select>
            </div>
            <div class="cz-field-row">
              <span class="cz-field-label">Active Concurrency Limit</span>
              <span class="cz-field-val">{profile.concurrency} concurrent tasks</span>
            </div>
            <div class="cz-field-row">
              <span class="cz-field-label">Dimension Ceiling</span>
              <span class="cz-field-val">
                {profile.maxImageDim === 0 ? "Uncapped" : `${profile.maxImageDim}px`}
              </span>
            </div>
          </div>
        {:else if activeSection === "ai"}
          <div class="cz-settings-section">
            <h3 class="cz-section-title">Local Machine Learning</h3>
            <p class="cz-section-desc">Configures on-device classification and TrOCR handwriting.</p>
            <div class="cz-field-row">
              <label class="cz-field-label" for="ai-backend">Inference Backend</label>
              <select
                id="ai-backend"
                class="cz-select"
                value={settings.ai.backend}
                onchange={(e) =>
                  saveChanges({
                    ai: {
                      ...settings.ai,
                      backend: (e.target as HTMLSelectElement).value as any,
                    },
                  })}
              >
                <option value="auto">Auto (WebGPU with WASM fallback)</option>
                <option value="webgpu">WebGPU Preferred</option>
                <option value="wasm">CPU / WASM (Reliable fallback)</option>
              </select>
            </div>
            <div class="cz-field-row">
              <label class="cz-field-label" for="ai-tier">Vision Model Tier</label>
              <select
                id="ai-tier"
                class="cz-select"
                value={settings.ai.modelTier}
                onchange={(e) =>
                  saveChanges({
                    ai: {
                      ...settings.ai,
                      modelTier: (e.target as HTMLSelectElement).value as any,
                    },
                  })}
              >
                <option value="efficient">Efficient (MobileNetV2 ~14MB)</option>
                <option value="powerful">Powerful (ViT Base ~340MB)</option>
              </select>
            </div>
          </div>
        {:else if activeSection === "compression"}
          <div class="cz-settings-section">
            <h3 class="cz-section-title">Engine Defaults</h3>
            <div class="cz-field-row">
              <label class="cz-field-label" for="img-qual">Default Image Quality</label>
              <input
                id="img-qual"
                type="number"
                min="1"
                max="100"
                value={settings.engines.images.quality}
                class="cz-input cz-input-sm"
                onchange={(e) =>
                  saveChanges({
                    engines: {
                      ...settings.engines,
                      images: {
                        ...settings.engines.images,
                        quality: Number((e.target as HTMLInputElement).value),
                      },
                    },
                  })}
              />
            </div>
            <div class="cz-field-row">
              <label class="cz-field-label" for="ocr-eng">Default OCR Engine</label>
              <select
                id="ocr-eng"
                class="cz-select"
                value={settings.engines.ocr.engine}
                onchange={(e) =>
                  saveChanges({
                    engines: {
                      ...settings.engines,
                      ocr: {
                        ...settings.engines.ocr,
                        engine: (e.target as HTMLSelectElement).value as any,
                      },
                    },
                  })}
              >
                <option value="auto">Auto (Tesseract default)</option>
                <option value="tesseract">Tesseract.js 5 (Broad language support)</option>
                <option value="paddle">PaddleOCR (Experimental CJK/Latin)</option>
              </select>
            </div>
          </div>
        {:else if activeSection === "privacy"}
          <div class="cz-settings-section">
            <h3 class="cz-section-title">Privacy Invariants</h3>
            <p class="cz-section-desc">
              All files, page previews, OCR transcripts, and document metadata remain
              strictly in your browser memory.
            </p>
            <div class="cz-privacy-box">
              <ul>
                <li>✓ Zero file uploads or remote processing</li>
                <li>✓ No analytics, tracking pixels, or telemetry</li>
                <li>✓ No third-party cookie persistence</li>
                <li>✓ Local on-device inference via WebAssembly and WebGPU</li>
              </ul>
            </div>
          </div>
        {:else if activeSection === "diagnostics"}
          <div class="cz-settings-section">
            <h3 class="cz-section-title">Browser Environment</h3>
            <div class="cz-field-row">
              <span class="cz-field-label">WebGL2 Acceleration</span>
              <span class="cz-field-val">Available</span>
            </div>
            <div class="cz-field-row">
              <span class="cz-field-label">WebGPU Device</span>
              <span class="cz-field-val">
                {typeof navigator !== "undefined" && "gpu" in navigator ? "Supported" : "Unsupported"}
              </span>
            </div>
            <div class="cz-field-row">
              <span class="cz-field-label">OffscreenCanvas</span>
              <span class="cz-field-val">
                {typeof OffscreenCanvas !== "undefined" ? "Supported" : "Unsupported"}
              </span>
            </div>
            <div class="cz-field-row">
              <span class="cz-field-label">CompressionStream (ZIP)</span>
              <span class="cz-field-val">
                {typeof CompressionStream !== "undefined" ? "Supported" : "Unsupported"}
              </span>
            </div>
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .cz-dialog-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    backdrop-filter: blur(4px);
    z-index: 1000;
  }
  .cz-settings-dialog {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 92%;
    max-width: 760px;
    height: 75vh;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r);
    box-shadow: var(--shadow-xl);
    z-index: 1001;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .cz-dialog-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1.15rem 1.35rem 0.85rem;
    border-bottom: 1px solid var(--border);
  }
  .cz-dialog-title {
    font-family: var(--display);
    font-size: 1.2rem;
    font-weight: 700;
    color: var(--text);
  }
  .cz-settings-body {
    display: flex;
    flex: 1;
    min-height: 0;
  }
  .cz-settings-nav {
    width: 200px;
    border-right: 1px solid var(--border);
    background: var(--surface2);
    padding: 0.85rem 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    overflow-y: auto;
  }
  .cz-settings-nav-btn {
    text-align: left;
    padding: 0.55rem 0.75rem;
    border-radius: var(--r-xs);
    font-size: 0.86rem;
    font-weight: 500;
    color: var(--text-2);
    transition: background var(--t), color var(--t);
  }
  .cz-settings-nav-btn:hover {
    background: var(--bg2);
    color: var(--text);
  }
  .cz-settings-nav-btn.is-active {
    background: var(--accent-soft);
    color: var(--accent);
    font-weight: 600;
  }
  .cz-settings-content {
    flex: 1;
    padding: 1.5rem;
    overflow-y: auto;
  }
  .cz-section-title {
    font-family: var(--display);
    font-size: 1.05rem;
    font-weight: 700;
    color: var(--text);
    margin-bottom: 0.25rem;
  }
  .cz-section-desc {
    font-size: 0.84rem;
    color: var(--text-3);
    margin-bottom: 1.15rem;
  }
  .cz-field-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.65rem 0;
    border-bottom: 1px solid var(--border);
    font-size: 0.88rem;
  }
  .cz-field-label {
    color: var(--text-2);
    font-weight: 500;
  }
  .cz-field-val {
    font-family: var(--mono);
    color: var(--text);
    font-size: 0.84rem;
  }
  .cz-select {
    padding: 0.35rem 0.65rem;
    border-radius: var(--r-xs);
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    font-size: 0.86rem;
  }
  .cz-input-sm {
    width: 80px;
    padding: 0.35rem 0.5rem;
    border-radius: var(--r-xs);
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    font-family: var(--mono);
    text-align: right;
  }
  .cz-radio-group {
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
  }
  .cz-radio-label {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    font-size: 0.88rem;
    color: var(--text);
    cursor: pointer;
  }
  .cz-btn-group {
    display: flex;
    gap: 0.75rem;
    margin-top: 0.85rem;
  }
  .cz-privacy-box {
    padding: 1rem;
    background: var(--surface2);
    border-radius: var(--r-sm);
    border: 1px solid var(--border);
  }
  .cz-privacy-box ul {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    font-size: 0.86rem;
    color: var(--text);
  }
</style>
