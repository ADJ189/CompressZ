import * as Sentry from "@sentry/svelte";
import "./style.css";
import "./styles/workbench.css";
import { mount } from "svelte";
import App from "./App.svelte";
import { init as initRouter, navigate } from "./router";
import { initTheme } from "./lib/theme";

// Anonymous error reporting is enabled by default to detect software crashes and issues,
// with an explicit opt-out mechanism available in Settings.
const sentryDsn =
  import.meta.env.VITE_SENTRY_DSN ||
  "https://8acc8037c5074ed5bfcc11793aff8c8e@o4512456407515136.ingest.us.sentry.io/4512456419770368";
const isOptedOut =
  typeof window !== "undefined" &&
  window.localStorage?.getItem("cz-telemetry-opt-out") === "true";

if (sentryDsn && !isOptedOut) {
  Sentry.init({
    dsn: sentryDsn,
    sendDefaultPii: false,
    release: `compressz@${typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "1.15.0"}`,
    environment: import.meta.env.MODE || (import.meta.env.DEV ? "development" : "production"),
    // Drop session tracking, breadcrumb scraping, and console interceptors so zero telemetry is sent during normal usage
    integrations: (defaultIntegrations: any[]) =>
      defaultIntegrations.filter(
        (i) => i.name !== "BrowserSession" && i.name !== "Breadcrumbs" && i.name !== "Console"
      ),
    beforeBreadcrumb: () => null,
    beforeSend(event: Sentry.Event) {
      // Strip request URLs to root origin only
      if (event.request?.url) {
        try {
          const parsed = new URL(event.request.url);
          event.request.url = `${parsed.origin}/`;
        } catch {
          event.request.url = "[redacted]";
        }
      }
      // Ensure no IP or user identifiers are sent
      delete event.user;
      if (event.request?.headers) {
        delete event.request.headers;
      }

      // Regex to scrub filenames, paths, and extensions from error values
      const scrubText = (str: string): string =>
        str
          .replace(/[a-zA-Z]:\\[^"'\n\r\t]+/g, "[path]")
          .replace(/\/(?:[a-zA-Z0-9_.-]+\/)+[a-zA-Z0-9_.-]+/g, "[path]")
          .replace(/\b[\w-]+\.(?:pdf|docx|xlsx|pptx|png|jpe?g|webp|gif|mp4|webm|mp3|wav|ogg|svg|zip|tar)\b/gi, "[filename]");

      if (event.message) {
        event.message = scrubText(event.message);
      }
      if (event.exception?.values) {
        for (const val of event.exception.values) {
          if (val.value) {
            val.value = scrubText(val.value);
          }
        }
      }
      return event;
    },
  } as any);
}

// Initialize theme preference from localStorage/system
initTheme();

// Initialize History API router
initRouter();

// Export navigate for any global callers or inline references
(window as any).navigate = navigate;

// Mount Svelte 5 application shell
const appTarget = document.getElementById("app");
if (appTarget) {
  mount(App, { target: appTarget });
}

// Fade out and remove initial splash screen if present
const splash = document.getElementById("splash");
if (splash) {
  setTimeout(() => splash.classList.add("done"), 600);
}
