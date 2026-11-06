<script lang="ts">
  import { toggleTheme, resolveThemePreference, getThemePreference, THEME_EVENT } from "../lib/theme";
  import { onMount } from "svelte";

  interface Props {
    onOpenTools: () => void;
    onOpenSettings: () => void;
  }

  let { onOpenTools, onOpenSettings }: Props = $props();

  let resolvedTheme = $state<"light" | "dark">("light");
  let prefTheme = $state<"light" | "dark" | "system">("system");

  function syncTheme() {
    resolvedTheme = resolveThemePreference();
    prefTheme = getThemePreference();
  }

  onMount(() => {
    syncTheme();
    document.addEventListener(THEME_EVENT, syncTheme);
    return () => {
      document.removeEventListener(THEME_EVENT, syncTheme);
    };
  });

  function handleThemeToggle() {
    toggleTheme();
    syncTheme();
  }
</script>

<header class="cz-header">
  <a class="cz-logo" href="/" data-nav="" aria-label="CompressZ — home">
    <div class="cz-logo-icon">
      <svg width="24" height="24" viewBox="0 0 32 32">
        <rect width="32" height="32" rx="8" fill="#3b5bdb"/>
        <path d="M8 13.5L12.5 9L17 13.5L21.5 9" stroke="white" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
        <path d="M8 18.5L12.5 14L17 18.5L21.5 14" stroke="white" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" opacity="0.55" fill="none"/>
        <path d="M8 23L12.5 18.5L17 23L21.5 18.5" stroke="white" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" opacity="0.22" fill="none"/>
      </svg>
    </div>
    <span class="cz-logo-text">CompressZ</span>
  </a>

  <div class="cz-header-actions">
    <button
      id="tools-btn"
      class="cz-hdr-btn"
      type="button"
      aria-label="Browse all tools"
      title="All tools"
      onclick={onOpenTools}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1.5"/>
        <rect x="14" y="3" width="7" height="7" rx="1.5"/>
        <rect x="3" y="14" width="7" height="7" rx="1.5"/>
        <rect x="14" y="14" width="7" height="7" rx="1.5"/>
      </svg>
    </button>

    <button
      id="theme-btn"
      class="cz-hdr-btn"
      type="button"
      aria-label={resolvedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      title="Toggle color theme"
      onclick={handleThemeToggle}
    >
      {#if resolvedTheme === "dark"}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="5"/>
          <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
          <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
        </svg>
      {:else}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
        </svg>
      {/if}
    </button>

    <button
      id="settings-btn"
      class="cz-hdr-btn"
      type="button"
      aria-label="Open settings"
      title="Settings"
      onclick={onOpenSettings}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
      </svg>
    </button>

    <a
      class="cz-hdr-btn"
      href="https://github.com/ADJ189/compressz"
      target="_blank"
      rel="noopener"
      aria-label="GitHub repository"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 21.795 24 17.295 24 12c0-6.63-5.37-12-12-12"/>
      </svg>
    </a>
  </div>
</header>

<style>
  .cz-header {
    height: var(--header-h);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 1.25rem;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    position: sticky;
    top: 0;
    z-index: 100;
  }
  .cz-logo {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    color: var(--text);
  }
  .cz-logo-text {
    font-family: var(--display);
    font-size: 1.15rem;
    font-weight: 800;
    letter-spacing: -0.02em;
  }
  .cz-header-actions {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }
  .cz-hdr-btn {
    width: 34px;
    height: 34px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--r-sm);
    color: var(--text-2);
    transition: background var(--t), color var(--t);
  }
  .cz-hdr-btn:hover {
    background: var(--bg2);
    color: var(--text);
  }
</style>
