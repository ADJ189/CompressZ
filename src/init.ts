/**
 * init.ts — Early startup initialization.
 * Runs before the main application bundle to prevent dark-mode flash
 * and sets up a fallback watchdog timer for the splash screen.
 */
import { applyThemePreference, getThemePreference } from "./lib/theme";

try {
  const pref = getThemePreference();
  const resolved = applyThemePreference(pref);
  const themeColorMeta = document.querySelector('meta[name="theme-color"]');
  if (themeColorMeta) {
    themeColorMeta.setAttribute("content", resolved === "dark" ? "#0c0c0f" : "#3b5bdb");
  }
} catch {
  /* headless or disabled storage */
}

if (typeof document !== "undefined") {
  const fontUrl =
    "https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Plus+Jakarta+Sans:wght@500;600;700;800&family=DM+Mono:wght@400;500&display=swap";
  if (!document.querySelector(`link[href="${fontUrl}"]`)) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = fontUrl;
    document.head.appendChild(link);
  }
}

// Splash screen failure fallback (10s timer)
if (typeof window !== "undefined") {
  setTimeout(() => {
    const splash = document.getElementById("splash");
    if (splash && !splash.classList.contains("done")) {
      const inner = splash.querySelector(".sp-inner");
      if (inner) {
        inner.innerHTML = `
          <div class="sp-fail" style="text-align: center; color: var(--text, #fff); font-family: system-ui, sans-serif;">
            <p style="margin-bottom: 12px; font-weight: 500;">CompressZ failed to start.</p>
            <button type="button" class="sp-reload-btn" style="padding: 8px 18px; border-radius: 99px; background: #3b5bdb; color: #fff; border: none; cursor: pointer; font-weight: 600;">Reload Application</button>
          </div>
        `;
        const btn = inner.querySelector<HTMLButtonElement>(".sp-reload-btn");
        btn?.addEventListener("click", () => {
          window.location.reload();
        });
      }
    }
  }, 10_000);
}
