import { registerBusyCheck } from '../main';
import { uid, getOutputExtension } from '../lib/types';
import type { FileEntry, CompressOptions, ImageFormat } from '../lib/types';
import { compressImage, getBestFormat } from '../lib/compressImage';
import { createDropZone, renderFileCard, patchFileCard, renderBatchBar } from '../components';
import { toast } from '../toast';
import { imageStore } from '../store';
import { getSettings, resolvedAiModelTier } from '../lib/settings';
import { aiSupported } from '../lib/aiEngine';
import { runBatch } from '../lib/batch';

export function mountImages(root: HTMLElement) {
  // ── State — lives in imageStore so it survives navigation ───
  const s = imageStore; // shorthand alias

  // ── AI (Smart Analyze) — local, on-device (see lib/aiEngine.ts) ─
  let aiBusy = false;
  let aiNote = '';

  async function runSmartAnalyze() {
    if (!s.files.length || aiBusy) return;
    const settings = getSettings();
    if (!settings.ai.enabled) { toast('Enable Local AI features in Settings first', 'error'); return; }
    if (!aiSupported()) { toast('This browser can\u2019t run the local AI engine', 'error'); return; }

    aiBusy = true; aiNote = 'Starting…'; render();
    try {
      const { smartAnalyze } = await import('../lib/aiEngine');
      const tier = resolvedAiModelTier(settings);
      const files = s.files.map(f => f.file);
      const analysis = await smartAnalyze(files, tier, (done, total, note) => {
        aiNote = `${note} (${done}/${total})`; renderAiBar();
      });

      const byFile = new Map(analysis.map(a => [a.file, a]));
      s.files.forEach(entry => {
        const a = byFile.get(entry.file);
        if (!a) return;
        entry.aiLabel = a.tag?.label;
        if (settings.ai.autoApplySuggestions && (entry.status === 'idle' || entry.status === 'error')) {
          entry.options = { ...entry.options, format: a.content.suggestedFormat, quality: a.content.suggestedQuality / 100 };
        }
      });
      // Group visually/semantically similar images together instead of leaving upload order.
      s.files = s.files.slice().sort((x, y) => (x.aiLabel ?? x.file.name).localeCompare(y.aiLabel ?? y.file.name));

      const tagged = analysis.filter(a => a.tag).length;
      toast(`Analyzed ${analysis.length} image${analysis.length !== 1 ? 's' : ''} · ${tagged} tagged and sorted${settings.ai.autoApplySuggestions ? ' · settings applied' : ''}`, 'success');
    } catch (e: any) {
      toast(e?.message ?? 'Smart Analyze failed', 'error');
    }
    aiBusy = false; render();
    const { revealStagger } = await import('../lib/motion').catch(() => ({ revealStagger: undefined as any }));
    if (revealStagger) revealStagger(listEl.querySelectorAll('.file-card'));
  }

  const effectiveFmt = () => getBestFormat(s.format);
  const fmtMismatch  = () => effectiveFmt() !== s.format;

  function buildOptions(): CompressOptions {
    const o: CompressOptions = { format: effectiveFmt() };
    if (s.maxDim > 0) { o.maxWidth = s.maxDim; o.maxHeight = s.maxDim; }
    if (s.mode === 'quality') o.quality = s.quality / 100;
    else                      o.targetSizeKB = s.targetSizeKB;
    return o;
  }

  function addFiles(fs: File[]) {
    const valid = fs.filter(f =>
      f.type.startsWith('image/') || /\.(jpg|jpeg|png|webp|avif|bmp|tiff|tif|heic|heif)$/i.test(f.name));
    if (!valid.length) { toast('No valid image files found', 'error'); return; }
    s.files = [...s.files, ...valid.map(f => ({
      id: uid(), file: f, type: 'image' as const,
      status: 'idle' as const, progress: 0, options: buildOptions(),
    }))];
    render();
  }

  async function compressEntry(entry: FileEntry) {
    entry.status = 'compressing'; entry.progress = 0; entry.options = buildOptions();
    patchFileCard(entry, cbs);
    try {
      entry.result = await compressImage(entry.file, entry.options, p => {
        entry.progress = p; patchFileCard(entry, cbs);
      });
      entry.status = 'done';
    } catch (e: any) {
      entry.error  = e.message ?? 'Compression failed';
      entry.status = 'error';
      toast(entry.error!, 'error');
    }
    patchFileCard(entry, cbs);
    renderBatchBar(batchEl, s.files, compressAll, downloadAll, clearAll);
  }

  function downloadEntry(entry: FileEntry) {
    if (!entry.result) return;
    const ext = getOutputExtension(entry.result);
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(entry.result.blob),
      download: entry.file.name.replace(/\.[^.]+$/, '') + '_compressed.' + ext,
    });
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  }

  // Canvas-based (no shared singleton to serialize on), so this can run
  // several files at once — capped to what platform.ts recommends for the
  // current device instead of firing every file at once unbounded.
  function compressAll() {
    const pending = s.files.filter(f => f.status === 'idle' || f.status === 'error');
    runBatch(pending, compressEntry);
  }
  function downloadAll()  { s.files.filter(f => f.status === 'done').forEach(downloadEntry); }
  function clearAll()     { s.files = []; render(); }

  const cbs = { onCompress: compressEntry, onDownload: downloadEntry, onRemove: (id: string) => { s.files = s.files.filter(f => f.id !== id); render(); } };

  // ── DOM ─────────────────────────────────────────────────────
  let batchEl!: HTMLElement;
  let listEl!:  HTMLElement;
  let dzWrap!:  ReturnType<typeof createDropZone>;
  let warnEl!:  HTMLElement;

  root.innerHTML = `
    <div class="tool-wrap">
      <span class="back-link" data-nav="">← Home</span>
      <div class="page-header">
        <div class="header-top">
          <span class="badge img">🖼️ Images</span>
          <h1 class="page-title">Image Compressor</h1>
        </div>
        <p class="page-sub">GPU-decoded · OffscreenCanvas · JPEG · PNG · WebP · AVIF · BMP · TIFF · HEIC</p>
        <p class="page-sub" style="color:var(--text-4)">🔒 EXIF/GPS metadata is always stripped — re-encoding through canvas doesn't carry it over</p>
        <div id="fmt-warn" class="compat-warn" style="display:none"></div>
      </div>

      <div class="settings-card" id="settings-card"></div>
      <div id="dz-mount"></div>
      <div id="ai-bar"></div>
      <div class="batch-bar" id="batch-bar" style="display:none"></div>
      <div class="file-list" id="file-list"></div>
    </div>
  `;

  warnEl  = root.querySelector('#fmt-warn')!;
  batchEl = root.querySelector('#batch-bar')!;
  listEl  = root.querySelector('#file-list')!;
  const aiBarEl = root.querySelector<HTMLElement>('#ai-bar')!;

  function renderAiBar() {
    aiBarEl.innerHTML = '';
    if (!s.files.length) return;
    const row = document.createElement('div');
    row.className = 'batch-bar';
    row.style.display = 'flex';
    const btn = document.createElement('button');
    btn.className = 'btn-sm btn-ai';
    btn.textContent = aiBusy ? 'Analyzing…' : '✨ Smart Analyze & Sort (AI)';
    btn.disabled = aiBusy;
    btn.title = 'Tags each image locally, groups similar ones together, and (if enabled in Settings) suggests format/quality per image';
    btn.addEventListener('click', runSmartAnalyze);
    row.appendChild(btn);
    aiBarEl.appendChild(row);
    if (aiBusy) {
      const prog = document.createElement('div');
      prog.className = 'ai-progress-row';
      prog.innerHTML = `<span>${aiNote}</span><span class="ai-progress-track"><span class="ai-progress-fill"></span></span>`;
      aiBarEl.appendChild(prog);
    }
  }

  dzWrap = createDropZone({
    accept:   'image/*,.heic,.heif',
    icon:     '🖼️',
    title:    'Drop images here',
    subtitle: 'JPEG · PNG · WebP · AVIF · HEIC · BMP · TIFF',
    onFiles:  addFiles,
  });
  root.querySelector('#dz-mount')!.appendChild(dzWrap);

  function renderSettings() {
    const card = root.querySelector('#settings-card')!;

    const modeHtml = `
      <div class="s-field">
        <span class="s-label">Mode</span>
        <div class="seg" role="group" aria-label="Compression mode">
          <button class="${s.mode==='quality'?'on':''}" aria-pressed="${s.mode==='quality'?'true':'false'}" id="mode-q">Quality</button>
          <button class="${s.mode==='targetSize'?'on':''}" aria-pressed="${s.mode==='targetSize'?'true':'false'}" id="mode-t">Target size</button>
        </div>
      </div>`;

    const qHtml = s.mode === 'quality' ? `
      <div class="s-field">
        <span class="s-label">Quality <strong id="ql">${s.quality}%</strong></span>
        <input type="range" class="slider" min="10" max="99" value="${s.quality}" id="q-range">
      </div>` : `
      <div class="s-field">
        <span class="s-label">Target (KB)</span>
        <input class="ti" type="number" value="${s.targetSizeKB}" min="1" id="q-target">
      </div>`;

    const fmtHtml = `
      <div class="s-field">
        <span class="s-label">Output format</span>
        <select class="si" id="fmt-sel">
          <option value="image/webp"  ${s.format==='image/webp'?'selected':''}>WebP</option>
          <option value="image/jpeg"  ${s.format==='image/jpeg'?'selected':''}>JPEG</option>
          <option value="image/png"   ${s.format==='image/png'?'selected':''}>PNG (lossless)</option>
          <option value="image/avif"  ${s.format==='image/avif'?'selected':''}>AVIF</option>
        </select>
      </div>`;

    const dimHtml = `
      <div class="s-field">
        <span class="s-label">Max size</span>
        <select class="si" id="dim-sel">
          <option value="0"    ${s.maxDim===0?'selected':''}>Original</option>
          <option value="4096" ${s.maxDim===4096?'selected':''}>4096 px</option>
          <option value="2048" ${s.maxDim===2048?'selected':''}>2048 px</option>
          <option value="1920" ${s.maxDim===1920?'selected':''}>1920 px</option>
          <option value="1280" ${s.maxDim===1280?'selected':''}>1280 px</option>
          <option value="800"  ${s.maxDim===800?'selected':''}>800 px</option>
        </select>
      </div>`;

    card.innerHTML = `<div class="s-row">${modeHtml}${qHtml}${fmtHtml}${dimHtml}</div>`;

    card.querySelector('#mode-q')!.addEventListener('click', () => { s.mode='quality'; renderSettings(); });
    card.querySelector('#mode-t')!.addEventListener('click', () => { s.mode='targetSize'; renderSettings(); });
    card.querySelector('#q-range')?.addEventListener('input', e => {
      s.quality = +(e.target as HTMLInputElement).value;
      card.querySelector('#ql')!.textContent = s.quality + '%';
    });
    card.querySelector('#q-target')?.addEventListener('change', e => { s.targetSizeKB = +(e.target as HTMLInputElement).value || 200; });
    card.querySelector('#fmt-sel')!.addEventListener('change', e => { s.format = (e.target as HTMLSelectElement).value as ImageFormat; renderSettings(); });
    card.querySelector('#dim-sel')!.addEventListener('change', e => { s.maxDim = +(e.target as HTMLSelectElement).value; });

    // Compat warning
    if (fmtMismatch()) {
      const ef = effectiveFmt().split('/')[1].toUpperCase();
      const rf = s.format.split('/')[1].toUpperCase();
      warnEl.textContent = `⚠ Your browser doesn't support ${rf} encoding — using ${ef} instead.`;
      warnEl.style.display = 'block';
    } else { warnEl.style.display = 'none'; }
  }

  function render() {
    registerBusyCheck(() => s.files.some(f => f.status === 'compressing') || aiBusy);
    (dzWrap as any).setHasFiles(s.files.length > 0);
    renderAiBar();
    renderBatchBar(batchEl, s.files, compressAll, downloadAll, clearAll);
    listEl.innerHTML = '';
    s.files.forEach(f => listEl.appendChild(renderFileCard(f, cbs)));
    import('../lib/motion').then(({ revealStagger }) => {
      revealStagger(listEl.querySelectorAll('.file-card'));
    }).catch(() => { /* motion is a progressive enhancement — cards still render without it */ });
  }

  renderSettings();
  render();
}
