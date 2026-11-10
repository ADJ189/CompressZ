<script lang="ts">
  import { currentRoute } from "../store";
  import { navigate } from "../router";
  import { onMount, tick } from "svelte";

  let activeRoute = $state("");
  let scrollContainer: HTMLElement;
  let thumbEl: HTMLElement;

  $effect(() => {
    const unsub = currentRoute.subscribe((r) => {
      activeRoute = r;
      tick().then(updateThumb);
    });
    return unsub;
  });

  const TABS = [
    { route: "", label: "Home", icon: "🏠" },
    { route: "compress/pdf", label: "PDF Suite", icon: "📄", badge: "Studio" },
    { route: "convert", label: "Convert", icon: "🔁" },
    { route: "compress/images", label: "Compress", icon: "🗜️" },
    { route: "compress/ocr", label: "AI & OCR", icon: "🔍" },
    { route: "docs", label: "Docs", icon: "📖" },
  ];

  function isRouteActive(tabRoute: string, current: string): boolean {
    const norm = (current === "" || current === "home") ? "" : current;
    if (tabRoute === "") return norm === "";
    if (norm === tabRoute) return true;

    // PDF Suite Hub matching
    if (tabRoute === "compress/pdf") {
      if (
        norm === "compress/pdf" ||
        norm === "compress/merge-pdf" ||
        norm === "compress/images-to-pdf" ||
        norm.startsWith("pdf")
      ) {
        return true;
      }
    }

    // Convert Hub matching
    if (tabRoute === "convert") {
      if (norm === "convert" || norm.startsWith("convert/")) {
        return true;
      }
    }

    // Compress Hub matching
    if (tabRoute === "compress/images") {
      if (
        norm === "compress/images" ||
        norm === "compress/video" ||
        norm === "compress/audio" ||
        norm === "compress/gif" ||
        norm === "compress"
      ) {
        return true;
      }
    }

    // AI & OCR Hub matching
    if (tabRoute === "compress/ocr") {
      if (norm === "compress/ocr") {
        return true;
      }
    }

    // Docs & Privacy Hub matching
    if (tabRoute === "docs") {
      if (norm === "docs" || norm === "about" || norm === "privacy") {
        return true;
      }
    }

    if (norm.startsWith(tabRoute + "/")) {
      return true;
    }
    return false;
  }

  async function updateThumb() {
    await tick();
    if (!scrollContainer || !thumbEl) return;
    const activeLink = scrollContainer.querySelector<HTMLElement>(".cz-tab.is-active");
    if (!activeLink) {
      thumbEl.style.width = "0px";
      thumbEl.style.opacity = "0";
      return;
    }
    const scrollRect = scrollContainer.getBoundingClientRect();
    const linkRect = activeLink.getBoundingClientRect();
    const left = linkRect.left - scrollRect.left + scrollContainer.scrollLeft;
    thumbEl.style.transform = `translateX(${left}px)`;
    thumbEl.style.width = `${linkRect.width}px`;
    thumbEl.style.opacity = "1";

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
      {@const active = isRouteActive(tab.route, activeRoute)}
      <a
        href="/{tab.route}"
        class="cz-tab {active ? 'is-active active' : ''}"
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
    gap: 0.35rem;
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
    height: 3px;
    background: linear-gradient(90deg, var(--accent), var(--accent-2));
    border-radius: 3px 3px 0 0;
    box-shadow: 0 0 10px var(--accent-glow);
    transition: transform var(--t2), width var(--t2), opacity var(--t);
    pointer-events: none;
    z-index: 2;
  }
  .cz-tab {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.35rem 0.8rem;
    height: 33px;
    font-size: 0.85rem;
    font-weight: 500;
    color: var(--text-2);
    white-space: nowrap;
    border-radius: 100px;
    transition: color var(--t), background var(--t), border-color var(--t), box-shadow var(--t);
    text-decoration: none;
    border: 1px solid transparent;
  }
  .cz-tab:hover {
    color: var(--text);
    background: var(--bg2);
  }
  .cz-tab.is-active {
    color: var(--accent);
    background: var(--accent-soft);
    border-color: var(--accent-glow);
    font-weight: 600;
    box-shadow: 0 1px 6px var(--accent-glow);
  }
  .cz-tab-icon {
    font-size: 0.95rem;
  }
  .cz-tab-badge {
    padding: 0.05rem 0.35rem;
    border-radius: 4px;
    font-size: 0.7rem;
    font-weight: 600;
    background: var(--accent);
    color: #ffffff;
  }
</style>
