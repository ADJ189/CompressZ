import { formatBytes } from '../lib/types';
import { imagesToPdf } from '../lib/imagesToPdf';
import { createDropZone } from '../components';
import { toast } from '../toast';
import { imagesToPdfStore } from '../store';
import { registerBusyCheck } from '../main';

const PAGE_SIZES: { id: 'auto' | 'a4' | 'letter'; label: string; sub: string }[] = [
  { id: 'auto',   label: 'Auto',   sub: "Each page matches its image's own size" },
  { id: 'a4',     label: 'A4',     sub: '210 × 297 mm, image scaled to fit' },
  { id: 'letter', label: 'Letter', sub: '8.5 × 11 in, image scaled to fit' },
];

// A4/Letter in PDF points (1/72in) — used to size+center pages that aren't 'auto'.
const A4_PT     = { w: 595.28, h: 841.89 };
const LETTER_PT = { w: 612,    h: 792   };

export function mountImagesToPdf(root: HTMLElement) {
  const s = imagesToPdfStore;
  let progress = 0;

  function addFiles(fs: File[]) {
    const valid = fs.filter(f => f.type.startsWith('image/') || /\.(jpg|jpeg|png|webp|avif|bmp|tiff|tif|heic|heif)$/i.test(f.name));
    if (!valid.length) { toast('No image files found', 'error'); return; }
    s.files = [...s.files, ...valid];
    render();
  }

  function removeAt(i: number) {
    s.files = s.files.filter((_, idx) => idx !== i);
    render();
  }

  function moveAt(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= s.files.length) return;
    const next = s.files.slice();
    [next[i], next[j]] = [next[j], next[i]];
    s.files = next;
    render();
  }

  function clearAll() {
    s.files = [];
    render();
  }

  async function runCombine() {
    if (s.files.length < 1) { toast('Add at least one image', 'error'); return; }
    s.busy = true; progress = 0; render();
    try {
      const pageSizePt = s.pageSize === 'a4' ? A4_PT : s.pageSize === 'letter' ? LETTER_PT : undefined;
      const blob = await imagesToPdf(
        s.files,
        { quality: s.quality / 100, pageSize: pageSizePt },
        p => { progress = p; render(); },
      );
      const a = Object.assign(document.createElement('a'), {
        href: URL.createObjectURL(blob),
        download: 'images.pdf',
      });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      toast(`Combined ${s.files.length} image${s.files.length !== 1 ? 's' : ''} into one PDF`, 'success');
    } catch (e: any) {
      toast(e?.message ?? 'Combine failed', 'error');
    }
    s.busy = false; render();
  }

  let dzWrap!: ReturnType<typeof createDropZone>;
  let listEl!: HTMLElement;
  let barEl!: HTMLElement;
  let cardEl!: HTMLElement;

  root.innerHTML = `
    <div class="tool-wrap">
      <span class="back-link" data-nav="">← Home</span>
      <div class="page-header">
        <div class="header-top">
          <span class="badge img">🧩 Images</span>
          <h1 class="page-title">Images → PDF</h1>
        </div>
        <p class="page-sub">
          Combine two or more images into a single PDF, one image per page, in the order you choose.
        </p>
        <p class="page-sub" style="color:var(--text-4)">GPU-accelerated resize when Settings → GPU Acceleration → Images is on</p>
      </div>

      <div class="settings-card" id="itp-settings"></div>

      <div id="dz-mount"></div>
      <div class="batch-bar" id="itp-bar" style="display:none"></div>
      <div class="file-list" id="itp-list"></div>
    </div>
  `;

  cardEl = root.querySelector('#itp-settings')!;

  dzWrap = createDropZone({
    accept:   'image/*,.heic,.heif',
    icon:     '🧩',
    title:    'Drop images here',
    subtitle: 'Add two or more — reorder them below before combining',
    onFiles:  addFiles,
  });
  root.querySelector('#dz-mount')!.appendChild(dzWrap);

  barEl  = root.querySelector('#itp-bar')!;
  listEl = root.querySelector('#itp-list')!;

  function renderSettings() {
    cardEl.innerHTML = `
      <div class="s-field full">
        <span class="s-label">Page size</span>
        <div class="pdf-presets" id="itp-sizes"></div>
      </div>
      <div class="s-field">
        <span class="s-label">JPEG quality <strong id="itp-q-label">${s.quality}%</strong></span>
        <input type="range" class="slider" min="10" max="99" value="${s.quality}" id="itp-q-range">
      </div>
    `;
    const sizesEl = cardEl.querySelector('#itp-sizes')!;
    PAGE_SIZES.forEach(p => {
      const el = document.createElement('div');
      el.className = 'pdf-preset' + (s.pageSize === p.id ? ' on' : '');
      el.setAttribute('role', 'radio');
      el.setAttribute('aria-checked', String(s.pageSize === p.id));
      el.innerHTML = `<div class="pp-emoji">${p.id === 'auto' ? '📐' : p.id === 'a4' ? '📄' : '📃'}</div><div class="pp-label">${p.label}</div><div class="pp-sub">${p.sub}</div>`;
      el.addEventListener('click', () => { s.pageSize = p.id; renderSettings(); });
      sizesEl.appendChild(el);
    });
    cardEl.querySelector('#itp-q-range')!.addEventListener('input', e => {
      s.quality = +(e.target as HTMLInputElement).value;
      cardEl.querySelector('#itp-q-label')!.textContent = `${s.quality}%`;
    });
  }

  function renderBar() {
    barEl.innerHTML = '';
    if (!s.files.length) { barEl.style.display = 'none'; return; }
    barEl.style.display = 'flex';

    const info = document.createElement('span');
    info.className = 'batch-info';
    info.textContent = s.busy
      ? `Combining… ${progress}%`
      : `${s.files.length} image${s.files.length !== 1 ? 's' : ''} selected`;

    const btnRun = document.createElement('button');
    btnRun.className = 'btn-sm btn-run';
    btnRun.textContent = s.busy ? 'Combining…' : 'Combine & download';
    btnRun.disabled = s.busy || s.files.length < 1;
    btnRun.addEventListener('click', runCombine);

    const btnClr = document.createElement('button');
    btnClr.className = 'btn-sm btn-clr';
    btnClr.textContent = 'Clear';
    btnClr.disabled = s.busy || !s.files.length;
    btnClr.addEventListener('click', clearAll);

    barEl.append(info, btnRun, btnClr);
  }

  function renderList() {
    listEl.innerHTML = '';
    s.files.forEach((f, i) => {
      const el = document.createElement('div');
      el.className = 'file-card';
      el.innerHTML = `
        <div class="fc-ico">🖼️</div>
        <div class="fc-info">
          <div class="fc-name" title="${esc(f.name)}">${i + 1}. ${esc(f.name)}</div>
          <div class="fc-meta"><span>${formatBytes(f.size)}</span></div>
        </div>
        <div class="fc-actions">
          <button class="fc-btn icon" data-up aria-label="Move up" ${i === 0 || s.busy ? 'disabled' : ''}>↑</button>
          <button class="fc-btn icon" data-down aria-label="Move down" ${i === s.files.length - 1 || s.busy ? 'disabled' : ''}>↓</button>
          <button class="fc-btn icon" data-rm aria-label="Remove" ${s.busy ? 'disabled' : ''}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>`;
      el.querySelector('[data-up]')?.addEventListener('click', () => moveAt(i, -1));
      el.querySelector('[data-down]')?.addEventListener('click', () => moveAt(i, 1));
      el.querySelector('[data-rm]')?.addEventListener('click', () => removeAt(i));
      listEl.appendChild(el);
    });
  }

  function esc(str: string) {
    return str.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
  }

  function render() {
    registerBusyCheck(() => s.busy);
    (dzWrap as any).setHasFiles(s.files.length > 0);
    renderSettings();
    renderBar();
    renderList();
  }

  render();
}
