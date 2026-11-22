/**
 * earlyTheme.js — Synchronous, render-blocking theme bootstrap.
 * Runs in <head> before stylesheets or DOM elements are painted to prevent
 * any flash of light theme when dark mode is preferred or configured.
 * Complies with strict CSP script-src 'self'.
 */
(function () {
  try {
    var p = localStorage.getItem('theme');
    var m = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    var t = (p === 'light' || p === 'dark') ? p : (m ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', t);
    var s = localStorage.getItem('cz-color-scheme');
    var scheme = (s === 'origin' || s === 'blood-moon' || s === 'polished') ? s : 'polished';
    document.documentElement.setAttribute('data-color-scheme', scheme);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'dark' ? '#0c0c0f' : '#3b5bdb');
  } catch (e) {}
})();
