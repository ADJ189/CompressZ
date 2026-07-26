import { registerBusyCheck } from '../main';
import { uid, formatBytes } from '../lib/types';
import type { ImageFormat, AudioFormat } from '../lib/types';
import { createDropZone } from '../components';
import { toast } from '../toast';
import { convertVideo, type VideoContainer } from '../lib/convertMedia';
import { compressAudio } from '../lib/compressAudio';
import { compressImage, getBestFormat } from '../lib/compressImage';
import { pdfToImages, imagesToPdf } from '../lib/convertPdf';
import { docxToPdf, docxToText, docxToHtml, pptxToPdf, pptxToText } from '../lib/convertOffice';
import { zipSupported } from '../lib/zip';

type Category = 'video' | 'audio' | 'image' | 'pdf2img' | 'img2pdf' | 'docx' | 'pptx';

interface CatMeta {
  label: string; icon: string; accept: string; multi: boolean;
  test: RegExp; dz: { title: string; subtitle: string };
  targets: { value: string; label: string }[];
}

const CATS: Record<Category, CatMeta> = {
  video: {
    label: 'Video', icon: '🎬', accept: 'video/*', multi: true,
    test: /\.(mp4|webm|mov|mkv|avi|m4v|flv|wmv|ogv|3gp)$/i,
    dz: { title: 'Drop video files here', subtitle: 'MP4 · WebM · MOV · MKV · AVI → any of these, or GIF' },
    targets: [
      { value: 'mp4',  label: 'MP4 (H.264/AAC)' },
      { value: 'webm', label: 'WebM (VP9/Opus)' },
      { value: 'mov',  label: 'MOV (QuickTime)' },
      { value: 'mkv',  label: 'MKV (Matroska)' },
      { value: 'avi',  label: 'AVI (legacy compat)' },
      { value: 'gif',  label: 'GIF (12fps/720px capped)' },
    ],
  },
  audio: {
    label: 'Audio', icon: '🎵', accept: 'audio/*', multi: true,
    test: /\.(mp3|aac|ogg|opus|flac|wav|m4a|wma|aiff|aif)$/i,
    dz: { title: 'Drop audio files here', subtitle: 'MP3 · AAC · OGG · Opus · FLAC · WAV → any of these' },
    targets: [
      { value: 'mp3',  label: 'MP3' },
      { value: 'aac',  label: 'AAC (.m4a)' },
      { value: 'ogg',  label: 'OGG Vorbis' },
      { value: 'opus', label: 'Opus' },
      { value: 'flac', label: 'FLAC (lossless)' },
      { value: 'wav',  label: 'WAV (uncompressed)' },
    ],
  },
  image: {
    label: 'Image', icon: '🖼️', accept: 'image/*,.heic,.heif', multi: true,
    test: /\.(jpg|jpeg|png|webp|avif|bmp|tiff|tif|heic|heif)$/i,
    dz: { title: 'Drop images here', subtitle: 'JPEG · PNG · WebP · AVIF · HEIC · BMP · TIFF → any of these' },
    targets: [
      { value: 'image/jpeg', label: 'JPEG' },
      { value: 'image/png',  label: 'PNG' },
      { value: 'image/webp', label: 'WebP' },
      { value: 'image/avif', label: 'AVIF' },
    ],
  },
  pdf2img: {
    label: 'PDF → Images', icon: '📄', accept: 'application/pdf,.pdf', multi: true,
    test: /\.pdf$/i,
    dz: { title: 'Drop PDF files here', subtitle: 'Each page becomes an image (zipped if multi-page)' },
    targets: [
      { value: 'png',  label: 'PNG (lossless)' },
      { value: 'jpeg', label: 'JPEG' },
    ],
  },
  img2pdf: {
    label: 'Images → PDF', icon: '🧩', accept: 'image/*', multi: true,
    test: /\.(jpg|jpeg|png|webp|avif|bmp|tiff|tif|heic|heif)$/i,
    dz: { title: 'Drop images here', subtitle: 'All selected images are combined into one PDF, in order' },
    targets: [{ value: 'pdf', label: 'PDF' }],
  },
  docx: {
    label: 'Word (.docx)', icon: '📝', accept: '.docx', multi: true,
    test: /\.docx$/i,
    dz: { title: 'Drop .docx files here', subtitle: 'Legacy .doc is not supported — save as .docx first' },
    targets: [
      { value: 'pdf',  label: 'PDF' },
      { value: 'txt',  label: 'Plain text (.txt)' },
      { value: 'html', label: 'HTML' },
    ],
  },
  pptx: {
    label: 'PowerPoint (.pptx)', icon: '📊', accept: '.pptx', multi: true,
    test: /\.pptx$/i,
    dz: { title: 'Drop .pptx files here', subtitle: 'Legacy .ppt is not supported — save as .pptx first' },
    targets: [
      { value: 'pdf', label: 'PDF (text reconstruction)' },
      { value: 'txt', label: 'Plain text (.txt)' },
    ],
  },
};

