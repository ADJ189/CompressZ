/**
 * gpu.ts — Shared GPU-acceleration helpers, single source of truth for
 * canvas creation across every canvas-based engine (Images, PDF, OCR,
 * Convert's PDF⇄Images, Images→PDF). Previously each of those files
 * declared its own local `makeCanvas`/`getCtx` pair — centralised here so
 * there's one implementation to audit and one place the GPU setting hooks
 * into.
 *
 * Browsers don't expose a way to run FFmpeg.wasm's video/audio codecs on
 * the GPU (the wasm build is CPU-only — there is no browser API that hands
 * a WASM module a hardware encoder), so "GPU acceleration" here means two
 * concrete, real things, both feature-detected and both gated by the
 * user's Settings → GPU Acceleration toggle (per engine):
 *
 *   1. `desynchronized: true` on the 2D context — a standard Canvas2D
 *      context attribute that lets the browser hand the canvas's backing
 *      store straight to the compositor instead of round-tripping through
 *      the main-thread paint pipeline. Real, measurable win on any page
 *      that draws to canvas repeatedly (multi-page PDF rasterisation,
 *      OCR page-by-page rendering, per-frame video preview).
 *   2. A WebGL2 texture-draw resize pass for the Image engine (and the
 *      Images→PDF tool, which shares the same downscale step) — the
 *      actual bilinear filtering for large-image downscaling runs on the
 *      GPU instead of the CPU-bound Canvas2D drawImage() scaler.
 *
 * Engines that never touch a canvas (Audio, GIF — both pure FFmpeg.wasm
 * pipelines) have a settings entry for consistency but it's a documented
 * no-op; see settings.ts's GPU_CAPABLE list.
 */
import { getSettings, type GpuSettings } from './settings';

let _webgl2: boolean | null = null;
export function hasWebGL2(): boolean {
  if (_webgl2 !== null) return _webgl2;
  try {
    const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
    _webgl2 = !!((c as any).getContext('webgl2'));
  } catch {
    _webgl2 = false;
  }
  return _webgl2;
}

export function hasOffscreenCanvas(): boolean {
  return typeof OffscreenCanvas !== 'undefined';
}

/** True if *any* GPU-eligible path is available in this browser. */
export function gpuAvailable(): boolean {
  return hasWebGL2() || hasOffscreenCanvas();
}

export function makeCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
  if (hasOffscreenCanvas()) return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/**
 * getContext('2d', ...) with the GPU compositing hint applied when the
 * given engine's toggle is on in Settings. `engine` must be a key of
 * GpuSettings — pass the tool this canvas belongs to ('images', 'pdf',
 * 'ocr', 'video'); the two WASM-only engines ('audio', 'gif') never call
 * this because they never create a canvas.
 */
export function get2D(
  c: HTMLCanvasElement | OffscreenCanvas,
  engine: keyof GpuSettings,
  opts: Record<string, unknown> = {},
): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D {
  const gpuOn = getSettings().gpu[engine];
  const ctx = (c as any).getContext('2d', gpuOn ? { desynchronized: true, ...opts } : opts);
  if (!ctx) throw new Error('Canvas 2D unavailable');
  return ctx;
}

/**
 * GPU-accelerated resize: draws `bitmap` into a WebGL2 texture and renders
 * it to (w × h) with hardware bilinear filtering, then blits the result
 * into a plain 2D canvas so callers can keep using drawImage/toBlob/
 * toDataURL as normal without knowing WebGL was involved.
 *
 * Returns null (never throws) when WebGL2 is unavailable, the setting is
 * off, or the GPU draw fails for any reason — callers always need a
 * Canvas2D fallback ready for that case.
 */
export function resizeViaWebGL(
  bitmap: ImageBitmap,
  w: number,
  h: number,
  engine: keyof GpuSettings = 'images',
  bg?: string,
): OffscreenCanvas | HTMLCanvasElement | null {
  if (!getSettings().gpu[engine] || !hasWebGL2()) return null;

  let gl: WebGL2RenderingContext | null = null;
  let tex: WebGLTexture | null = null;
  let buf: WebGLBuffer | null = null;
  let prog: WebGLProgram | null = null;

  try {
    const glCanvas = makeCanvas(w, h);
    gl = (glCanvas as any).getContext('webgl2', { antialias: false, premultipliedAlpha: false });
    if (!gl) return null;

    const vs = `#version 300 es
      in vec2 pos; out vec2 uv;
      void main() { uv = pos * 0.5 + 0.5; gl_Position = vec4(pos * vec2(1.0, -1.0), 0.0, 1.0); }`;
    const fs = `#version 300 es
      precision mediump float;
      in vec2 uv; uniform sampler2D tex; out vec4 o;
      void main() { o = texture(tex, uv); }`;

    prog = gl.createProgram()!;
    for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(sh);
        gl.deleteShader(sh);
        throw new Error(log ?? 'shader compile failed');
      }
      gl.attachShader(prog, sh);
    }
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(prog) ?? 'program link failed');
    }
    gl.useProgram(prog);

    buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap as any);

    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    const out = makeCanvas(w, h);
    const ctx2d = (out as any).getContext('2d')!;
    if (bg) { ctx2d.fillStyle = bg; ctx2d.fillRect(0, 0, w, h); }
    ctx2d.drawImage(glCanvas as any, 0, 0);
    return out;
  } catch (e) {
    console.warn('[gpu] WebGL2 resize failed, falling back to Canvas2D:', e);
    return null;
  } finally {
    // WebGL objects are tied to their (short-lived, GC'd) context, but
    // free them explicitly rather than waiting on GC pressure — this runs
    // once per file in a batch job, not once per frame.
    if (gl) {
      if (tex)  gl.deleteTexture(tex);
      if (buf)  gl.deleteBuffer(buf);
      if (prog) gl.deleteProgram(prog);
    }
  }
}
