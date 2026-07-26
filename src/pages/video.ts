import { registerBusyCheck } from '../main';
import { uid, getOutputExtension } from '../lib/types';
import type { FileEntry, CompressOptions, VideoCodec } from '../lib/types';
import { compressVideo } from '../lib/compressVideo';
import { createDropZone, renderFileCard, patchFileCard, renderBatchBar } from '../components';
import { ffHasMT } from '../lib/ffmpeg';
import { toast } from '../toast';
import { videoStore } from '../store';

export function mountVideo(root: HTMLElement) {
  // ── State — persisted in videoStore across navigations ──────
  const s = videoStore;

  const supportsTenBit = () => s.codec === 'h265' || s.codec === 'av1';

  function buildOptions(): CompressOptions {
    const o: CompressOptions = { videoCodec: s.codec, videoPreset: s.preset };
    if (s.mode === 'crf')        o.quality     = s.crfQuality / 100;
    if (s.mode === 'bitrate')    o.videoBitrate = s.bitrate * 1000;
    if (s.mode === 'targetSize') o.targetSizeKB = s.targetSizeMB * 1024;
    if (s.maxWidth > 0)          o.maxWidth     = s.maxWidth;
    if (s.fps > 0)               o.fps          = s.fps;
    if (s.tenBit && supportsTenBit()) o.videoTenBit = true;
    if (s.proxy)                 o.videoProxy   = true;
    if (s.mode !== 'crf' && s.twoPass) o.videoTwoPass = true;
    if (s.audioPassthrough)      o.audioPassthrough = true;
    if (s.audioTrackMode === 'all') o.audioTrackMode = 'all';
    if (s.audioDownmix && !s.audioPassthrough) o.audioDownmixStereo = true;
    if (s.subtitleMode === 'all') o.subtitleMode = 'all';
    return o;
  }

  function applyProxyPreset() {
    s.codec    = 'h264';
    s.preset   = 'ultrafast';
    s.maxWidth = s.maxWidth || 960;
    s.fps      = s.fps || 24;
    s.proxy    = true;
    renderSettings();
  }

  // ── Per-file settings editing ────────────────────────────────
  // Every queued file carries its own `options` snapshot (taken from the
  // panel at the moment it was added). Clicking the ✎ button on a file
  // card loads that snapshot back into the panel for editing; Save writes
  // it back to that one file only — other queued files are untouched.
  // This is what makes the queue a real "different settings per file"
  // batch queue rather than one shared config applied to everything.
  function loadOptionsIntoPanel(o: CompressOptions) {
    s.mode = o.targetSizeKB ? 'targetSize' : o.videoBitrate ? 'bitrate' : 'crf';
    if (o.quality != null)      s.crfQuality   = Math.round(o.quality * 100);
    if (o.videoBitrate != null) s.bitrate      = Math.round(o.videoBitrate / 1000);
    if (o.targetSizeKB != null) s.targetSizeMB = +(o.targetSizeKB / 1024).toFixed(2);
    s.codec  = o.videoCodec ?? 'h264';
    s.preset = o.videoPreset ?? 'fast';
    s.maxWidth = o.maxWidth ?? 0;
    s.fps      = o.fps ?? 0;
    s.tenBit   = !!o.videoTenBit;
    s.proxy    = !!o.videoProxy;
    s.twoPass  = !!o.videoTwoPass;
    s.audioPassthrough = !!o.audioPassthrough;
    s.audioTrackMode   = o.audioTrackMode === 'all' ? 'all' : 'first';
    s.audioDownmix     = !!o.audioDownmixStereo;
    s.subtitleMode      = o.subtitleMode === 'all' ? 'all' : 'none';
  }

  function editEntry(entry: FileEntry) {
    s.editingId = entry.id;
    loadOptionsIntoPanel(entry.options);
    renderSettings();
    root.querySelector('#video-settings')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function saveEditedEntry() {
    const entry = s.files.find(f => f.id === s.editingId);
    if (entry) { entry.options = buildOptions(); toast(`Settings saved for ${entry.file.name}`, 'success'); }
    s.editingId = null;
    renderSettings();
  }

  function cancelEdit() { s.editingId = null; renderSettings(); }

  function addFiles(fs: File[]) {
    const valid = fs.filter(f => f.type.startsWith('video/') || /\.(mp4|webm|mov|avi|mkv|m4v|flv|wmv|ogv|3gp)$/i.test(f.name));
    if (!valid.length) { toast('No video files found', 'error'); return; }
    s.files = [...s.files, ...valid.map(f => ({
      id: uid(), file: f, type: 'video' as const,
      status: 'idle' as const, progress: 0, options: buildOptions(),
    }))];
    render();
  }

  async function compressEntry(entry: FileEntry) {
    // NOTE: previously this reassigned `entry.options = buildOptions()`
    // here, which threw away each file's own snapshot and silently made
    // every queued file compress with whatever the panel happened to show
    // at the moment "Compress" was clicked — the queue only *looked* like
    // it supported per-file settings. Now it uses the entry's own options,
    // which either came from the panel at add-time or from an explicit
    // per-file edit (see editEntry/saveEditedEntry above).
    entry.status = 'compressing'; entry.progress = 0;
    patchFileCard(entry, cbs);
    try {
      entry.result = await compressVideo(entry.file, entry.options, p => {
        entry.progress = p; patchFileCard(entry, cbs);
      });
      entry.status = 'done';
    } catch (e: any) {
      entry.error = e.message ?? 'Video compression failed';
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

  // BUG FIX: this used to fire every entry's compressEntry() from inside
  // .forEach() without awaiting any of them — since every video job goes
  // through the same shared FFmpeg.wasm singleton and writes to fixed
  // in-memory filenames (vin.*/vout.*), running two jobs "concurrently"
  // actually raced on the same virtual files and could silently corrupt
  // or cross-deliver output between queued files. Processing the queue
  // strictly one file at a time is both correct and no slower — FFmpeg.wasm
  // was never actually running two encodes in parallel anyway.
  async function compressAll() {
    for (const f of s.files) {
      if (f.status === 'idle' || f.status === 'error') await compressEntry(f);
    }
  }
  function downloadAll()  { s.files.filter(f => f.status === 'done').forEach(downloadEntry); }
  function clearAll()     { s.files = []; s.editingId = null; render(); }
  const cbs = {
    onCompress: compressEntry,
    onDownload: downloadEntry,
    onRemove: (id: string) => { s.files = s.files.filter(f => f.id !== id); if (s.editingId === id) s.editingId = null; render(); },
    onEdit: editEntry,
  };

  let batchEl!: HTMLElement; let listEl!: HTMLElement; let dzWrap!: ReturnType<typeof createDropZone>;

  root.innerHTML = `
    <div class="tool-wrap">
      <span class="back-link" data-nav="">← Home</span>
      <div class="page-header">
        <div class="header-top">
          <span class="badge video">🎬 Video</span>
          <h1 class="page-title">Video Compressor</h1>
        </div>
        <p class="page-sub">FFmpeg.wasm (WASM${ffHasMT() ? ' MT' : ''}) · MediaRecorder — auto-selected per browser</p>
        <div class="caps-row">
          <span class="cap browser">${navigator.userAgent.includes('Chrome') ? 'Chrome' : navigator.userAgent.includes('Firefox') ? 'Firefox' : 'Safari'}</span>
          <span class="cap primary">FFmpeg.wasm</span>
          <span class="cap">MediaRecorder</span>
          ${ffHasMT() ? '<span class="cap">SharedArrayBuffer ✓</span>' : '<span class="cap">No COOP (ST mode)</span>'}
        </div>
      </div>
      <div class="settings-card" id="video-settings"></div>
      <div id="dz-mount"></div>
      <div class="batch-bar" id="batch-bar" style="display:none"></div>
      <div class="file-list" id="file-list"></div>
    </div>
  `;

  batchEl = root.querySelector('#batch-bar')!;
  listEl  = root.querySelector('#file-list')!;
  dzWrap  = createDropZone({ accept: 'video/*', icon: '🎬', title: 'Drop video files here', subtitle: 'MP4 · WebM · MOV · AVI · MKV', onFiles: addFiles });
  root.querySelector('#dz-mount')!.appendChild(dzWrap);

  function renderSettings() {
    const card = root.querySelector('#video-settings')!;
    const crf  = Math.round(18 + (1 - s.crfQuality / 100) * 17);
    const editingEntry = s.editingId ? s.files.find(f => f.id === s.editingId) : null;
    const twoPassEligible = s.mode !== 'crf';
    const forcedMkv = s.audioTrackMode === 'all' || s.subtitleMode === 'all';
    card.innerHTML = `
      ${editingEntry ? `
      <div class="edit-banner">
        <span>✎ Editing settings for <strong>${escHtml(editingEntry.file.name)}</strong> — other queued files are unaffected</span>
        <div class="edit-banner-actions">
          <button class="fc-btn primary" id="edit-save">Save to this file</button>
          <button class="fc-btn" id="edit-cancel">Cancel</button>
        </div>
      </div>` : `
      <p class="page-sub" style="margin:0 0 .6rem">These settings apply to files as you add them to the queue. Use ✎ on a queued file to give it its own settings.</p>
      `}
      <div class="s-row">
        <div class="s-field">
          <span class="s-label">Mode</span>
          <div class="seg" role="group" aria-label="Compression mode">
            <button class="${s.mode==='crf'?'on':''}" aria-pressed="${s.mode==='crf'?'true':'false'}" id="m-crf">Quality (CRF)</button>
            <button class="${s.mode==='bitrate'?'on':''}" aria-pressed="${s.mode==='bitrate'?'true':'false'}" id="m-br">Bitrate</button>
            <button class="${s.mode==='targetSize'?'on':''}" aria-pressed="${s.mode==='targetSize'?'true':'false'}" id="m-ts">Target size</button>
          </div>
        </div>
        ${s.mode==='crf'?`<div class="s-field"><span class="s-label">Quality <strong id="crf-lbl">${s.crfQuality}%</strong> <em>CRF ${crf}</em></span><input type="range" class="slider" min="1" max="99" value="${s.crfQuality}" id="crf-range"></div>`:''}
        ${s.mode==='bitrate'?`<div class="s-field"><span class="s-label">Bitrate (kbps)</span><input class="ti" type="number" value="${s.bitrate}" id="br-input"></div>`:''}
        ${s.mode==='targetSize'?`<div class="s-field"><span class="s-label">Target size (MB)</span><input class="ti" type="number" value="${s.targetSizeMB||''}" step="0.1" id="ts-input"></div>`:''}
        <div class="s-field">
          <span class="s-label">Codec</span>
          <select class="si" id="codec-sel">
            <option value="h264" ${s.codec==='h264'?'selected':''}>H.264 (MP4)</option>
            <option value="h265" ${s.codec==='h265'?'selected':''}>H.265 (HEVC)</option>
            <option value="vp9"  ${s.codec==='vp9'?'selected':''}>VP9 (WebM)</option>
            <option value="vp8"  ${s.codec==='vp8'?'selected':''}>VP8 (WebM)</option>
            <option value="av1"  ${s.codec==='av1'?'selected':''}>AV1</option>
          </select>
        </div>
        <div class="s-field">
          <span class="s-label">Preset</span>
          <select class="si" id="preset-sel">
            ${['ultrafast','fast','medium','slow'].map(p=>`<option value="${p}" ${s.preset===p?'selected':''}>${p}</option>`).join('')}
          </select>
        </div>
        <div class="s-field">
          <span class="s-label">Max width</span>
          <select class="si" id="maxw-sel">
            <option value="0" ${s.maxWidth===0?'selected':''}>Original</option>
            ${[3840,1920,1280,854,640].map(w=>`<option value="${w}" ${s.maxWidth===w?'selected':''}>${w}px</option>`).join('')}
          </select>
        </div>
        <div class="s-field">
          <span class="s-label">FPS</span>
          <select class="si" id="fps-sel">
            <option value="0" ${s.fps===0?'selected':''}>Original</option>
            ${[60,30,25,24,15].map(f=>`<option value="${f}" ${s.fps===f?'selected':''}>${f}</option>`).join('')}
          </select>
        </div>
        ${supportsTenBit() ? `
        <div class="s-field">
          <span class="s-label">Bit depth</span>
          <div class="seg" role="group" aria-label="Bit depth">
            <button class="${!s.tenBit?'on':''}" aria-pressed="${!s.tenBit?'true':'false'}" id="bit-8">8-bit</button>
            <button class="${s.tenBit?'on':''}" aria-pressed="${s.tenBit?'true':'false'}" id="bit-10">10-bit</button>
          </div>
        </div>` : ''}
        ${twoPassEligible ? `
        <div class="s-field">
          <span class="s-label">2-pass <em>slower, more accurate bitrate targeting</em></span>
          <div class="seg" role="group" aria-label="Two-pass encoding">
            <button class="${!s.twoPass?'on':''}" aria-pressed="${!s.twoPass?'true':'false'}" id="tp-off">Off</button>
            <button class="${s.twoPass?'on':''}" aria-pressed="${s.twoPass?'true':'false'}" id="tp-on">On</button>
          </div>
        </div>` : ''}
        <div class="s-field full">
          <span class="s-label">Edit proxy <em>all-intra, no B-frames — fast NLE scrubbing, not for delivery</em></span>
          <div class="seg" role="group" aria-label="Edit proxy mode">
            <button class="${!s.proxy?'on':''}" aria-pressed="${!s.proxy?'true':'false'}" id="proxy-off">Off</button>
            <button class="${s.proxy?'on':''}" aria-pressed="${s.proxy?'true':'false'}" id="proxy-on">On</button>
          </div>
          <button class="link-btn" id="proxy-quick" type="button" style="margin-top:.4rem">⚡ Apply proxy quick-preset (H.264 · 960px · 24fps · ultrafast)</button>
        </div>

        <div class="s-field full" style="border-top:1px solid var(--border);padding-top:.8rem;margin-top:.2rem">
          <span class="s-label">Audio tracks <em>which audio streams to keep in the output</em></span>
          <div class="seg" role="group" aria-label="Audio track mode">
            <button class="${s.audioTrackMode==='first'?'on':''}" aria-pressed="${s.audioTrackMode==='first'?'true':'false'}" id="at-first">Default track only</button>
            <button class="${s.audioTrackMode==='all'?'on':''}" aria-pressed="${s.audioTrackMode==='all'?'true':'false'}" id="at-all">Keep all tracks</button>
          </div>
        </div>
        <div class="s-field">
          <span class="s-label">Audio handling</span>
          <div class="seg" role="group" aria-label="Audio handling">
            <button class="${!s.audioPassthrough?'on':''}" aria-pressed="${!s.audioPassthrough?'true':'false'}" id="ap-off">Transcode</button>
            <button class="${s.audioPassthrough?'on':''}" aria-pressed="${s.audioPassthrough?'true':'false'}" id="ap-on">Passthrough</button>
          </div>
        </div>
        ${!s.audioPassthrough ? `
        <div class="s-field">
          <span class="s-label">Downmix</span>
          <div class="seg" role="group" aria-label="Downmix to stereo">
            <button class="${!s.audioDownmix?'on':''}" aria-pressed="${!s.audioDownmix?'true':'false'}" id="dm-off">Keep channels</button>
            <button class="${s.audioDownmix?'on':''}" aria-pressed="${s.audioDownmix?'true':'false'}" id="dm-on">Stereo</button>
          </div>
        </div>` : ''}
        <div class="s-field full">
          <span class="s-label">Subtitles <em>passthrough only — no burn-in rendering</em></span>
          <div class="seg" role="group" aria-label="Subtitle mode">
            <button class="${s.subtitleMode==='none'?'on':''}" aria-pressed="${s.subtitleMode==='none'?'true':'false'}" id="sub-none">Drop</button>
            <button class="${s.subtitleMode==='all'?'on':''}" aria-pressed="${s.subtitleMode==='all'?'true':'false'}" id="sub-all">Keep all (copy)</button>
          </div>
        </div>
        ${forcedMkv ? `<div class="s-field full"><span class="s-label" style="color:var(--text-4)">ℹ Output will be .mkv — needed to carry multiple audio tracks and/or subtitles</span></div>` : ''}
      </div>`;
    card.querySelector('#m-crf')?.addEventListener('click',    () => { s.mode='crf'; renderSettings(); });
    card.querySelector('#m-br')?.addEventListener('click',     () => { s.mode='bitrate'; renderSettings(); });
    card.querySelector('#m-ts')?.addEventListener('click',     () => { s.mode='targetSize'; renderSettings(); });
    card.querySelector('#crf-range')?.addEventListener('input', e => { s.crfQuality=+(e.target as HTMLInputElement).value; const c=Math.round(18+(1-s.crfQuality/100)*17); card.querySelector('#crf-lbl')!.innerHTML=`${s.crfQuality}% <em>CRF ${c}</em>`; });
    card.querySelector('#br-input')?.addEventListener('change', e => { s.bitrate=+(e.target as HTMLInputElement).value||2000; });
    card.querySelector('#ts-input')?.addEventListener('change', e => { s.targetSizeMB=+(e.target as HTMLInputElement).value||0; });
    card.querySelector('#codec-sel')?.addEventListener('change', e => { s.codec=(e.target as HTMLSelectElement).value as VideoCodec; renderSettings(); });
    card.querySelector('#preset-sel')?.addEventListener('change', e => { s.preset=(e.target as HTMLSelectElement).value as typeof s.preset; });
    card.querySelector('#maxw-sel')?.addEventListener('change',  e => { s.maxWidth=+(e.target as HTMLSelectElement).value; });
    card.querySelector('#fps-sel')?.addEventListener('change',   e => { s.fps=+(e.target as HTMLSelectElement).value; });
    card.querySelector('#bit-8')?.addEventListener('click',  () => { s.tenBit=false; renderSettings(); });
    card.querySelector('#bit-10')?.addEventListener('click', () => { s.tenBit=true;  renderSettings(); });
    card.querySelector('#tp-off')?.addEventListener('click', () => { s.twoPass=false; renderSettings(); });
    card.querySelector('#tp-on')?.addEventListener('click',  () => { s.twoPass=true;  renderSettings(); });
    card.querySelector('#proxy-off')?.addEventListener('click', () => { s.proxy=false; renderSettings(); });
    card.querySelector('#proxy-on')?.addEventListener('click',  () => { s.proxy=true;  renderSettings(); });
    card.querySelector('#proxy-quick')?.addEventListener('click', () => applyProxyPreset());
    card.querySelector('#at-first')?.addEventListener('click', () => { s.audioTrackMode='first'; renderSettings(); });
    card.querySelector('#at-all')?.addEventListener('click',   () => { s.audioTrackMode='all';   renderSettings(); });
    card.querySelector('#ap-off')?.addEventListener('click', () => { s.audioPassthrough=false; renderSettings(); });
    card.querySelector('#ap-on')?.addEventListener('click',  () => { s.audioPassthrough=true;  renderSettings(); });
    card.querySelector('#dm-off')?.addEventListener('click', () => { s.audioDownmix=false; renderSettings(); });
    card.querySelector('#dm-on')?.addEventListener('click',  () => { s.audioDownmix=true;  renderSettings(); });
    card.querySelector('#sub-none')?.addEventListener('click', () => { s.subtitleMode='none'; renderSettings(); });
    card.querySelector('#sub-all')?.addEventListener('click',  () => { s.subtitleMode='all';  renderSettings(); });
    card.querySelector('#edit-save')?.addEventListener('click',   () => saveEditedEntry());
    card.querySelector('#edit-cancel')?.addEventListener('click', () => cancelEdit());
  }

  function escHtml(str: string) {
    return str.replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]!));
  }

  function render() {
    registerBusyCheck(() => s.files.some(f => f.status === 'compressing'));
    renderSettings();
    (dzWrap as any).setHasFiles(s.files.length > 0);
    renderBatchBar(batchEl, s.files, compressAll, downloadAll, clearAll);
    listEl.innerHTML = '';
    s.files.forEach(f => listEl.appendChild(renderFileCard(f, cbs)));
  }

  render();
}
