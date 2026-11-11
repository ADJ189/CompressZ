<script lang="ts">
  const appVersion = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "1.14.1";

  import {
    getSettings,
    updateSettings,
    resetSettings,
    defaultSettings,
    resolveExecutionProfile,
    resolvedConcurrency,
    type AppSettings as Settings,
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
      if (patch.engines !== undefined) {
        s.engines = {
          ...s.engines,
          ...patch.engines,
          images: { ...s.engines.images, ...(patch.engines.images ?? {}) },
          pdf: { ...s.engines.pdf, ...(patch.engines.pdf ?? {}) },
          video: { ...s.engines.video, ...(patch.engines.video ?? {}) },
          audio: { ...s.engines.audio, ...(patch.engines.audio ?? {}) },
        };
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
      <div class="cz-dialog-title-group">
        <h2 id="settings-dialog-title" class="cz-dialog-title">System Settings</h2>
        <span class="cz-dialog-sub">Apple-style fast configuration</span>
      </div>
      <button
        type="button"
        class="cz-dialog-close"
        aria-label="Close dialog"
        onclick={handleClose}
      >
        ✕
      </button>
    </div>

    <div class="cz-settings-body">
      <!-- Left Category Navigation -->
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

      <!-- Right Inset Content -->
      <div id="settings-panel" class="cz-settings-content">
        {#if activeSection === "general"}
          <div class="cz-settings-group">
            <div class="cz-settings-row">
              <div>
                <div class="cz-settings-label">About CompressZ</div>
                <div class="cz-settings-desc">Client-side document and media suite</div>
              </div>
              <span class="cz-tier-tag">v{appVersion}</span>
            </div>
            <div class="cz-settings-row device-info-row">
              <div>
                <div class="cz-settings-label">Version</div>
                <div class="cz-settings-desc">CompressZ release stream</div>
              </div>
              <span class="cz-tier-tag device-info-val">{appVersion}</span>
            </div>
            <div class="cz-settings-row device-info-row">
              <div>
                <div class="cz-settings-label">UI Framework</div>
                <div class="cz-settings-desc">Svelte 5 Runes</div>
              </div>
              <span class="cz-tier-tag device-info-val">Reactive Native</span>
            </div>
          </div>

          <div class="cz-settings-group">
            <div class="cz-settings-row">
              <div>
                <div class="cz-settings-label">Reset Settings</div>
                <div class="cz-settings-desc">Restore defaults for all engine toggles</div>
              </div>
              {#if !resetArmed}
                <button
                  type="button"
                  class="cz-btn cz-btn-secondary cz-btn-sm cz-btn-pill"
                  onclick={() => (resetArmed = true)}
                >
                  Reset all settings
                </button>
              {:else}
                <button
                  type="button"
                  class="cz-btn cz-btn-danger cz-btn-sm cz-btn-pill"
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
            </div>

            <div class="cz-settings-row">
              <div>
                <div class="cz-settings-label">Clear Local Cache</div>
                <div class="cz-settings-desc">Delete stored recents and dismissals</div>
              </div>
              {#if !clearArmed}
                <button
                  type="button"
                  class="cz-btn cz-btn-ghost cz-btn-sm cz-btn-pill"
                  onclick={() => (clearArmed = true)}
                >
                  Clear Data
                </button>
              {:else}
                <button
                  type="button"
                  class="cz-btn cz-btn-danger cz-btn-sm cz-btn-pill"
                  onclick={() => {
                    localStorage.clear();
                    resetSettings();
                    settings = getSettings();
                    clearArmed = false;
                    toast("Local data cleared", "success");
                  }}
                >
                  Confirm Clear
                </button>
              {/if}
            </div>
          </div>

        {:else if activeSection === "appearance"}
          <div class="cz-settings-group">
            <div class="cz-settings-row">
              <div>
                <div class="cz-settings-label">Theme Mode</div>
                <div class="cz-settings-desc">Currently: {resolvedThemeLabel}</div>
              </div>
              <div class="cz-segmented-track" role="group" aria-label="Theme selection">
                <button
                  type="button"
                  class="cz-segmented-item {themePref === 'system' ? 'is-active' : ''}"
                  aria-pressed={themePref === "system" ? "true" : "false"}
                  onclick={() => handleThemeChange("system")}
                >
                  System ({resolvedThemeLabel})
                </button>
                <button
                  type="button"
                  class="cz-segmented-item {themePref === 'light' ? 'is-active' : ''}"
                  aria-pressed={themePref === "light" ? "true" : "false"}
                  onclick={() => handleThemeChange("light")}
                >
                  Light
                </button>
                <button
                  type="button"
                  class="cz-segmented-item {themePref === 'dark' ? 'is-active' : ''}"
                  aria-pressed={themePref === "dark" ? "true" : "false"}
                  onclick={() => handleThemeChange("dark")}
                >
                  Dark
                </button>
              </div>
            </div>
          </div>

        {:else if activeSection === "performance"}
          <div class="cz-settings-group">
            <div class="cz-settings-row">
              <div>
                <div class="cz-settings-label">Adaptive Resource Guard</div>
                <div class="cz-settings-desc">Concurrency and admission guard</div>
              </div>
              <div class="cz-segmented-track" role="group" aria-label="Resource mode selection">
                {#each ["auto", "memory-saver", "balanced", "maximum"] as mode}
                  <button
                    type="button"
                    class="cz-segmented-item {settings.resourceMode === mode ? 'is-active' : ''}"
                    aria-pressed={settings.resourceMode === mode ? "true" : "false"}
                    onclick={() => saveChanges({ resourceMode: mode as ResourceMode })}
                  >
                    {mode === "auto" ? "Auto" : mode === "memory-saver" ? "Saver" : mode === "balanced" ? "Balanced" : "Maximum"}
                  </button>
                {/each}
              </div>
            </div>

            <div class="cz-settings-row">
              <div>
                <div class="cz-settings-label">Batch Concurrency</div>
                <div class="cz-settings-desc">Simultaneous files processed</div>
              </div>
              <div class="cz-segmented-track" role="group" aria-label="Files processed at once (batches)">
                <button
                  type="button"
                  class="cz-segmented-item {settings.resourceLimits.concurrency === 'auto' ? 'is-active' : ''}"
                  onclick={() => saveChanges({ resourceLimits: { ...settings.resourceLimits, concurrency: "auto" } })}
                >
                  Auto ({autoConcurrency})
                </button>
                {#each [1, 2, 4] as count}
                  <button
                    type="button"
                    class="cz-segmented-item {settings.resourceLimits.concurrency === count ? 'is-active' : ''}"
                    onclick={() => saveChanges({ resourceLimits: { ...settings.resourceLimits, concurrency: count } })}
                  >
                    {count}
                  </button>
                {/each}
              </div>
            </div>

            <div class="cz-settings-row">
              <div>
                <div class="cz-settings-label">WebGL2 Image Resize</div>
                <div class="cz-settings-desc">Hardware-accelerated bilinear resampling</div>
              </div>
              <button
                type="button"
                role="switch"
                class="cz-btn cz-btn-sm cz-btn-pill {settings.gpu.images ? 'cz-btn-primary' : 'cz-btn-secondary'}"
                aria-label="GPU acceleration for Images"
                aria-checked={settings.gpu.images ? "true" : "false"}
                onclick={() => saveChanges({ gpu: { ...settings.gpu, images: !settings.gpu.images } })}
              >
                {settings.gpu.images ? "Enabled" : "Disabled"}
              </button>
            </div>
          </div>

          <div data-testid="resource-status" class="cz-sidebar-card">
            <div class="cz-sidebar-header">
              <span class="cz-sidebar-title">Resource Guard Status</span>
              <span class="cz-tier-tag">Active</span>
            </div>
            <div class="cz-sidebar-meta">
              0 running · 0 queued · admission: safe heuristics · not a memory meter
            </div>
          </div>

        {:else if activeSection === "ai"}
          <div class="cz-settings-group">
            <div class="cz-settings-row">
              <div>
                <div class="cz-settings-label">AI engine — local</div>
                <div class="cz-settings-desc">Client-side neural processing with ONNX Runtime Web</div>
              </div>
            </div>

            <div class="cz-settings-row">
              <div>
                <div class="cz-settings-label">Model Tier</div>
                <div class="cz-settings-desc">MobileNet (~14 MB) vs ViT (~85 MB)</div>
              </div>
              <div class="cz-segmented-track" role="group" aria-label="Model tier selection">
                <button
                  type="button"
                  class="cz-segmented-item {settings.ai?.modelTier !== 'powerful' ? 'is-active' : ''}"
                  onclick={() => saveChanges({ ai: { ...settings.ai, modelTier: "efficient" } })}
                >
                  ⚡ Efficient
                </button>
                <button
                  type="button"
                  class="cz-segmented-item {settings.ai?.modelTier === 'powerful' ? 'is-active' : ''}"
                  onclick={() => saveChanges({ ai: { ...settings.ai, modelTier: "powerful" } })}
                >
                  🧠 Powerful
                </button>
              </div>
            </div>

            <div class="cz-settings-row">
              <div>
                <div class="cz-settings-label">Inference Backend</div>
                <div class="cz-settings-desc">Hardware acceleration preference</div>
              </div>
              <div class="cz-segmented-track" role="group" aria-label="Inference backend selection">
                <button
                  type="button"
                  class="cz-segmented-item {settings.ai.backend === 'auto' ? 'is-active' : ''}"
                  aria-pressed={settings.ai.backend === "auto" ? "true" : "false"}
                  onclick={() => saveChanges({ ai: { ...settings.ai, backend: "auto" } })}
                >
                  Auto
                </button>
                <button
                  type="button"
                  class="cz-segmented-item {settings.ai.backend === 'webgpu' ? 'is-active' : ''}"
                  aria-pressed={settings.ai.backend === "webgpu" ? "true" : "false"}
                  onclick={() => saveChanges({ ai: { ...settings.ai, backend: "webgpu" } })}
                >
                  WebGPU first
                </button>
                <button
                  type="button"
                  class="cz-segmented-item {settings.ai.backend === 'wasm' ? 'is-active' : ''}"
                  aria-pressed={settings.ai.backend === "wasm" ? "true" : "false"}
                  onclick={() => saveChanges({ ai: { ...settings.ai, backend: "wasm" } })}
                >
                  CPU (WASM)
                </button>
              </div>
            </div>
          </div>

        {:else if activeSection === "suggestions"}
          <div class="cz-settings-group">
            <div class="cz-settings-row">
              <div>
                <div class="cz-settings-label">Contextual suggestions</div>
                <div class="cz-settings-desc">Workflow hints and smart format optimizations</div>
              </div>
            </div>
            <div class="cz-settings-row">
              <div>
                <div class="cz-settings-label">Dismissed Hints</div>
                <div class="cz-settings-desc">{dismissedCount} dismissed suggestion{dismissedCount === 1 ? "" : "s"}</div>
              </div>
              <button
                type="button"
                class="cz-btn cz-btn-secondary cz-btn-sm cz-btn-pill"
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
          <div class="cz-settings-group">
            <div class="cz-settings-row">
              <div>
                <div class="cz-settings-label">Engine Configurations & Defaults</div>
                <div class="cz-settings-desc">Fine-tune encoding parameters across images, documents, video, and audio</div>
              </div>
              <button
                type="button"
                class="cz-btn cz-btn-secondary cz-btn-sm cz-btn-pill"
                onclick={() => {
                  const def = defaultSettings();
                  saveChanges({ engines: def.engines });
                  toast("Reset engine configurations to device defaults", "success");
                }}
              >
                Reset to Defaults
              </button>
            </div>

            <!-- Image Settings -->
            <div class="cz-settings-row">
              <div>
                <div class="cz-settings-label">Default Image Format</div>
                <div class="cz-settings-desc">Primary compression format for photos and graphics</div>
              </div>
              <select
                class="cz-select-pill"
                value={settings.engines.images.format}
                onchange={(e) => saveChanges({ engines: { ...settings.engines, images: { ...settings.engines.images, format: (e.target as HTMLSelectElement).value as any } } })}
              >
                <option value="image/webp">WebP (Modern & Compact)</option>
                <option value="image/jpeg">JPEG (Universal Compatibility)</option>
                <option value="image/png">PNG (Lossless & Alpha)</option>
                <option value="image/avif">AVIF (Ultra High Compression)</option>
              </select>
            </div>

            <div class="cz-settings-row">
              <div>
                <div class="cz-settings-label">Image SSIM Quality Floor ({settings.engines.images.quality}%)</div>
                <div class="cz-settings-desc">Visual quality threshold protected by SSIM Quality Guard</div>
              </div>
              <div style="display: flex; align-items: center; gap: 0.75rem;">
                <input
                  type="range"
                  min="30"
                  max="100"
                  value={settings.engines.images.quality}
                  oninput={(e) => saveChanges({ engines: { ...settings.engines, images: { ...settings.engines.images, quality: parseInt((e.target as HTMLInputElement).value, 10) } } })}
                />
                <span class="cz-tier-tag">{settings.engines.images.quality}%</span>
              </div>
            </div>

            <!-- PDF Settings -->
            <div class="cz-settings-row">
              <div>
                <div class="cz-settings-label">Default PDF Compression Level</div>
                <div class="cz-settings-desc">Balances vector fidelity against downsampled raster size</div>
              </div>
              <div class="cz-segmented-track">
                <button
                  type="button"
                  class="cz-segmented-item {settings.engines.pdf.level === 'low' ? 'is-active' : ''}"
                  onclick={() => saveChanges({ engines: { ...settings.engines, pdf: { ...settings.engines.pdf, level: 'low' } } })}
                >
                  Low
                </button>
                <button
                  type="button"
                  class="cz-segmented-item {settings.engines.pdf.level === 'recommended' ? 'is-active' : ''}"
                  onclick={() => saveChanges({ engines: { ...settings.engines, pdf: { ...settings.engines.pdf, level: 'recommended' } } })}
                >
                  Recommended ⭐
                </button>
                <button
                  type="button"
                  class="cz-segmented-item {settings.engines.pdf.level === 'extreme' ? 'is-active' : ''}"
                  onclick={() => saveChanges({ engines: { ...settings.engines, pdf: { ...settings.engines.pdf, level: 'extreme' } } })}
                >
                  Extreme
                </button>
              </div>
            </div>

            <!-- Video Settings -->
            <div class="cz-settings-row">
              <div>
                <div class="cz-settings-label">Video Encoder Preset</div>
                <div class="cz-settings-desc">FFmpeg WebAssembly encoding speed and CPU load</div>
              </div>
              <div class="cz-segmented-track">
                <button
                  type="button"
                  class="cz-segmented-item {settings.engines.video.preset === 'ultrafast' ? 'is-active' : ''}"
                  onclick={() => saveChanges({ engines: { ...settings.engines, video: { ...settings.engines.video, preset: 'ultrafast' } } })}
                >
                  Ultrafast
                </button>
                <button
                  type="button"
                  class="cz-segmented-item {settings.engines.video.preset === 'fast' ? 'is-active' : ''}"
                  onclick={() => saveChanges({ engines: { ...settings.engines, video: { ...settings.engines.video, preset: 'fast' } } })}
                >
                  Fast (Default)
                </button>
                <button
                  type="button"
                  class="cz-segmented-item {settings.engines.video.preset === 'medium' ? 'is-active' : ''}"
                  onclick={() => saveChanges({ engines: { ...settings.engines, video: { ...settings.engines.video, preset: 'medium' } } })}
                >
                  Medium
                </button>
              </div>
            </div>

            <!-- Audio Settings -->
            <div class="cz-settings-row">
              <div>
                <div class="cz-settings-label">Audio Bitrate Preset</div>
                <div class="cz-settings-desc">Target audio bitrate for MP3, AAC, and Opus</div>
              </div>
              <div class="cz-segmented-track">
                <button
                  type="button"
                  class="cz-segmented-item {settings.engines.audio.bitrate === 96 ? 'is-active' : ''}"
                  onclick={() => saveChanges({ engines: { ...settings.engines, audio: { ...settings.engines.audio, bitrate: 96 } } })}
                >
                  96k
                </button>
                <button
                  type="button"
                  class="cz-segmented-item {settings.engines.audio.bitrate === 128 ? 'is-active' : ''}"
                  onclick={() => saveChanges({ engines: { ...settings.engines, audio: { ...settings.engines.audio, bitrate: 128 } } })}
                >
                  128k
                </button>
                <button
                  type="button"
                  class="cz-segmented-item {settings.engines.audio.bitrate === 192 ? 'is-active' : ''}"
                  onclick={() => saveChanges({ engines: { ...settings.engines, audio: { ...settings.engines.audio, bitrate: 192 } } })}
                >
                  192k ⭐
                </button>
                <button
                  type="button"
                  class="cz-segmented-item {settings.engines.audio.bitrate === 320 ? 'is-active' : ''}"
                  onclick={() => saveChanges({ engines: { ...settings.engines, audio: { ...settings.engines.audio, bitrate: 320 } } })}
                >
                  320k
                </button>
              </div>
            </div>
          </div>

        {:else if activeSection === "privacy"}
          <div class="cz-settings-group">
            <div class="cz-settings-row">
              <div>
                <div class="cz-settings-label">Zero Server Uploads</div>
                <div class="cz-settings-desc">All processing in browser memory · Stored in this browser</div>
              </div>
              <span class="cz-status-pill is-done">Guaranteed</span>
            </div>
            <div class="cz-settings-row">
              <div>
                <div class="cz-settings-label">LocalStorage Key</div>
                <div class="cz-settings-desc">cz-settings-v2</div>
              </div>
              <span class="cz-tier-tag">Client Only</span>
            </div>
          </div>

        {:else if activeSection === "diagnostics"}
          <div class="cz-settings-group">
            <div class="cz-settings-row">
              <div>
                <div class="cz-settings-label">This Device & Capabilities</div>
                <div class="cz-settings-desc">Hardware, memory, and engine diagnostics</div>
              </div>
            </div>
            <div class="cz-settings-row device-info-row">
              <div>
                <div class="cz-settings-label">Image path</div>
                <div class="cz-settings-desc">OffscreenCanvas & WebGL2 pipeline</div>
              </div>
              <span class="cz-tier-tag device-info-val">{imagePathLabel}</span>
            </div>
            <div class="cz-settings-row device-info-row">
              <div>
                <div class="cz-settings-label">Batch concurrency</div>
                <div class="cz-settings-desc">Parallel worker execution</div>
              </div>
              <span class="cz-tier-tag device-info-val">{resolvedConcurrency(settings)} files at once</span>
            </div>
            <div class="cz-settings-row device-info-row">
              <div>
                <div class="cz-settings-label">Video path</div>
                <div class="cz-settings-desc">WebCodecs hardware acceleration</div>
              </div>
              <span class="cz-tier-tag device-info-val">WebCodecs + Mediabunny (FFmpeg fallback)</span>
            </div>
            <div class="cz-settings-row device-info-row">
              <div>
                <div class="cz-settings-label">Image quality guard</div>
                <div class="cz-settings-desc">SSIM quality protection</div>
              </div>
              <span class="cz-tier-tag device-info-val">Active (never silently rescales)</span>
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
    z-index: 999;
  }
  .cz-settings-dialog {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 90vw;
    max-width: 740px;
    max-height: 85vh;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r-xl);
    z-index: 1000;
    display: flex;
    flex-direction: column;
    box-shadow: var(--shadow-xl);
    overflow: hidden;
  }
  .cz-dialog-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem 1.4rem;
    border-bottom: 1px solid var(--border);
    background: var(--surface2);
  }
  .cz-dialog-title {
    font-family: var(--display);
    font-size: 1.15rem;
    font-weight: 700;
    color: var(--text);
  }
  .cz-dialog-sub {
    font-size: 0.76rem;
    color: var(--text-3);
  }
  .cz-dialog-close {
    border: none;
    background: transparent;
    color: var(--text-3);
    cursor: pointer;
    font-size: 1rem;
    padding: 0.35rem;
    border-radius: 9999px;
  }
  .cz-dialog-close:hover {
    color: var(--text);
    background: var(--bg2);
  }
  .cz-settings-body {
    display: flex;
    flex: 1;
    min-height: 380px;
    max-height: 70vh;
    overflow: hidden;
  }
  .cz-settings-nav {
    width: 170px;
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    padding: 0.6rem 0.5rem;
    gap: 0.2rem;
    background: var(--surface2);
    overflow-y: auto;
    flex-shrink: 0;
  }
  .cz-settings-nav-btn {
    text-align: left;
    padding: 0.45rem 0.75rem;
    border-radius: var(--r-sm);
    border: none;
    background: transparent;
    color: var(--text-2);
    font-size: 0.82rem;
    font-weight: 500;
    cursor: pointer;
    transition: background var(--t), color var(--t);
  }
  .cz-settings-nav-btn:hover {
    background: var(--bg2);
    color: var(--text);
  }
  .cz-settings-nav-btn.is-active {
    background: var(--surface);
    color: var(--accent);
    font-weight: 600;
    box-shadow: var(--shadow-xs);
  }
  .cz-settings-content {
    flex: 1;
    padding: 1.25rem;
    overflow-y: auto;
    background: var(--bg);
  }
  .cz-settings-group {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r);
    padding: 1rem 1.15rem;
    margin-bottom: 1rem;
  }
  .cz-settings-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
    min-width: 0;
  }
  .cz-settings-row > div:first-child {
    flex: 1 1 200px;
    min-width: 0;
  }
  .cz-settings-label {
    font-size: 0.92rem;
    font-weight: 600;
    color: var(--text);
    line-height: 1.3;
    overflow-wrap: break-word;
  }
  .cz-settings-desc {
    font-size: 0.8rem;
    color: var(--text-3);
    margin-top: 0.2rem;
    line-height: 1.4;
    overflow-wrap: break-word;
  }
  .cz-segmented-track {
    display: inline-flex;
    align-items: center;
    background: var(--bg2);
    padding: 3px;
    border-radius: var(--r-sm);
    border: 1px solid var(--border);
    gap: 2px;
    flex-shrink: 0;
  }
  .cz-segmented-item {
    padding: 0.35rem 0.75rem;
    font-size: 0.8rem;
    font-weight: 500;
    color: var(--text-3);
    border-radius: calc(var(--r-sm) - 2px);
    background: transparent;
    border: none;
    cursor: pointer;
    transition: background var(--t), color var(--t);
    white-space: nowrap;
  }
  .cz-segmented-item:hover {
    color: var(--text);
  }
  .cz-segmented-item.is-active {
    background: var(--surface);
    color: var(--accent);
    font-weight: 600;
    box-shadow: var(--shadow-xs);
  }
  .cz-tier-tag {
    display: inline-flex;
    align-items: center;
    padding: 0.25rem 0.65rem;
    border-radius: 100px;
    font-size: 0.75rem;
    font-family: var(--mono);
    font-weight: 600;
    background: var(--surface2);
    color: var(--text-2);
    border: 1px solid var(--border);
    flex-shrink: 0;
  }
  .cz-status-pill {
    display: inline-flex;
    align-items: center;
    padding: 0.25rem 0.65rem;
    border-radius: 100px;
    font-size: 0.75rem;
    font-weight: 600;
    flex-shrink: 0;
  }
  .cz-status-pill.is-done {
    background: var(--green-soft);
    color: var(--green);
    border: 1px solid var(--green-border);
  }
  .cz-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 0.82rem;
    font-weight: 600;
    padding: 0.4rem 0.85rem;
    border-radius: var(--r-sm);
    cursor: pointer;
    transition: background var(--t), color var(--t), border-color var(--t);
    flex-shrink: 0;
  }
  .cz-btn-secondary {
    background: var(--surface2);
    color: var(--text);
    border: 1px solid var(--border);
  }
  .cz-btn-secondary:hover {
    background: var(--bg2);
    border-color: var(--border-mid);
  }
  .cz-btn-danger {
    background: rgba(244, 63, 94, 0.12);
    color: var(--rose);
    border: 1px solid rgba(244, 63, 94, 0.25);
  }
  .cz-btn-danger:hover {
    background: rgba(244, 63, 94, 0.2);
  }
  .cz-btn-ghost {
    background: transparent;
    color: var(--text-3);
    border: 1px solid var(--border);
  }
  .cz-btn-ghost:hover {
    color: var(--text);
    background: var(--surface2);
  }
  .cz-btn-pill {
    border-radius: 9999px;
  }

  @media (max-width: 680px) {
    .cz-settings-dialog {
      width: 95vw;
      max-height: 90vh;
    }
    .cz-settings-body {
      flex-direction: column;
      min-height: auto;
    }
    .cz-settings-nav {
      width: 100%;
      flex-direction: row;
      overflow-x: auto;
      border-right: none;
      border-bottom: 1px solid var(--border);
      padding: 0.5rem;
      gap: 0.35rem;
      scrollbar-width: none;
    }
    .cz-settings-nav::-webkit-scrollbar {
      display: none;
    }
    .cz-settings-nav-btn {
      white-space: nowrap;
      padding: 0.35rem 0.75rem;
      border-radius: 100px;
    }
    .cz-settings-content {
      padding: 1rem;
    }
    .cz-settings-row {
      flex-direction: column;
      align-items: flex-start;
      gap: 0.6rem;
    }
    .cz-settings-row > div:first-child {
      width: 100%;
    }
    .cz-segmented-track {
      width: 100%;
      justify-content: stretch;
    }
    .cz-segmented-item {
      flex: 1;
      text-align: center;
    }
  }
</style>
