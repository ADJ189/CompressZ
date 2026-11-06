<script lang="ts">
  import { currentRoute } from "../store";
  import { navigate } from "../router";
  import { onMount } from "svelte";

  let activeRoute = $state("");
  let scrollContainer: HTMLElement;
  let thumbEl: HTMLElement;

  $effect(() => {
    const unsub = currentRoute.subscribe((r) => {
      activeRoute = r;
      updateThumb();
    });
    return unsub;
  });

  const TABS = [
    { route: "", label: "Home", icon: "🏠" },
    { route: "compress/images", label: "Images", icon: "🖼️" },
    { route: "compress/pdf", label: "PDF", icon: "📄" },
    { route: "compress/merge-pdf", label: "Merge PDF", icon: "🧷" },
    { route: "compress/images-to-pdf", label: "Images to PDF", icon: "🧩" },
    { route: "compress/video", label: "Video", icon: "🎬" },
    { route: "compress/audio", label: "Audio", icon: "🎵" },
    { route: "compress/gif", label: "GIF", icon: "🎞️" },
    { route: "compress/ocr", label: "PDF OCR", icon: "🔍" },
    { route: "convert", label: "Convert", icon: "🔁" },
    { route: "convert/pdf-markdown", label: "PDF to Markdown", icon: "📝", isNew: true },
    { route: "about", label: "About", icon: "ℹ️" },
    { route: "docs", label: "Docs", icon: "📖" },
    { route: "privacy", label: "Privacy", icon: "🔒" },
  ];

  function updateThumb() {
    if (!scrollContainer || !thumbEl) return;
    const activeLink = scrollContainer.querySelector<HTMLElement>(".cz-tab.is-active");
    if (!activeLink) {
      thumbEl.style.width = "0px";
      return;
    }
    const scrollRect = scrollContainer.getBoundingClientRect();
    const linkRect = activeLink.getBoundingClientRect();
    const left = linkRect.left - scrollRect.left + scrollContainer.scrollLeft;
    thumbEl.style.transform = `translateX(${left}px)`;
    thumbEl.style.width = `${linkRect.width}px`;

    activeLink.scrollIntoView({
      block: "nearest",
      inline: "center",
      behavior: "smooth",
    });
  }

  function handleTabClick(route: string, e: MouseEvent) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(route);
  }

  onMount(() => {
    updateThumb();
    window.addEventListener("resize", updateThumb);
    return () => window.removeEventListener("resize", updateThumb);
  });
</script>

<nav id="tabbar" class="cz-tabbar" aria-label="Tool navigation">
  <div class="cz-tabbar-scroll" bind:this={scrollContainer}>
    <span class="cz-tabbar-thumb" bind:this={thumbEl} aria-hidden="true"></span>

    {#each TABS as tab}
      {@const isActive = activeRoute === tab.route || (tab.route !== "" && activeRoute.startsWith(tab.route + "/"))}
      <a
        href="/{tab.route}"
        class="cz-tab {isActive ? 'is-active active' : ''}"
        data-tab
        data-nav={tab.route}
        aria-label={tab.label}
        onclick={(e) => handleTabClick(tab.route, e)}
      >
        <span class="cz-tab-icon" aria-hidden="true">{tab.icon}</span>
        <span class="cz-tab-label">{tab.label}</span>
        {#if tab.isNew}
          <span class="cz-tab-badge">New</span>
        {/if}
      </a>
    {/each}
  </div>
</nav>

<style>
  .cz-tabbar {
    position: sticky;
    top: var(--header-h);
    z-index: 90;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    height: var(--tabbar-h);
    display: flex;
    align-items: center;
  }
  .cz-tabbar-scroll {
    position: relative;
    display: flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0 1rem;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
    -ms-overflow-style: none;
    height: 100%;
    width: 100%;
  }
  .cz-tabbar-scroll::-webkit-scrollbar {
    display: none;
  }
  .cz-tabbar-thumb {
    position: absolute;
    bottom: 0;
    left: 0;
    height: 2.5px;
    background: var(--accent);
    border-radius: 2px 2px 0 0;
    transition: transform var(--t2), width var(--t2);
    pointer-events: none;
  }
  .cz-tab {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0 0.75rem;
    height: 100%;
    font-size: 0.86rem;
    font-weight: 500;
    color: var(--text-2);
    white-space: nowrap;
    border-radius: var(--r-xs);
    transition: color var(--t);
    text-decoration: none;
  }
  .cz-tab:hover {
    color: var(--text);
  }
  .cz-tab.is-active {
    color: var(--accent);
    font-weight: 600;
  }
  .cz-tab-icon {
    font-size: 0.95rem;
  }
  .cz-tab-badge {
    padding: 0.05rem 0.35rem;
    border-radius: 4px;
    font-size: 0.7rem;
    font-weight: 600;
    background: var(--accent-soft);
    color: var(--accent);
  }
</style>
