<script lang="ts">
  import {
    getSettings,
    updateSettings,
    resetSettings,
    resolveExecutionProfile,
    resolvedConcurrency,
    type Settings,
    type ResourceMode,
  } from "../lib/settings";
  import { getThemePreference, setThemePreference, THEME_EVENT } from "../lib/theme";
  import {
    clearDismissedRecommendations,
    dismissedRecommendationCount,
  } from "../lib/recommendations";
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
    | "general"
    | "appearance"
    | "performance"
    | "ai"
    | "suggestions"
    | "compression"
    | "privacy"
    | "diagnostics"
  >("general");

  let resetArmed = $state(false);
  let clearArmed = $state(false);
  let dismissedCount = $state(0);

  function reloadSettings() {
    settings = getSettings();
    themePref = getThemePreference();
    dismissedCount = dismissedRecommendationCount();
  }

  onMount(() => {
    reloadSettings();
    document.addEventListener(THEME_EVENT, reloadSettings);
    return () => {
      document.removeEventListener(THEME_EVENT, reloadSettings);
    };
  });

  $effect(() => {
    if (open) {
      reloadSettings();
      resetArmed = false;
      clearArmed = false;
    }
  });

  function saveChanges(patch: Partial<Settings>) {
    updateSettings((s) => {
      if (patch.resourceMode !== undefined) s.resourceMode = patch.resourceMode;
      if (patch.resourceLimits !== undefined) {
        s.resourceLimits = { ...s.resourceLimits, ...patch.resourceLimits };
      }
      if (patch.gpu !== undefined) {
        s.gpu = { ...s.gpu, ...patch.gpu };
      }
      if (patch.ai !== undefined) {
        s.ai = { ...s.ai, ...patch.ai };
      }
      if (patch.recommendations !== undefined) {
        s.recommendations = { ...s.recommendations, ...patch.recommendations };
      }
    });
    settings = getSettings();
    toast("Settings updated", "success");
  }

  function handleThemeChange(val: "light" | "dark" | "system") {
    setThemePreference(val);
    themePref = val;
    toast(`Theme set to ${val}`, "success");
  }

  function handleClose() {
    onClose();
    setTimeout(() => {
      document.getElementById("settings-btn")?.focus();
    }, 0);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && open) {
      handleClose();
    }
  }

  const profile = $derived(resolveExecutionProfile(settings));
  const autoConcurrency = $derived(
    resolvedConcurrency({
      ...settings,
      resourceLimits: { ...settings.resourceLimits, concurrency: "auto" },
    })
  );

  const resolvedThemeLabel = $derived.by(() => {
    if (typeof window === "undefined") return "Dark";
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches
      ? "Dark"
      : "Light";
  });

  const imagePathLabel = $derived.by(() => {
    const hasOffscreen = typeof OffscreenCanvas !== "undefined";
    if (!settings.gpu.images) {
      return hasOffscreen
        ? "Canvas/OffscreenCanvas only (no WebGL2 resize)"
        : "DOM canvas only";
    }
    return "Canvas/OffscreenCanvas + WebGL2 resize";
  });
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
  <div class="cz-dialog-backdrop" onclick={handleClose} role="presentation"></div>
  <div
    id="settings-dialog"
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
        onclick={handleClose}
      >
        ✕
      </button>
    </div>

    <div class="cz-settings-body">
      <nav id="settings-nav" class="cz-settings-nav" aria-label="Settings categories">
        <button
          type="button"
          class="cz-settings-nav-btn cz-settings__nav-btn {activeSection === 'general' ? 'is-active' : ''}"
          aria-current={activeSection === "general" ? "true" : undefined}
          onclick={() => (activeSection = "general")}
        >
          General
        </button>
        <button
          type="button"
          class="cz-settings-nav-btn cz-settings__nav-btn {activeSection === 'appearance' ? 'is-active' : ''}"
          aria-current={activeSection === "appearance" ? "true" : undefined}
          onclick={() => (activeSection = "appearance")}
        >
          Appearance
        </button>
        <button
          type="button"
          class="cz-settings-nav-btn cz-settings__nav-btn {activeSection === 'performance' ? 'is-active' : ''}"
          aria-current={activeSection === "performance" ? "true" : undefined}
          onclick={() => (activeSection = "performance")}
        >
          Performance
        </button>
        <button
          type="button"
          class="cz-settings-nav-btn cz-settings__nav-btn {activeSection === 'ai' ? 'is-active' : ''}"
          aria-current={activeSection === "ai" ? "true" : undefined}
          onclick={() => (activeSection = "ai")}
        >
          AI engine
        </button>
        <button
          type="button"
          class="cz-settings-nav-btn cz-settings__nav-btn {activeSection === 'suggestions' ? 'is-active' : ''}"
          aria-current={activeSection === "suggestions" ? "true" : undefined}
          onclick={() => (activeSection = "suggestions")}
        >
          Suggestions
        </button>
        <button
          type="button"
          class="cz-settings-nav-btn cz-settings__nav-btn {activeSection === 'compression' ? 'is-active' : ''}"
          aria-current={activeSection === "compression" ? "true" : undefined}
          onclick={() => (activeSection = "compression")}
        >
          Compression
        </button>
        <button
          type="button"
          class="cz-settings-nav-btn cz-settings__nav-btn {activeSection === 'privacy' ? 'is-active' : ''}"
          aria-current={activeSection === "privacy" ? "true" : undefined}
          onclick={() => (activeSection = "privacy")}
        >
          Privacy & data
        </button>
        <button
          type="button"
          class="cz-settings-nav-btn cz-settings__nav-btn {activeSection === 'diagnostics' ? 'is-active' : ''}"
          aria-current={activeSection === "diagnostics" ? "true" : undefined}
          onclick={() => (activeSection = "diagnostics")}
        >
          Diagnostics
        </button>
      </nav>

      <div id="settings-panel" class="cz-settings-content">
        {#if activeSection === "general"}
          <div class="cz-settings-section">
            <h3 class="cz-section-title">About CompressZ</h3>
            <div class="cz-field-row device-info-row">
              <span class="cz-field-label device-info-label">Version</span>
              <span class="cz-field-val device-info-val">1.13.0-a1</span>
            </div>
            <div class="cz-field-row device-info-row">
              <span class="cz-field-label device-info-label">Architecture</span>
              <span class="cz-field-val device-info-val">Svelte 5 + Framework-Independent TypeScript</span>
            </div>

            <h3 class="cz-section-title" style="margin-top: 1.5rem">Data Management</h3>
            <div class="cz-btn-group">
              {#if !resetArmed}
                <button
                  type="button"
                  class="cz-btn cz-btn-secondary"
                  onclick={() => (resetArmed = true)}
                >
                  Reset all settings
                </button>
              {:else}
                <button
                  type="button"
                  class="cz-btn cz-btn-danger"
                  onclick={() => {
                    resetSettings();
                    settings = getSettings();
                    resetArmed = false;
                    toast("All settings reset to defaults", "success");
                  }}
                >
                  Confirm reset — click again
                </button>
              {/if}

              {#if !clearArmed}
                <button
                  type="button"
                  class="cz-btn cz-btn-ghost"
                  onclick={() => (clearArmed = true)}
                >
                  Clear local data
                </button>
              {:else}
                <button
                  type="button"
                  class="cz-btn cz-btn-danger"
                  onclick={() => {
                    localStorage.clear();
                    resetSettings();
                    settings = getSettings();
                    clearArmed = false;
                    toast("All local data cleared", "success");
                  }}
                >
                  Confirm clear — click again
                </button>
              {/if}
            </div>
          </div>
        {:else if activeSection === "appearance"}
          <div class="cz-settings-section">
            <h3 class="cz-section-title">Theme</h3>
            <p class="cz-section-desc">Select how CompressZ appears on your screen.</p>
            <div class="cz-btn-group" role="group" aria-label="Theme selection">
              <button
                type="button"
                class="cz-btn cz-btn-sm {themePref === 'system' ? 'cz-btn-primary' : 'cz-btn-secondary'}"
                aria-pressed={themePref === "system" ? "true" : "false"}
                onclick={() => handleThemeChange("system")}
              >
                System ({resolvedThemeLabel})
              </button>
              <button
                type="button"
                class="cz-btn cz-btn-sm {themePref === 'light' ? 'cz-btn-primary' : 'cz-btn-secondary'}"
                aria-pressed={themePref === "light" ? "true" : "false"}
                onclick={() => handleThemeChange("light")}
              >
                Light
              </button>
              <button
                type="button"
                class="cz-btn cz-btn-sm {themePref === 'dark' ? 'cz-btn-primary' : 'cz-btn-secondary'}"
                aria-pressed={themePref === "dark" ? "true" : "false"}
                onclick={() => handleThemeChange("dark")}
              >
                Dark
              </button>
            </div>
          </div>
        {:else if activeSection === "performance"}
          <div class="cz-settings-section">
            <h3 class="cz-section-title">Adaptive Resource Guard</h3>
            <p class="cz-section-desc">Controls worker admission and job concurrency pools.</p>

            <div class="cz-field-row">
              <span class="cz-field-label">Resource mode</span>
              <div class="cz-btn-group" role="group" aria-label="Resource mode selection">
                {#each ["auto", "memory-saver", "balanced", "maximum"] as mode}
                  <button
                    type="button"
                    class="cz-btn cz-btn-sm {settings.resourceMode === mode ? 'cz-btn-primary' : 'cz-btn-secondary'}"
                    aria-pressed={settings.resourceMode === mode ? "true" : "false"}
                    onclick={() => saveChanges({ resourceMode: mode as ResourceMode })}
                  >
                    {mode === "auto" ? "Auto" : mode === "memory-saver" ? "Memory Saver" : mode === "balanced" ? "Balanced" : "Maximum"}
                  </button>
                {/each}
              </div>
            </div>

            <div class="cz-field-row">
              <span class="cz-field-label">Concurrency ceiling</span>
              <div class="cz-btn-group" role="group" aria-label="Files processed at once (batches)">
                <button
                  type="button"
                  class="cz-btn cz-btn-sm {settings.resourceLimits.concurrency === 'auto' ? 'cz-btn-primary' : 'cz-btn-secondary'}"
                  aria-pressed={settings.resourceLimits.concurrency === "auto" ? "true" : "false"}
                  onclick={() => saveChanges({ resourceLimits: { ...settings.resourceLimits, concurrency: "auto" } })}
                >
                  Auto ({autoConcurrency})
                </button>
                {#each [1, 2, 3, 4] as count}
                  <button
                    type="button"
                    class="cz-btn cz-btn-sm {settings.resourceLimits.concurrency === count ? 'cz-btn-primary' : 'cz-btn-secondary'}"
                    aria-pressed={settings.resourceLimits.concurrency === count ? "true" : "false"}
                    onclick={() => saveChanges({ resourceLimits: { ...settings.resourceLimits, concurrency: count } })}
                  >
                    {count}
                  </button>
                {/each}
              </div>
            </div>

            <div class="cz-field-row">
              <span class="cz-field-label">Hardware Acceleration</span>
              <button
                type="button"
                role="switch"
                class="cz-btn cz-btn-sm {settings.gpu.images ? 'cz-btn-primary' : 'cz-btn-secondary'}"
                aria-label="GPU acceleration for Images"
                aria-checked={settings.gpu.images ? "true" : "false"}
                onclick={() => saveChanges({ gpu: { ...settings.gpu, images: !settings.gpu.images } })}
              >
                GPU acceleration for Images: {settings.gpu.images ? "Enabled" : "Disabled"}
              </button>
            </div>

            <div data-testid="resource-status" class="cz-resource-status-box" style="margin-top: 1rem">
              <div class="cz-status-head">
                <strong>Resource Guard:</strong> 0 running · admission: active
              </div>
              <p class="cz-status-note">
                Scheduling based on file metadata; not a memory meter.
              </p>
            </div>
          </div>
        {:else if activeSection === "ai"}
          <div class="cz-settings-section">
            <h3 class="cz-section-title">AI engine — local</h3>
            <p class="cz-section-desc">On-device neural inference for tagging, sorting, and handwriting recognition.</p>

            <div class="cz-field-row">
              <span class="cz-field-label">Inference backend</span>
              <div class="cz-btn-group" role="group" aria-label="Inference backend selection">
                <button
                  type="button"
                  class="cz-btn cz-btn-sm {settings.ai.backend === 'auto' ? 'cz-btn-primary' : 'cz-btn-secondary'}"
                  aria-pressed={settings.ai.backend === "auto" ? "true" : "false"}
                  onclick={() => saveChanges({ ai: { ...settings.ai, backend: "auto" } })}
                >
                  Auto
                </button>
                <button
                  type="button"
                  class="cz-btn cz-btn-sm {settings.ai.backend === 'webgpu' ? 'cz-btn-primary' : 'cz-btn-secondary'}"
                  aria-pressed={settings.ai.backend === "webgpu" ? "true" : "false"}
                  onclick={() => saveChanges({ ai: { ...settings.ai, backend: "webgpu" } })}
                >
                  WebGPU first
                </button>
                <button
                  type="button"
                  class="cz-btn cz-btn-sm {settings.ai.backend === 'wasm' ? 'cz-btn-primary' : 'cz-btn-secondary'}"
                  aria-pressed={settings.ai.backend === "wasm" ? "true" : "false"}
                  onclick={() => saveChanges({ ai: { ...settings.ai, backend: "wasm" } })}
                >
                  CPU (WASM)
                </button>
              </div>
            </div>
          </div>
        {:else if activeSection === "suggestions"}
          <div class="cz-settings-section">
            <h3 class="cz-section-title">Contextual suggestions</h3>
            <p class="cz-section-desc">
              Deterministic, model-free hints that notice opportunities to save size or correct sequence order.
            </p>

            <div class="cz-field-row">
              <span class="cz-field-label">Dismissed suggestions</span>
              <span class="cz-field-val">
                {dismissedCount} dismissed suggestion{dismissedCount === 1 ? "" : "s"}
              </span>
            </div>

            <div style="margin-top: 1rem">
              <button
                type="button"
                class="cz-btn cz-btn-secondary"
                onclick={() => {
                  clearDismissedRecommendations();
                  dismissedCount = 0;
                  toast("Cleared dismissed suggestions", "success");
                }}
              >
                Clear dismissed suggestions
              </button>
            </div>
          </div>
        {:else if activeSection === "compression"}
          <div class="cz-settings-section">
            <h3 class="cz-section-title">Default engine and output formats</h3>
            <p class="cz-section-desc">Configure baseline quality, DPI, and audio presets.</p>
            <div class="cz-field-row">
              <span class="cz-field-label">Default image format</span>
              <span class="cz-field-val">{settings.engines.images.format}</span>
            </div>
            <div class="cz-field-row">
              <span class="cz-field-label">Default image quality</span>
              <span class="cz-field-val">{settings.engines.images.quality}%</span>
            </div>
          </div>
        {:else if activeSection === "privacy"}
          <div class="cz-settings-section">
            <h3 class="cz-section-title">Stored in this browser</h3>
            <p class="cz-section-desc">
              CompressZ stores user preferences in your browser's localStorage. Zero tracking cookies, zero analytics, zero server uploads.
            </p>
            <div class="cz-field-row">
              <span class="cz-field-label">Storage key</span>
              <span class="cz-field-val">cz-settings-v2</span>
            </div>
          </div>
        {:else if activeSection === "diagnostics"}
          <div class="cz-settings-section">
            <h3 class="cz-section-title">This Device</h3>
            <div class="cz-field-row device-info-row">
              <span class="cz-field-label device-info-label">Image path</span>
              <span class="cz-field-val device-info-val">{imagePathLabel}</span>
            </div>
            <div class="cz-field-row device-info-row">
              <span class="cz-field-label device-info-label">Batch concurrency</span>
              <span class="cz-field-val device-info-val">{resolvedConcurrency(settings)} files at once</span>
            </div>
            <div class="cz-field-row device-info-row">
              <span class="cz-field-label device-info-label">Video path</span>
              <span class="cz-field-val device-info-val">WebCodecs + Mediabunny fast path (FFmpeg fallback)</span>
            </div>
            <div class="cz-field-row device-info-row">
              <span class="cz-field-label device-info-label">Image quality guard</span>
              <span class="cz-field-val device-info-val">SSIM guard active (never silently rescales)</span>
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
    z-index: 999;
  }
  .cz-settings-dialog {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 90vw;
    max-width: 820px;
    max-height: 88vh;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r);
    z-index: 1000;
    display: flex;
    flex-direction: column;
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.25);
    overflow: hidden;
  }
  .cz-dialog-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem 1.4rem;
    border-bottom: 1px solid var(--border);
  }
  .cz-dialog-title {
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--text);
  }
  .cz-settings-body {
    display: flex;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
  .cz-settings-nav {
    width: 200px;
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    padding: 0.6rem 0.5rem;
    gap: 0.2rem;
    background: var(--surface2);
    overflow-y: auto;
  }
  .cz-settings-nav-btn {
    text-align: left;
    padding: 0.55rem 0.85rem;
    border-radius: var(--r-sm);
    font-size: 0.88rem;
    font-weight: 550;
    color: var(--text-2);
    background: transparent;
    border: none;
    cursor: pointer;
    transition: background var(--t), color var(--t);
  }
  .cz-settings-nav-btn:hover {
    background: var(--surface);
    color: var(--text);
  }
  .cz-settings-nav-btn.is-active {
    background: var(--surface);
    color: var(--accent);
    font-weight: 700;
  }
  .cz-settings-content {
    flex: 1;
    padding: 1.5rem;
    overflow-y: auto;
  }
  .cz-settings-section {
    display: flex;
    flex-direction: column;
    gap: 1.15rem;
  }
  .cz-section-title {
    font-size: 1.15rem;
    font-weight: 700;
    color: var(--text);
  }
  .cz-section-desc {
    font-size: 0.87rem;
    color: var(--text-3);
    margin-top: -0.6rem;
  }
  .cz-field-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    padding: 0.65rem 0;
    border-bottom: 1px solid var(--border);
  }
  .cz-field-label {
    font-size: 0.88rem;
    font-weight: 600;
    color: var(--text);
  }
  .cz-field-val {
    font-size: 0.88rem;
    color: var(--text-2);
  }
  .cz-btn-group {
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
  }
  .cz-resource-status-box {
    padding: 0.85rem 1rem;
    border-radius: var(--r-sm);
    background: var(--surface2);
    border: 1px solid var(--border);
    font-size: 0.86rem;
  }
  .cz-status-head {
    color: var(--text);
    margin-bottom: 0.25rem;
  }
  .cz-status-note {
    color: var(--text-3);
    font-size: 0.8rem;
  }

  @media (max-width: 640px) {
    .cz-settings-body {
      flex-direction: column;
    }
    .cz-settings-nav {
      width: 100%;
      flex-direction: row;
      overflow-x: auto;
      border-right: none;
      border-bottom: 1px solid var(--border);
    }
    .cz-settings-nav-btn {
      white-space: nowrap;
    }
  }
</style>
