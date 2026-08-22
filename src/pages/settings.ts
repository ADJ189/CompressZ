import { getSettings, updateSettings, resetSettings, GPU_CAPABLE } from '../lib/settings';
import type { AppSettings, GpuSettings } from '../lib/settings';
import { gpuAvailable, hasWebGL2 } from '../lib/gpu';
import type { ImageFormat, VideoCodec, AudioFormat, PdfLevel } from '../lib/types';
import { toast } from '../toast';

const GPU_ENGINES: { id: keyof GpuSettings; icon: string; name: string; desc: string }[] = [
  { id: 'images', icon: '🖼️', name: 'Images',
    desc: 'WebGL2 hardware-filtered resize when downscaling, plus a GPU-composited canvas for encoding.' },
  { id: 'pdf', icon: '📄', name: 'PDF',
    desc: 'GPU-composited canvas for page rasterisation, used by both the PDF compressor and Convert’s PDF ⇄ Images.' },
  { id: 'ocr', icon: '🔍', name: 'OCR',
    desc: 'GPU-composited canvas for rasterising pages before they’re handed to the OCR engine.' },
  { id: 'video', icon: '🎬', name: 'Video',
    desc: 'Applies to the MediaRecorder fallback path only. Primary encoding runs on FFmpeg.wasm, which is CPU/WASM — browsers don’t expose a GPU encode path to WebAssembly.' },
  { id: 'gif', icon: '🎞️', name: 'GIF',
    desc: 'Not applicable — GIF compression runs entirely through FFmpeg.wasm (CPU/WASM) with no canvas step to accelerate.' },
  { id: 'audio', icon: '🎵', name: 'Audio',
    desc: 'Not applicable — Audio compression runs entirely through FFmpeg.wasm (CPU/WASM) with no canvas step to accelerate.' },
];

