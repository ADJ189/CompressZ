<script lang="ts">
  import Header from "./Header.svelte";
  import Navigation from "./Navigation.svelte";
  import ToolsDialog from "./ToolsDialog.svelte";
  import SettingsDialog from "./SettingsDialog.svelte";
  import { currentRoute } from "../store";
  import { navigate } from "../router";

  // Route components
  import Home from "../routes/Home.svelte";
  import Images from "../routes/Images.svelte";
  import Pdf from "../routes/Pdf.svelte";
  import Video from "../routes/Video.svelte";
  import Audio from "../routes/Audio.svelte";
  import Gif from "../routes/Gif.svelte";
  import Ocr from "../routes/Ocr.svelte";
  import MergePdf from "../routes/MergePdf.svelte";
  import ImagesToPdf from "../routes/ImagesToPdf.svelte";
  import Convert from "../routes/Convert.svelte";
  import PdfMarkdown from "../routes/PdfMarkdown.svelte";
  import About from "../routes/About.svelte";
  import Docs from "../routes/Docs.svelte";
  import Privacy from "../routes/Privacy.svelte";
  import Settings from "../routes/Settings.svelte";
  import PdfSuite from "../routes/PdfSuite.svelte";

  let activeRoute = $state("");
  let toolsOpen = $state(false);
  let settingsOpen = $state(false);

  $effect(() => {
    const unsub = currentRoute.subscribe((r) => {
      if (r === "settings") {
        settingsOpen = true;
        history.replaceState({}, "", "/");
        activeRoute = "";
        return;
      }
      activeRoute = r;
      window.scrollTo(0, 0);
    });
    return unsub;
  });
</script>

<div class="cz-shell">
  <Header
    onOpenTools={() => (toolsOpen = true)}
    onOpenSettings={() => (settingsOpen = true)}
  />

  <Navigation />

  <main id="page-view" class="cz-main-outlet">
    {#if activeRoute === "" || activeRoute === "home"}
      <Home />
    {:else if activeRoute === "compress/images"}
      <Images />
    {:else if activeRoute === "compress/pdf"}
      <Pdf />
    {:else if activeRoute === "compress/video"}
      <Video />
    {:else if activeRoute === "compress/audio"}
      <Audio />
    {:else if activeRoute === "compress/gif"}
      <Gif />
    {:else if activeRoute === "compress/ocr"}
      <Ocr />
    {:else if activeRoute === "compress/merge-pdf"}
      <MergePdf />
    {:else if activeRoute === "compress/images-to-pdf"}
      <ImagesToPdf />
    {:else if activeRoute === "convert"}
      <Convert />
    {:else if activeRoute === "convert/pdf-markdown"}
      <PdfMarkdown />
    {:else if activeRoute === "about"}
      <About />
    {:else if activeRoute === "docs"}
      <Docs />
    {:else if activeRoute === "privacy"}
      <Privacy />
    {:else if activeRoute === "settings"}
      <Settings />
    {:else if activeRoute === "pdf" || activeRoute.startsWith("pdf/") || activeRoute.startsWith("pdf-suite/") || activeRoute === "pdf-suite"}
      <PdfSuite />
    {:else}
      <Home />
    {/if}
  </main>

  <footer class="cz-footer">
    <div class="cz-footer-inner">
      <div class="cz-footer-left">
        <span class="cz-footer-brand">CompressZ</span>
        <span class="cz-footer-copy">All file processing remains local to your browser.</span>
      </div>
      <div class="cz-footer-links">
        <a href="/about" data-nav="about" onclick={(e) => { e.preventDefault(); navigate("about"); }}>About</a>
        <a href="/docs" data-nav="docs" onclick={(e) => { e.preventDefault(); navigate("docs"); }}>Docs</a>
        <a href="/privacy" data-nav="privacy" onclick={(e) => { e.preventDefault(); navigate("privacy"); }}>Privacy</a>
        <a href="https://github.com/ADJ189/compressz" target="_blank" rel="noopener">GitHub</a>
      </div>
    </div>
  </footer>

  <ToolsDialog open={toolsOpen} onClose={() => (toolsOpen = false)} />
  <SettingsDialog open={settingsOpen} onClose={() => (settingsOpen = false)} />

  <!-- Global toast notifications host -->
  <div id="toast" class="cz-toast-container" aria-live="polite"></div>
</div>

<style>
  .cz-shell {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    color: var(--text);
  }
  .cz-main-outlet {
    flex: 1;
    min-height: 0;
  }
  .cz-footer {
    border-top: 1px solid var(--border);
    background: var(--surface);
    padding: 1.5rem;
    margin-top: auto;
  }
  .cz-footer-inner {
    max-width: 1060px;
    margin: 0 auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 1rem;
    font-size: 0.84rem;
  }
  .cz-footer-left {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .cz-footer-brand {
    font-family: var(--display);
    font-weight: 700;
    color: var(--text);
  }
  .cz-footer-copy {
    color: var(--text-3);
  }
  .cz-footer-links {
    display: flex;
    align-items: center;
    gap: 1.25rem;
  }
  .cz-footer-links a {
    color: var(--text-2);
    transition: color var(--t);
  }
  .cz-footer-links a:hover {
    color: var(--accent);
  }
  .cz-toast-container {
    position: fixed;
    bottom: 1.5rem;
    right: 1.5rem;
    z-index: 2000;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    pointer-events: none;
  }
  :global(.cz-toast-container > *) {
    pointer-events: auto;
  }
</style>