interface ConvertEntry {
  id: string; file: File;
  status: 'idle' | 'processing' | 'done' | 'error';
  progress: number; label: string; error?: string;
  resultBlob?: Blob; resultName?: string; resultSize?: number;
}

export function mountConvert(root: HTMLElement): void {
  let category: Category = 'video';
  let target = CATS.video.targets[0].value;
  let files: ConvertEntry[] = [];

  // img2pdf uses a separate, order-sensitive selection instead of the
  // normal per-file card list, since it's a many-files → one-file operation.
  let combineFiles: File[] = [];
  let combineBusy = false;

  function setCategory(c: Category) {
    category = c;
    target = CATS[c].targets[0].value;
    files = [];
    combineFiles = [];
    renderTabs();
    rebuildDropZone();
    renderSettings();
    render();
  }

  function addFiles(fs: File[]) {
    const meta = CATS[category];
    const valid = fs.filter(f => meta.test.test(f.name));
    if (!valid.length) {
      toast(`No valid ${meta.label} files found for this category`, 'error');
      return;
    }
    if (category === 'img2pdf') {
      combineFiles = [...combineFiles, ...valid];
      render();
      return;
    }
    files = [...files, ...valid.map(f => ({ id: uid(), file: f, status: 'idle' as const, progress: 0, label: 'Ready' }))];
    render();
  }

  async function processEntry(entry: ConvertEntry) {
    entry.status = 'processing'; entry.progress = 0; entry.label = 'Starting…';
    patchCard(entry);
    try {
      const onP = (pct: number) => { entry.progress = pct; entry.label = `${pct}%`; patchCard(entry); };
      const base = entry.file.name.replace(/\.[^.]+$/, '');

      if (category === 'video') {
        const r = await convertVideo(entry.file, target as VideoContainer, onP);
        entry.resultBlob = r.blob; entry.resultSize = r.convertedSize;
        entry.resultName = `${base}.${target}`;
      } else if (category === 'audio') {
        const hiBitrate: Record<string, number> = { mp3: 256, aac: 256, ogg: 256, opus: 160, flac: 0, wav: 0 };
        const r = await compressAudio(entry.file, { audioFormat: target as AudioFormat, audioBitrate: hiBitrate[target] }, onP);
        entry.resultBlob = r.blob; entry.resultSize = r.compressedSize;
        entry.resultName = `${base}.${target === 'aac' ? 'm4a' : target}`;
      } else if (category === 'image') {
        const r = await compressImage(entry.file, { format: target as ImageFormat, quality: 0.95 }, onP);
        const usedFmt = getBestFormat(target as ImageFormat);
        const ext = usedFmt === 'image/jpeg' ? 'jpg' : usedFmt.split('/')[1];
        entry.resultBlob = r.blob; entry.resultSize = r.compressedSize;
        entry.resultName = `${base}.${ext}`;
      } else if (category === 'pdf2img') {
        const r = await pdfToImages(entry.file, target as 'png' | 'jpeg', 200, onP);
        entry.resultBlob = r.blob; entry.resultSize = r.blob.size;
        entry.resultName = r.isZip ? `${base}_pages.zip` : `${base}.${target === 'jpeg' ? 'jpg' : 'png'}`;
      } else if (category === 'docx') {
        if (target === 'pdf') {
          entry.resultBlob = await docxToPdf(entry.file, onP);
          entry.resultName = `${base}.pdf`;
        } else if (target === 'html') {
          const html = await docxToHtml(entry.file); onP(100);
          entry.resultBlob = new Blob([html], { type: 'text/html' });
          entry.resultName = `${base}.html`;
        } else {
          const text = await docxToText(entry.file); onP(100);
          entry.resultBlob = new Blob([text], { type: 'text/plain' });
          entry.resultName = `${base}.txt`;
        }
        entry.resultSize = entry.resultBlob.size;
      } else if (category === 'pptx') {
        if (target === 'pdf') {
          entry.resultBlob = await pptxToPdf(entry.file, onP);
          entry.resultName = `${base}.pdf`;
        } else {
          const text = await pptxToText(entry.file); onP(100);
          entry.resultBlob = new Blob([text], { type: 'text/plain' });
          entry.resultName = `${base}.txt`;
        }
        entry.resultSize = entry.resultBlob.size;
      }

      entry.status = 'done'; entry.label = 'Done';
    } catch (e: any) {
      entry.error = e?.message ?? 'Conversion failed';
      entry.status = 'error'; entry.label = 'Error';
      toast(entry.error!, 'error');
    }
    patchCard(entry); renderBatch();
  }

  function dlBlob(blob: Blob, name: string) {
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  }
  function downloadEntry(e: ConvertEntry) { if (e.resultBlob && e.resultName) dlBlob(e.resultBlob, e.resultName); }
  // BUG FIX: previously fired every entry's processEntry() from inside
  // .forEach() without awaiting — video/audio conversions share the same
  // FFmpeg.wasm singleton and fixed temp filenames, so concurrent calls
  // raced on the same virtual files. Process the queue one file at a time.
  async function processAll() {
    for (const f of files) {
      if (f.status === 'idle' || f.status === 'error') await processEntry(f);
    }
  }
  function downloadAll() { files.filter(f => f.status === 'done').forEach(downloadEntry); }
  function clearAll() { files = []; render(); }

  async function combineToPdf() {
    if (combineFiles.length < 1) { toast('Add at least one image first', 'error'); return; }
    combineBusy = true; render();
    try {
      const blob = await imagesToPdf(combineFiles, () => render());
      dlBlob(blob, 'combined.pdf');
      toast(`Combined ${combineFiles.length} images into one PDF`, '');
    } catch (e: any) {
      toast(e?.message ?? 'Combine failed', 'error');
    }
    combineBusy = false; render();
  }
  function removeCombine(i: number) { combineFiles = combineFiles.filter((_, idx) => idx !== i); render(); }
  function moveCombine(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= combineFiles.length) return;
    [combineFiles[i], combineFiles[j]] = [combineFiles[j], combineFiles[i]];
    render();
  }

  // ── DOM scaffold ─────────────────────────────────────────────
  let dzMount!: HTMLElement;
  let dzWrap!: ReturnType<typeof createDropZone>;
  let batchEl!: HTMLElement;
  let listEl!: HTMLElement;

  root.innerHTML = `
    <div class="tool-wrap">
      <span class="back-link" data-nav="">← Home</span>
      <div class="page-header">
        <div class="header-top">
          <span class="badge convert">🔁 Convert</span>
          <h1 class="page-title">Format Converter</h1>
        </div>
        <p class="page-sub">Video · Audio · Images · PDF ⇄ Images · Word · PowerPoint — all in your browser</p>
      </div>

      <div class="cv-tabs" id="cat-tabs" role="group" aria-label="Conversion category"></div>

      <div class="settings-card" id="settings-card"></div>
      <div id="dz-mount"></div>
      <div id="combine-area" style="display:none"></div>
      <div class="batch-bar" id="batch-bar" style="display:none"></div>
      <div class="file-list" id="file-list"></div>
    </div>`;

  const tabsEl = root.querySelector('#cat-tabs')! as HTMLElement;
  dzMount = root.querySelector('#dz-mount')!;
  batchEl = root.querySelector('#batch-bar')!;
  listEl  = root.querySelector('#file-list')!;
  const combineArea = root.querySelector('#combine-area')! as HTMLElement;

  function renderTabs() {
    tabsEl.innerHTML = (Object.entries(CATS) as [Category, CatMeta][])
      .map(([key, meta]) => `
        <button class="cv-tab ${category === key ? 'on' : ''}" data-cat="${key}">
          <span class="cv-tab-icon">${meta.icon}</span>${meta.label}
        </button>`).join('');
    tabsEl.querySelectorAll('[data-cat]').forEach(btn =>
      btn.addEventListener('click', () => setCategory((btn as HTMLElement).dataset.cat as Category)));
  }

  function rebuildDropZone() {
    dzMount.innerHTML = '';
    const meta = CATS[category];
    dzWrap = createDropZone({
      accept: meta.accept, icon: meta.icon, title: meta.dz.title, subtitle: meta.dz.subtitle,
      onFiles: addFiles,
    });
    dzMount.appendChild(dzWrap);
  }

  function renderSettings() {
    const card = root.querySelector('#settings-card')!;
    const meta = CATS[category];
    const needsZip = category === 'pdf2img' && !zipSupported();

    card.innerHTML = `
      <div class="s-row">
        <div class="s-field">
          <span class="s-label">Convert to</span>
          <select class="si" id="target-sel" style="min-width:220px">
            ${meta.targets.map(t => `<option value="${t.value}" ${target === t.value ? 'selected' : ''}>${t.label}</option>`).join('')}
          </select>
        </div>
        ${category === 'video' ? `
        <div class="s-field full">
          <div style="font-size:.72rem;color:var(--text-4)">
            Runs through FFmpeg.wasm at a near-lossless quality tier (CRF 18) — this is a format/container
            change, not a size-reduction pass. Use the Video compressor for smaller files.
          </div>
        </div>` : ''}
        ${category === 'pptx' ? `
        <div class="s-field full">
          <div style="font-size:.72rem;color:var(--text-4)">
            PPTX text is extracted directly from the slide XML and reconstructed as plain text per slide —
            this preserves reading order and content, not the original visual design, images, or layout.
          </div>
        </div>` : ''}
        ${category === 'docx' && target === 'pdf' ? `
        <div class="s-field full">
          <div style="font-size:.72rem;color:var(--text-4)">
            Renders the document to page images (via html2canvas) and assembles them into a PDF — formatting
            and embedded images carry over well; the resulting text is not selectable. Choose "Plain text" if
            you need selectable/searchable output instead.
          </div>
        </div>` : ''}
        ${needsZip ? `
        <div class="s-field full">
          <div style="font-size:.72rem;color:var(--warn, #e0a030)">
            ⚠ Multi-page PDFs need ZIP support (CompressionStream) to bundle one image per page — please use a
            current version of Chrome, Firefox, Safari, or Edge. Single-page PDFs still work.
          </div>
        </div>` : ''}
      </div>`;

    card.querySelector('#target-sel')!.addEventListener('change', e => {
      target = (e.target as HTMLSelectElement).value; renderSettings();
    });
  }

  // ── img2pdf combine UI ───────────────────────────────────────
  function renderCombine() {
    if (category !== 'img2pdf') { combineArea.style.display = 'none'; return; }
    combineArea.style.display = 'block';
    combineArea.innerHTML = `
      <div class="batch-bar" style="display:flex">
        <span class="batch-info">${combineFiles.length} image${combineFiles.length !== 1 ? 's' : ''} selected</span>
        <button class="btn-sm btn-run" id="combine-btn" ${combineFiles.length < 1 || combineBusy ? 'disabled' : ''}>
          ${combineBusy ? 'Combining…' : 'Combine into PDF'}
        </button>
        <button class="btn-sm btn-clr" id="combine-clear" ${combineFiles.length < 1 ? 'disabled' : ''}>Clear</button>
      </div>
      <div class="file-list">
        ${combineFiles.map((f, i) => `
          <div class="file-card">
            <div class="fc-ico">🖼️</div>
            <div class="fc-info">
              <div class="fc-name" title="${f.name}">${i + 1}. ${f.name}</div>
              <div class="fc-meta"><span>${formatBytes(f.size)}</span></div>
            </div>
            <div class="fc-actions">
              <button class="fc-btn icon" data-up="${i}" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>↑</button>
              <button class="fc-btn icon" data-down="${i}" aria-label="Move down" ${i === combineFiles.length - 1 ? 'disabled' : ''}>↓</button>
              <button class="fc-btn icon" data-rm="${i}" aria-label="Remove">✕</button>
            </div>
          </div>`).join('')}
      </div>`;

    combineArea.querySelector('#combine-btn')?.addEventListener('click', combineToPdf);
    combineArea.querySelector('#combine-clear')?.addEventListener('click', () => { combineFiles = []; render(); });
    combineArea.querySelectorAll('[data-up]').forEach(b => b.addEventListener('click', () => moveCombine(+(b as HTMLElement).dataset.up!, -1)));
    combineArea.querySelectorAll('[data-down]').forEach(b => b.addEventListener('click', () => moveCombine(+(b as HTMLElement).dataset.down!, 1)));
    combineArea.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => removeCombine(+(b as HTMLElement).dataset.rm!)));
  }

  // ── file cards ───────────────────────────────────────────────
  function renderCard(entry: ConvertEntry): HTMLElement {
    const el = document.createElement('div');
    el.className = 'file-card' + (entry.status === 'done' ? ' is-done' : entry.status === 'error' ? ' is-error' : entry.status === 'processing' ? ' is-compressing' : '');
    el.id = 'cv-card-' + entry.id;

    let meta = `<span>${formatBytes(entry.file.size)}</span>`;
    if (entry.resultBlob) {
      meta += `<span class="sep">→</span><span class="comp">${formatBytes(entry.resultSize ?? entry.resultBlob.size)}</span>`;
      if (entry.resultName) meta += `<span class="eng">${entry.resultName.split('.').pop()?.toUpperCase()}</span>`;
    }
    if (entry.status === 'error') meta += `<span class="err-msg">⚠ ${esc(entry.error?.slice(0, 80) ?? 'Error')}</span>`;

    const progress = entry.status === 'processing' ? `
      <div class="fc-progress"><div class="fc-progress-fill" style="width:${entry.progress}%"></div></div>
      <div class="fc-progress-label">${entry.label}</div>` : '';

    let actions = '';
    if (entry.status === 'idle' || entry.status === 'error') actions += `<button class="fc-btn primary" data-action="run">${entry.status === 'error' ? 'Retry' : 'Convert'}</button>`;
    else if (entry.status === 'processing') actions += `<span class="fc-pct">${entry.progress}%</span>`;
    else if (entry.status === 'done') actions += `<button class="fc-btn dl" data-action="download">⬇ Save</button>`;
    actions += `<button class="fc-btn icon" data-action="remove" aria-label="Remove">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`;

    el.innerHTML = `
      <div class="fc-ico">${CATS[category].icon}</div>
      <div class="fc-info">
        <div class="fc-name" title="${esc(entry.file.name)}">${esc(entry.file.name)}</div>
        <div class="fc-meta">${meta}</div>
        ${progress}
      </div>
      <div class="fc-actions">${actions}</div>`;

    el.querySelector('[data-action="run"]')?.addEventListener('click', () => processEntry(entry));
    el.querySelector('[data-action="download"]')?.addEventListener('click', () => downloadEntry(entry));
    el.querySelector('[data-action="remove"]')?.addEventListener('click', () => { files = files.filter(f => f.id !== entry.id); render(); });
    return el;
  }
  function patchCard(entry: ConvertEntry) {
    const old = document.getElementById('cv-card-' + entry.id);
    if (old) old.replaceWith(renderCard(entry));
  }

  function renderBatch() {
    batchEl.innerHTML = '';
    if (category === 'img2pdf' || !files.length) { batchEl.style.display = 'none'; return; }
    batchEl.style.display = 'flex';
    const done = files.filter(f => f.status === 'done').length;
    const q = files.filter(f => f.status === 'idle' || f.status === 'error').length;
    const mk = (label: string, cls: string, fn: () => void) => {
      const b = Object.assign(document.createElement('button'), { className: `btn-sm ${cls}`, textContent: label });
      b.onclick = fn; return b;
    };
    batchEl.append(
      Object.assign(document.createElement('span'), { className: 'batch-info', textContent: `${files.length} file${files.length !== 1 ? 's' : ''} · ${done} done · ${q} queued` }),
      mk('Convert all', 'btn-run', processAll),
      mk('Download all', 'btn-dl', downloadAll),
      mk('Clear', 'btn-clr', clearAll),
    );
  }

  function render() {
    registerBusyCheck(() => combineBusy || files.some(f => f.status === 'processing'));
    (dzWrap as any).setHasFiles(category === 'img2pdf' ? combineFiles.length > 0 : files.length > 0);
    renderBatch();
    renderCombine();
    listEl.innerHTML = '';
    if (category !== 'img2pdf') files.forEach(f => listEl.appendChild(renderCard(f)));
  }

  function esc(s: string) {
    return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
  }

  renderTabs();
  rebuildDropZone();
  renderSettings();
  render();
}
