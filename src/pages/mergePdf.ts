import { formatBytes } from '../lib/types';
import { mergePdfs } from '../lib/mergePdf';
import { createDropZone } from '../components';
import { toast } from '../toast';
import { mergeStore } from '../store';
import { registerBusyCheck } from '../main';

export function mountMergePdf(root: HTMLElement) {
  const s = mergeStore;
  let progress = 0;

  function addFiles(fs: File[]) {
    const valid = fs.filter(f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
    if (!valid.length) { toast('No PDF files found', 'error'); return; }
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

  async function runMerge() {
    if (s.files.length < 2) { toast('Add at least two PDFs to merge', 'error'); return; }
    s.busy = true; progress = 0; render();
    try {
      const result = await mergePdfs(s.files, p => { progress = p; render(); });
      const a = Object.assign(document.createElement('a'), {
        href: URL.createObjectURL(result.blob),
        download: 'merged.pdf',
      });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      toast(`Merged ${s.files.length} PDFs into one ${result.pageCount}-page file`, 'success');
    } catch (e: any) {
      toast(e?.message ?? 'Merge failed', 'error');
    }
    s.busy = false; render();
  }

  let dzWrap!: ReturnType<typeof createDropZone>;
  let listEl!: HTMLElement;
  let barEl!: HTMLElement;

  root.innerHTML = `
    <div class="tool-wrap">
      <span class="back-link" data-nav="">← Home</span>
      <div class="page-header">
        <div class="header-top">
          <span class="badge merge">🧷 PDF</span>
          <h1 class="page-title">Merge PDF</h1>
        </div>
        <p class="page-sub">
          Combine two or more PDFs into a single file, in the order you choose.
          Pages are copied directly — text stays selectable and vectors stay sharp.
        </p>
      </div>

      <div id="dz-mount"></div>
      <div class="batch-bar" id="merge-bar" style="display:none"></div>
      <div class="file-list" id="merge-list"></div>
    </div>
  `;

  dzWrap = createDropZone({
    accept:   'application/pdf,.pdf',
    icon:     '🧷',
    title:    'Drop PDF files here',
    subtitle: 'Add two or more — reorder them below before merging',
    onFiles:  addFiles,
  });
  root.querySelector('#dz-mount')!.appendChild(dzWrap);

  barEl  = root.querySelector('#merge-bar')!;
  listEl = root.querySelector('#merge-list')!;

  function renderBar() {
    barEl.innerHTML = '';
    if (!s.files.length) { barEl.style.display = 'none'; return; }
    barEl.style.display = 'flex';

    const info = document.createElement('span');
    info.className = 'batch-info';
    info.textContent = s.busy
      ? `Merging… ${progress}%`
      : `${s.files.length} PDF${s.files.length !== 1 ? 's' : ''} selected`;

    const btnRun = document.createElement('button');
    btnRun.className = 'btn-sm btn-run';
    btnRun.textContent = s.busy ? 'Merging…' : 'Merge & download';
    btnRun.disabled = s.busy || s.files.length < 2;
    btnRun.addEventListener('click', runMerge);

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
        <div class="fc-ico">📄</div>
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
    renderBar();
    renderList();
  }

  render();
}
