import * as Sentry from "@sentry/svelte";
import "./style.css";
import "./styles/workbench.css";
import { mount } from "svelte";
import App from "./App.svelte";
import { init as initRouter, navigate } from "./router";
import { initTheme } from "./lib/theme";

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN || "https://8acc8037c5074ed5bfcc11793aff8c8e@o4512456407515136.ingest.us.sentry.io/4512456419770368",
  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration(),
  ],
  release: `compressz@${typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "1.15.0"}`,
  environment: import.meta.env.MODE || (import.meta.env.DEV ? "development" : "production"),
  tracesSampleRate: import.meta.env.DEV ? 1.0 : 0.1,
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
});

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
