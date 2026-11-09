import "./style.css";
import "./styles/workbench.css";
import { mount } from "svelte";
import App from "./App.svelte";
import { init as initRouter, navigate } from "./router";
import { initTheme } from "./lib/theme";

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