export function mountSettings(root: HTMLElement) {
  let groupsEl!: HTMLElement;

  root.innerHTML = `
    <div class="tool-wrap">
      <span class="back-link" data-nav="">← Home</span>
      <div class="page-header">
        <div class="header-top">
          <span class="badge priv">⚙️ Settings</span>
          <h1 class="page-title">Settings</h1>
        </div>
        <p class="page-sub">
          GPU acceleration and the starting defaults for every compression engine. Everything here is stored
          only in this browser and applies the next time you open a tool.
        </p>
        <div id="gpu-cap-badge"></div>
      </div>

      <div class="settings-groups" id="settings-groups"></div>
    </div>
  `;

  root.querySelector('#gpu-cap-badge')!.innerHTML = gpuAvailable()
    ? `<span class="settings-gpu-badge"><span class="dot"></span>GPU available in this browser${hasWebGL2() ? ' · WebGL2' : ''}</span>`
    : `<span class="settings-gpu-badge off"><span class="dot"></span>No GPU-eligible canvas API detected — toggles below have no effect</span>`;

  groupsEl = root.querySelector('#settings-groups')!;

  function render() {
    const st = getSettings();
    groupsEl.innerHTML = '';
    groupsEl.appendChild(gpuGroup(st));
    groupsEl.appendChild(imagesGroup(st));
    groupsEl.appendChild(pdfGroup(st));
    groupsEl.appendChild(videoGroup(st));
    groupsEl.appendChild(audioGroup(st));
    groupsEl.appendChild(gifGroup(st));
    groupsEl.appendChild(ocrGroup(st));
    groupsEl.appendChild(resetRow());
  }

  // ── GPU Acceleration ──────────────────────────────────────────
  function gpuGroup(st: AppSettings): HTMLElement {
    const wrap = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'settings-group-title';
    title.textContent = 'GPU Acceleration';
    wrap.appendChild(title);

    const card = document.createElement('div');
    card.className = 'settings-card';
    GPU_ENGINES.forEach(eng => {
      const capable = GPU_CAPABLE.includes(eng.id);
      const on = st.gpu[eng.id];
      const field = document.createElement('div');
      field.className = 's-field full' + (capable && gpuAvailable() ? '' : ' disabled');
      field.innerHTML = `
        <div class="s-field-row">
          <div class="s-field-icon">${eng.icon}</div>
          <div class="s-field-text" style="flex:1">
            <span class="s-field-title">${eng.name}</span>
            <span class="s-field-sub">${eng.desc}</span>
          </div>
          <button type="button" class="ios-switch${on ? ' on' : ''}" role="switch" aria-checked="${on}"
            aria-label="GPU acceleration for ${eng.name}" ${capable ? '' : 'disabled'}></button>
        </div>`;
      field.querySelector('.ios-switch')?.addEventListener('click', () => {
        if (!capable) return;
        updateSettings(s => { s.gpu[eng.id] = !s.gpu[eng.id]; });
        render();
      });
      card.appendChild(field);
    });
    wrap.appendChild(card);
    return wrap;
  }

  // ── Shared row builders ───────────────────────────────────────
  function segRow(label: string, options: { id: string; label: string }[], value: string, onPick: (id: string) => void): HTMLElement {
    const field = document.createElement('div');
    field.className = 's-field full';
    field.innerHTML = `
      <span class="s-label">${label}</span>
      <div class="seg" role="group" aria-label="${label}">
        ${options.map(o => `<button type="button" data-id="${o.id}" class="${value === o.id ? 'on' : ''}" aria-pressed="${value === o.id}">${o.label}</button>`).join('')}
      </div>`;
    field.querySelectorAll('button[data-id]').forEach(btn => {
      btn.addEventListener('click', () => onPick((btn as HTMLElement).dataset.id!));
    });
    return field;
  }

  function sliderRow(label: string, min: number, max: number, value: number, unit: string, onInput: (v: number) => void): HTMLElement {
    const field = document.createElement('div');
    field.className = 's-field';
    field.innerHTML = `
      <span class="s-label">${label} <strong class="sl-val">${value}${unit}</strong></span>
      <input type="range" class="slider" min="${min}" max="${max}" value="${value}">`;
    const input = field.querySelector('input')!;
    const valEl = field.querySelector('.sl-val')!;
    input.addEventListener('input', () => {
      const v = +input.value;
      valEl.textContent = `${v}${unit}`;
      onInput(v);
    });
    return field;
  }

  function numberRow(label: string, sub: string, value: number, onInput: (v: number) => void): HTMLElement {
    const field = document.createElement('div');
    field.className = 's-field';
    field.innerHTML = `
      <span class="s-label">${label}${sub ? ` <em>${sub}</em>` : ''}</span>
      <input class="ti" type="number" min="0" value="${value}" style="width:110px">`;
    field.querySelector('input')!.addEventListener('input', e => {
      const v = Math.max(0, +(e.target as HTMLInputElement).value || 0);
      onInput(v);
    });
    return field;
  }

  function groupWrap(title: string, hint: string, fields: HTMLElement[]): HTMLElement {
    const wrap = document.createElement('div');
    const t = document.createElement('div');
    t.className = 'settings-group-title';
    t.textContent = title;
    wrap.appendChild(t);
    if (hint) {
      const h = document.createElement('div');
      h.className = 'settings-group-hint';
      h.textContent = hint;
      wrap.appendChild(h);
    }
    const card = document.createElement('div');
    card.className = 'settings-card';
    fields.forEach(f => card.appendChild(f));
    wrap.appendChild(card);
    return wrap;
  }

  // ── Per-engine default groups ────────────────────────────────
  function imagesGroup(st: AppSettings): HTMLElement {
    const e = st.engines.images;
    return groupWrap('Images — Defaults', 'Applied the next time you open the Image Compressor or Images → PDF.', [
      segRow('Output format', [
        { id: 'image/webp', label: 'WebP' }, { id: 'image/jpeg', label: 'JPEG' },
        { id: 'image/png', label: 'PNG' }, { id: 'image/avif', label: 'AVIF' },
      ], e.format, id => { updateSettings(s => { s.engines.images.format = id as ImageFormat; }); render(); }),
      sliderRow('Quality', 10, 99, e.quality, '%', v => updateSettings(s => { s.engines.images.quality = v; })),
      numberRow('Max dimension', 'px, 0 = no limit', e.maxDim, v => updateSettings(s => { s.engines.images.maxDim = v; })),
    ]);
  }

  function pdfGroup(st: AppSettings): HTMLElement {
    const e = st.engines.pdf;
    return groupWrap('PDF — Defaults', 'Applied the next time you open the PDF Compressor.', [
      segRow('Compression level', [
        { id: 'low', label: 'Low' }, { id: 'recommended', label: 'Recommended' }, { id: 'extreme', label: 'Extreme' },
      ], e.level, id => { updateSettings(s => { s.engines.pdf.level = id as PdfLevel; }); render(); }),
      sliderRow('Render scale', 1, 3, e.renderScale, '×', v => updateSettings(s => { s.engines.pdf.renderScale = v; })),
    ]);
  }

  function videoGroup(st: AppSettings): HTMLElement {
    const e = st.engines.video;
    return groupWrap('Video — Defaults', 'Applied the next time you open the Video Compressor.', [
      segRow('Codec', [
        { id: 'h264', label: 'H.264' }, { id: 'h265', label: 'H.265' }, { id: 'vp9', label: 'VP9' },
        { id: 'vp8', label: 'VP8' }, { id: 'av1', label: 'AV1' },
      ], e.codec, id => { updateSettings(s => { s.engines.video.codec = id as VideoCodec; }); render(); }),
      segRow('Encode preset', [
        { id: 'ultrafast', label: 'Ultrafast' }, { id: 'fast', label: 'Fast' },
        { id: 'medium', label: 'Medium' }, { id: 'slow', label: 'Slow' },
      ], e.preset, id => { updateSettings(s => { s.engines.video.preset = id as typeof e.preset; }); render(); }),
      sliderRow('CRF quality', 10, 99, e.crfQuality, '%', v => updateSettings(s => { s.engines.video.crfQuality = v; })),
    ]);
  }

  function audioGroup(st: AppSettings): HTMLElement {
    const e = st.engines.audio;
    return groupWrap('Audio — Defaults', 'Applied the next time you open the Audio Compressor.', [
      segRow('Format', [
        { id: 'mp3', label: 'MP3' }, { id: 'aac', label: 'AAC' }, { id: 'ogg', label: 'OGG' },
        { id: 'opus', label: 'Opus' }, { id: 'flac', label: 'FLAC' }, { id: 'wav', label: 'WAV' },
      ], e.format, id => { updateSettings(s => { s.engines.audio.format = id as AudioFormat; }); render(); }),
      sliderRow('Bitrate', 64, 320, e.bitrate, 'kbps', v => updateSettings(s => { s.engines.audio.bitrate = v; })),
    ]);
  }

  function gifGroup(st: AppSettings): HTMLElement {
    const e = st.engines.gif;
    return groupWrap('GIF — Defaults', 'Applied the next time you open the GIF Compressor.', [
      sliderRow('Quality', 10, 99, e.quality, '%', v => updateSettings(s => { s.engines.gif.quality = v; })),
    ]);
  }

  function ocrGroup(st: AppSettings): HTMLElement {
    const e = st.engines.ocr;
    return groupWrap('OCR — Defaults', 'Applied the next time you open PDF OCR.', [
      segRow('Engine', [
        { id: 'paddle', label: 'PaddleOCR-VL' }, { id: 'tesseract', label: 'Tesseract.js' },
      ], e.engine, id => { updateSettings(s => { s.engines.ocr.engine = id as typeof e.engine; }); render(); }),
      (() => {
        const field = document.createElement('div');
        field.className = 's-field';
        field.innerHTML = `
          <span class="s-label">Default language <em>Tesseract 3-letter code</em></span>
          <input class="ti" type="text" value="${e.lang}" maxlength="12" style="width:110px">`;
        field.querySelector('input')!.addEventListener('change', ev => {
          const v = (ev.target as HTMLInputElement).value.trim() || 'eng';
          updateSettings(s => { s.engines.ocr.lang = v; });
        });
        return field;
      })(),
    ]);
  }

  function resetRow(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'settings-reset-row';
    const btn = document.createElement('button');
    btn.className = 'btn-sm btn-clr';
    btn.textContent = 'Reset all to defaults';
    btn.addEventListener('click', () => {
      resetSettings();
      toast('Settings reset to defaults', 'success');
      render();
    });
    wrap.appendChild(btn);
    return wrap;
  }

  render();
}
