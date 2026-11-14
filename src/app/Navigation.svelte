<script lang="ts">
  import { currentRoute } from "../store";
  import { navigate } from "../router";
  import { onMount, tick } from "svelte";
  import MacIcon from "../components/MacIcon.svelte";
  import ToolsMegaMenu from "../components/ToolsMegaMenu.svelte";

  let activeRoute = $state("");
  let scrollContainer: HTMLElement;
  let thumbEl: HTMLElement;
  let megaMenuOpen = $state(false);

  $effect(() => {
    const unsub = currentRoute.subscribe((r) => {
      activeRoute = r;
      megaMenuOpen = false;
      tick().then(updateThumb);
    });
    return unsub;
  });

  interface TabItem {
    route: string;
    label: string;
    icon: string;
    badge?: string;
    isDropdown?: boolean;
    isNew?: boolean;
  }

  const TABS: TabItem[] = [
    { route: "", label: "Home", icon: "home" },
    { route: "tools", label: "Tools", icon: "tools", isDropdown: true },
    { route: "pdf", label: "PDF Suite", icon: "pdf", badge: "Studio" },
    { route: "convert", label: "Convert", icon: "convert" },
    { route: "compress/images", label: "Compress", icon: "compress" },
    { route: "compress/ocr", label: "AI & OCR", icon: "ocr" },
    { route: "docs", label: "Docs", icon: "docs" },
  ];

  function isRouteActive(tabRoute: string, current: string): boolean {
    if (tabRoute === "tools") return megaMenuOpen;
    const norm = (current === "" || current === "home") ? "" : current;
    if (tabRoute === "") return norm === "";
    if (norm === tabRoute) return true;

    // PDF Suite Hub matching
    if (tabRoute === "pdf") {
      if (
        norm === "pdf" ||
        norm.startsWith("pdf/") ||
        norm.startsWith("pdf-suite") ||
        norm === "compress/pdf"
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

  function handleTabClick(tab: TabItem, e: MouseEvent) {
    if (tab.isDropdown) {
      e.preventDefault();
      megaMenuOpen = !megaMenuOpen;
      tick().then(updateThumb);
      return;
    }

    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    megaMenuOpen = false;
    navigate(tab.route);
  }

  onMount(() => {
    updateThumb();
    window.addEventListener("resize", updateThumb);
    return () => window.removeEventListener("resize", updateThumb);
  });
</script>

<nav id="tabbar" class="cz-tabbar" aria-label="Tool navigation">
  <div class="cz-tabbar-center">
    <div class="cz-tabbar-scroll" bind:this={scrollContainer}>
      <span class="cz-tabbar-thumb" bind:this={thumbEl} aria-hidden="true"></span>

      {#each TABS as tab}
        {@const active = isRouteActive(tab.route, activeRoute)}
        {#if tab.isDropdown}
          <button
            type="button"
            class="cz-tab cz-tab-dropdown {active ? 'is-active active' : ''}"
            aria-label="All features & tools"
            aria-expanded={megaMenuOpen}
            aria-haspopup="dialog"
            onclick={(e) => handleTabClick(tab, e)}
          >
            <span class="cz-tab-icon"><MacIcon name={tab.icon} size={15} /></span>
            <span class="cz-tab-label">{tab.label}</span>
            <span class="cz-tab-chevron" class:is-open={megaMenuOpen}>
              <MacIcon name="chevron-down" size={11} />
            </span>
          </button>
        {:else}
          <a
            href="/{tab.route}"
            class="cz-tab {active ? 'is-active active' : ''}"
            data-tab
            data-nav={tab.route}
            aria-label={tab.label}
            onclick={(e) => handleTabClick(tab, e)}
          >
            <span class="cz-tab-icon"><MacIcon name={tab.icon} size={15} /></span>
            <span class="cz-tab-label">{tab.label}</span>
            {#if tab.badge}
              <span class="cz-tab-badge">{tab.badge}</span>
            {/if}
          </a>
        {/if}
      {/each}
    </div>
  </div>
</nav>

<ToolsMegaMenu open={megaMenuOpen} onClose={() => { megaMenuOpen = false; tick().then(updateThumb); }} />

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
    justify-content: center;
    width: 100%;
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
  }
  .cz-tabbar-center {
    width: 100%;
    max-width: 1040px;
    display: flex;
    justify-content: center;
    padding: 0 0.75rem;
  }
  .cz-tabbar-scroll {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
    -ms-overflow-style: none;
    height: 100%;
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
    padding: 0.35rem 0.85rem;
    height: 33px;
    font-size: 0.85rem;
    font-weight: 500;
    color: var(--text-2);
    white-space: nowrap;
    border-radius: 100px;
    transition: color var(--t), background var(--t), border-color var(--t), box-shadow var(--t);
    text-decoration: none;
    border: 1px solid transparent;
    cursor: pointer;
    background: transparent;
  }
  .cz-tab:hover {
    color: var(--text);
    background: var(--bg2);
  }
  .cz-tab.cz-tab-dropdown {
    background: var(--surface2, rgba(255, 255, 255, 0.06));
    border: 1px solid var(--brand);
    color: var(--brand);
    font-weight: 600;
    box-shadow: 0 0 8px var(--brand-glow), inset 0 1px 0 rgba(255, 255, 255, 0.15);
  }
  .cz-tab.cz-tab-dropdown:hover {
    background: var(--surface3, rgba(255, 255, 255, 0.12));
    border-color: var(--brand);
    box-shadow: 0 0 14px var(--brand-glow), 0 0 0 1px var(--brand);
    color: var(--brand);
  }
  .cz-tab.cz-tab-dropdown.is-active {
    background: var(--brand-glow);
    border-color: var(--brand);
    box-shadow: 0 0 16px var(--brand-glow), 0 0 0 1px var(--brand);
  }
  .cz-tab.is-active {
    color: var(--accent);
    background: var(--accent-soft);
    border-color: var(--accent-glow);
    font-weight: 600;
    box-shadow: 0 1px 6px var(--accent-glow);
  }
  .cz-tab-icon {
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .cz-tab-chevron {
    display: flex;
    align-items: center;
    transition: transform var(--t);
    opacity: 0.7;
    margin-left: -0.1rem;
  }
  .cz-tab-chevron.is-open {
    transform: rotate(180deg);
    opacity: 1;
  }
  .cz-tab-badge {
    padding: 0.05rem 0.35rem;
    border-radius: 4px;
    font-size: 0.7rem;
    font-weight: 600;
    background: var(--accent);
    color: #ffffff;
  }
  @media (max-width: 768px) {
    .cz-tabbar-scroll {
      justify-content: flex-start;
      width: 100%;
    }
  }
</style>
