# Contributing to CompressZ

Thanks for taking the time to contribute. CompressZ is a privacy-first tool —
everything runs in the browser, nothing is uploaded — and contributions are
expected to keep it that way. This guide covers how to get set up, the
project's conventions, and how to submit changes.

By participating in this project you agree to abide by the
[Code of Conduct](CODE_OF_CONDUCT.md).

---

## Ground rules

- **No backend, ever.** No feature should require a server round-trip for
  user files. Everything is Canvas/WebAssembly/WebCodecs in-browser. If a
  feature seems to need a backend, it's probably out of scope — open an
  issue to discuss first.
- **No telemetry, analytics, or third-party trackers.** See
  [PRIVACY.md](PRIVACY.md) for the commitments this project has already
  made to users; don't add anything that would break them.
- **License compatibility.** CompressZ is Apache 2.0. Any dependency you add
  (npm package, CDN-loaded library, font, icon set) must use a license
  compatible with that — Apache 2.0, MIT, BSD, and OFL are all fine; GPL and
  AGPL are not. Add new third-party code to [CREDITS.md](CREDITS.md) in the
  same PR.

---

## Getting set up

```bash
git clone <your fork URL>
cd CompressZ
npm install
npm run dev        # http://localhost:5173
```

Other useful scripts:

```bash
npm run build      # production build → dist/
npm run preview    # serve the production build locally
npm run typecheck  # tsc --noEmit
```

Run `npm run typecheck` before opening a PR — CI will fail on type errors.

There's no test suite yet; manual verification in a Chromium-based browser
plus the typecheck is the current bar. If you're adding a non-trivial
feature, testing in Firefox and Safari too is appreciated (see the Browser
Compatibility table in [README.md](README.md) for feature support gaps).

---

## Project layout

```
src/
  main.ts            # app bootstrap, router mount, sidebar/topbar wiring
  router.ts           # hash-based page router
  store.ts             # persisted app/tool state (localStorage-backed)
  components.ts        # shared DOM component helpers (file cards, etc.)
  toast.ts             # toast notifications
  style.css            # single global stylesheet (no CSS modules/framework)
  lib/                  # compression/conversion engines, one file per format
    compressImage.ts, compressPdf.ts, compressVideo.ts, compressAudio.ts,
    compressGif.ts, optimizeSvg.ts, convertMedia.ts, convertOffice.ts,
    convertPdf.ts, ffmpeg.ts (FFmpeg.wasm singleton), zip.ts, types.ts
  pages/                # one file per route (images, pdf, video, audio,
    gif, ocr, convert)
```

Heavy dependencies (FFmpeg.wasm, PDF.js, pdf-lib, Tesseract.js, PaddleOCR,
mammoth.js, html2canvas) are **not** npm dependencies — they're loaded
lazily from jsDelivr at the point of use, inside the relevant `lib/*.ts`
file. This keeps the initial bundle small and means a user who only ever
compresses images never downloads the OCR or video stack. Keep this pattern
for any new heavy library rather than adding it to `package.json`.

---

## Conventions

- **TypeScript, no `any` where avoidable.** Shared types live in
  `src/lib/types.ts`.
- **Vanilla DOM, no framework.** Pages build DOM nodes directly or via the
  helpers in `components.ts`. Don't introduce React/Svelte/etc. into this
  codebase — if you want a framework-based rewrite, open an issue to discuss
  first, since it's a much bigger conversation than a single PR.
- **CSS lives in `src/style.css`.** It's intentionally one file with
  section banner comments (`═══`) rather than split per-component — search
  for the relevant banner before adding a new one. Use the existing custom
  properties (`--accent`, `--text-3`, `--r`, `--t`, etc.) instead of hardcoding
  colors, radii, or transition timings.
- **Font stack:** headings/branding use `var(--display)`, the wordmark next
  to the logo uses `var(--brand)`, body/UI text uses `var(--sans)`, code/meta
  text uses `var(--mono)`. Don't add a new `@font-face`/Google Fonts family
  for a one-off use — check whether an existing variable already fits before
  introducing a fifth (or sixth) family, since every family is a render-blocking
  network request on first load.
- **Sequential batch processing.** Queue/batch operations (`compressAll`,
  `processAll` in the page files) must `await` each file in turn rather than
  firing them concurrently — the FFmpeg.wasm and OCR engines are loaded as
  singletons and don't tolerate concurrent jobs. This has been a real bug
  before; don't reintroduce it.
- **Format-agnostic file naming.** When an engine changes container/codec
  (e.g. VP8/VP9 → `.webm`), make sure the output filename and MIME type in
  `types.ts` are updated together.

---

## Commit / PR checklist

1. `npm run typecheck` passes.
2. `npm run build` succeeds with no new warnings.
3. New third-party code (npm or CDN) is credited in `CREDITS.md` with its
   license.
4. If you touched `PRIVACY.md`-relevant behavior (anything involving data
   leaving the browser), update `PRIVACY.md` in the same PR.
5. Update `CHANGELOG.md` under an `## [Unreleased]` heading (add one if it
   doesn't exist) — a short bullet describing the change is enough.
6. Keep PRs scoped to one feature/fix. Large refactors are welcome but
   should be discussed in an issue first so they don't collide with other
   work in flight.

---

## Reporting bugs / requesting features

Open a GitHub issue. For bugs, include:

- Browser + version (compression/OCR behavior is very browser-dependent —
  see the compatibility table in the README)
- Steps to reproduce, and the file type/size involved if relevant
- Whether it reproduces in a fresh/incognito window (rules out
  extension/localStorage interference)

For security vulnerabilities, follow [SECURITY.md](SECURITY.md) instead of
opening a public issue.

---

## Questions

If something in this guide doesn't cover your case, open an issue — that's
also how this document gets improved.
