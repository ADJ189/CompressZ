import './style.css';
import { on, init, navigate } from './router';

// ── Theme ─────────────────────────────────────────────────────
const html      = document.documentElement;
const themeIcon = document.getElementById('theme-icon')!;

const SUN  = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`;
const MOON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;

function applyTheme(t: string) {
  html.setAttribute('data-theme', t);
  localStorage.setItem('theme', t);
  if (themeIcon) themeIcon.innerHTML = t === 'dark' ? SUN : MOON;
  const lbl = document.getElementById('theme-label');
  if (lbl) lbl.textContent = t === 'dark' ? 'Light mode' : 'Dark mode';
  document.getElementById('theme-btn')?.setAttribute('aria-label', t === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
}
document.getElementById('theme-btn')!.addEventListener('click', () =>
  applyTheme(html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'));

const saved = localStorage.getItem('theme') ||
  (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
applyTheme(saved);

// ── Splash ────────────────────────────────────────────────────
// CSS drives the fade itself (auto-plays, .8s delay + .4s duration — see
// #splash in style.css); this just removes the element from the a11y tree
// and click path once that fade has finished, rather than leaving an
// invisible-but-present overlay behind.
setTimeout(() => document.getElementById('splash')!.classList.add('done'), 1200);

// ── Horizontal tab bar ───────────────────────────────────────
// Replaces the old vertical sidebar (collapse toggle + mobile drawer).
// A single scrollable row; the active tab gets scrolled into view and
// a thumb glides under it using the fluid easing curve (--ease-fluid).
const tabbarScroll = document.getElementById('tabbar-scroll')!;
const tabbarThumb  = document.getElementById('tabbar-thumb')!;

function moveThumbTo(el: HTMLElement | null) {
  if (!el) { tabbarThumb.style.width = '0'; return; }
  const scrollRect = tabbarScroll.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  const left = elRect.left - scrollRect.left + tabbarScroll.scrollLeft;
  tabbarThumb.style.transform = `translateX(${left}px)`;
  tabbarThumb.style.width = `${elRect.width}px`;
}

// Recompute on resize — tab widths / positions shift with viewport width.
let activeTabEl: HTMLElement | null = null;
window.addEventListener('resize', () => moveThumbTo(activeTabEl));
// Tab-label widths depend on the webfont metrics; reposition once it's
// actually loaded so the thumb isn't measured against a fallback font.
document.fonts?.ready.then(() => moveThumbTo(activeTabEl));

// ── "More" dropdown (About / Docs / Privacy) ────────────────────
const moreBtn  = document.getElementById('tab-more-btn')!;
const moreMenu = document.getElementById('tab-more-menu')!;
const MORE_ROUTES = ['about', 'docs', 'privacy'];
let moreOpen = false;

function setMoreOpen(v: boolean) {
  moreOpen = v;
  moreMenu.classList.toggle('open', v);
  moreBtn.setAttribute('aria-expanded', String(v));
}
moreBtn.addEventListener('click', e => { e.stopPropagation(); setMoreOpen(!moreOpen); });
document.addEventListener('click', e => {
  if (moreOpen && !(e.target as Element).closest('#tab-more')) setMoreOpen(false);
});

// ── Nav active state ──────────────────────────────────────────
function setActiveNav(route: string) {
  let active: HTMLElement | null = null;
  const tabs = document.querySelectorAll<HTMLElement>('[data-tab]');
  for (const el of Array.from(tabs)) {
    const r = el.dataset.nav ?? '';
    const isActive = route === r || (r !== '' && route.startsWith(r + '/'));
    el.classList.toggle('active', isActive);
    if (isActive) active = el;
  }
  activeTabEl = active;
  moveThumbTo(active);
  if (active !== null && (active as HTMLElement).closest('#tabbar-scroll')) {
    (active as HTMLElement).scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }
  if (MORE_ROUTES.includes(route)) setMoreOpen(false); // dropdown item picked → close it
}

// ── Settings dialog ──────────────────────────────────────────
// Reuses pages/settings.ts's mountSettings() unchanged — it just renders
// into the dialog body instead of a routed page. Content is mounted once
// on first open and left in place (same pattern the old settings ROUTE
// used: state lives in localStorage via lib/settings.ts, not the DOM).
const settingsBtn     = document.getElementById('settings-btn')!;
const settingsOverlay = document.getElementById('settings-dialog-overlay')!;
const settingsDialog  = document.getElementById('settings-dialog')!;
const settingsClose   = document.getElementById('settings-dialog-close')!;
const settingsBody    = document.getElementById('settings-dialog-body')!;
let settingsMounted = false;

async function openSettings() {
  if (!settingsMounted) {
    settingsMounted = true;
    const { mountSettings } = await import('./pages/settings');
    mountSettings(settingsBody);
  }
  settingsOverlay.hidden = false;
  settingsDialog.hidden = false;
  // rAF so the "hidden" removal paints before the open class kicks the
  // opacity/transform transition — otherwise the browser coalesces both
  // and it just snaps open with no animation.
  requestAnimationFrame(() => {
    settingsOverlay.classList.add('open');
    settingsDialog.classList.add('open');
  });
  document.body.style.overflow = 'hidden';
}
function closeSettings() {
  settingsOverlay.classList.remove('open');
  settingsDialog.classList.remove('open');
  document.body.style.overflow = '';
  setTimeout(() => { settingsOverlay.hidden = true; settingsDialog.hidden = true; }, 380);
}
settingsBtn.addEventListener('click', openSettings);
settingsClose.addEventListener('click', closeSettings);
settingsOverlay.addEventListener('click', closeSettings);
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !settingsDialog.hidden) closeSettings();
});

// ── Page view with animation ──────────────────────────────────
const pageView = document.getElementById('page-view')!;

type PageMount = (root: HTMLElement) => void;

// Guards against a slow chunk load finishing after the user has already
// navigated elsewhere (would otherwise render a stale page over the new one).
let pageToken = 0;

async function mountPage(load: () => Promise<PageMount>) {
  const token = ++pageToken;
  pageView.innerHTML = '<div class="page-loading" aria-hidden="true"></div>';
  const fn = await load();
  if (token !== pageToken) return;
  pageView.innerHTML = '';
  const wrapper = document.createElement('div');
  wrapper.className = 'page-enter';
  fn(wrapper);
  pageView.appendChild(wrapper);
  window.scrollTo(0, 0);
}

function showStatic(id: string) {
  pageView.innerHTML = '';
  const tpl = document.getElementById(id) as HTMLTemplateElement | null;
  if (!tpl) return;
  const wrapper = document.createElement('div');
  wrapper.className = 'page-enter';
  wrapper.appendChild(tpl.content.cloneNode(true));
  pageView.appendChild(wrapper);
  window.scrollTo(0, 0);
}

// ── Routes ────────────────────────────────────────────────────
on('',                () => { setActiveNav('');         showStatic('tpl-home'); });
on('compress/images', () => { setActiveNav('compress/images'); mountPage(() => import('./pages/images').then(m => m.mountImages)); });
on('compress/pdf',    () => { setActiveNav('compress/pdf');    mountPage(() => import('./pages/pdf').then(m => m.mountPdf)); });
on('compress/video',  () => { setActiveNav('compress/video');  mountPage(() => import('./pages/video').then(m => m.mountVideo)); });
on('compress/audio',  () => { setActiveNav('compress/audio');  mountPage(() => import('./pages/audio').then(m => m.mountAudio)); });
on('compress/gif',    () => { setActiveNav('compress/gif');    mountPage(() => import('./pages/gif').then(m => m.mountGif)); });
on('compress/ocr',    () => { setActiveNav('compress/ocr');    mountPage(() => import('./pages/ocr').then(m => m.mountOcr)); });
on('compress/merge-pdf', () => { setActiveNav('compress/merge-pdf'); mountPage(() => import('./pages/mergePdf').then(m => m.mountMergePdf)); });
on('compress/images-to-pdf', () => { setActiveNav('compress/images-to-pdf'); mountPage(() => import('./pages/imagesToPdf').then(m => m.mountImagesToPdf)); });
on('convert',         () => { setActiveNav('convert');         mountPage(() => import('./pages/convert').then(m => m.mountConvert)); });
on('settings',        () => { navigate(''); openSettings(); }); // old deep link →
  // Settings is a dialog now, not a page (see openSettings() above); send
  // #settings visitors to Home with the dialog open instead of an orphaned route.
on('about',           () => { setActiveNav('about');           showStatic('tpl-about'); });
on('docs',            () => { setActiveNav('docs');            showStatic('tpl-docs'); });
on('privacy',         () => { setActiveNav('privacy');         showStatic('tpl-privacy'); });
on('*',               () => { setActiveNav('');                showStatic('tpl-home'); });

init();

// Export navigate for inline onclick use in templates
(window as any).navigate = navigate;

// ── Unload guard ──────────────────────────────────────────────
// Page modules call registerBusyCheck(() => boolean) when they mount.
// The handler is replaced on each navigation so stale checks don't linger.
let _busyCheck: (() => boolean) | null = null;
export function registerBusyCheck(fn: () => boolean) { _busyCheck = fn; }
window.addEventListener('beforeunload', e => {
  if (_busyCheck?.()) {
    e.preventDefault();
    // Most modern browsers show a generic message — the custom string is ignored.
    e.returnValue = 'Compression in progress — leaving will discard your work.';
  }
});

// ─────────────────────────────────────────────
//  🄰🄳🄹 · built with ♥ — ADJ
// ─────────────────────────────────────────────
