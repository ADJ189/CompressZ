<script lang="ts">
  import { toggleTheme, resolveThemePreference, getThemePreference, THEME_EVENT } from "../lib/theme";
  import UniversalUpload from "../components/UniversalUpload.svelte";
  import MacIcon from "../components/MacIcon.svelte";
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
    <div class="cz-hdr-upload">
      <UniversalUpload compact={true} />
    </div>

    <button
      id="tools-btn"
      class="cz-hdr-btn"
      type="button"
      aria-label="Browse all tools"
      title="All tools"
      onclick={onOpenTools}
    >
      <MacIcon name="tools" size={16} />
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
        <MacIcon name="sun" size={16} />
      {:else}
        <MacIcon name="moon" size={16} />
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
      <MacIcon name="settings" size={16} />
    </button>

    <a
      class="cz-hdr-btn cz-hdr-github"
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
    max-width: 100%;
    box-sizing: border-box;
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
  .cz-hdr-upload {
    display: flex;
    align-items: center;
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
  @media (max-width: 680px) {
    .cz-header {
      padding: 0 0.75rem;
    }
    .cz-hdr-upload {
      display: none;
    }
    .cz-hdr-github {
      display: none;
    }
  }
  @media (max-width: 340px) {
    .cz-header {
      padding: 0 0.5rem;
    }
    .cz-logo-text {
      font-size: 1rem;
    }
  }
</style>
