# Comprehensive UI Themes, CloudConvert Modal, Engine Audit, and PR #72 Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve all code review blockers for PR #72 (`adj189/compressz#72`), add three calibrated non-washed-out color schemes (`polished`, `origin`, `blood moon`), optimize feature tags without altering the overall page layout, reorganize top tool collection headers to eliminate horizontal scrolling, upgrade the Universal Upload dialog box into a CloudConvert-style conversion hub with device-aware acceleration callouts (strictly scoped to the upload modal), conduct an exhaustive cross-engine audit for latent bugs and interworking issues, update all project documentation, and run the complete Playwright cross-browser test suite.

**Architecture:** Client-side zero-backend media utility built on Svelte 5, TypeScript 5.9, WebAssembly, WebCodecs, OffscreenCanvas, and Web Streams. Styling uses scoped modern CSS with OKLCH/hex color tokens, Hallmark anti-slop guidelines, and synchronous render-blocking theme bootstrapping (`public/earlyTheme.js`) to eliminate visual flicker.

**Tech Stack:** Svelte 5, TypeScript, Vite, Deno/Node test runners, Playwright (Chromium, Firefox, WebKit), WebCodecs, pdf-lib, @huggingface/transformers.

**Spec:** PR #72 review feedback, Hallmark Anti-AI-Slop standard, WCAG 2.2 AA/AAA contrast guidelines, CloudConvert universal upload conversion workflow, and CompressZ engine invariants (`AGENTS.md`).

## Global Constraints

- Zero uploads, zero server analytics, 100% client-side offline execution.
- Scope boundary: DO NOT redesign the entire application UI; focus changes on the Universal Upload dialog modal (`ActionPalette.svelte`), feature tags, color scheme tokens, and tool header wrapping.
- Retain 0 ESLint errors and 100% clean TypeScript and Svelte checks (`tsc --noEmit` and `svelte-check`).
- Output bundle assets must remain strictly under Cloudflare Pages' 25 MiB ceiling.
- Strict CSP compliance in `public/_headers` (no `'unsafe-inline'` in `script-src`).
- All color schemes must maintain WCAG AA contrast ($\ge 4.5:1$) for standard text and WCAG AAA ($\ge 7:1$) for status/notification messages.
- Work strictly on branch `patches-done` targeting `main`.

## Review Focus

1. **Flate/ASCIIHex Stream Decode Failure:** Verify that truncated, malformed, or decompression-failing PDF streams signal `null`, causing `structuralCompress` to mark the page scan `incomplete` and refuse to downsample unverified image placements.
2. **AI Sort Queue Mutation:** Verify that adding, removing, or clearing files while async image classification runs never drops new files, restores removed files, or crashes on an empty queue.
3. **SVG Entity Resolution & Safety:** Verify that internal DTD entities resolve cleanly into valid XML while undefined entities, external XXE references, and quadratic expansion attempts are safely neutralized or rejected.
4. **Color Scheme Contrast & Readability:** Verify that in all 3 color schemes (`polished`, `origin`, `blood moon`) across light and dark modes, notification toasts and status messages are crisp, prominent, and completely readable without light-on-light or dark-on-dark text.
5. **Universal Upload Modal Scoping:** Verify that only the Universal Upload modal (`ActionPalette.svelte`) adopts CloudConvert's conversion matrix and device optimization callout, preserving the existing workbench layout.
6. **Cross-Engine Interworking & Memory:** Verify that all engine fallback chains (WebCodecs $\to$ FFmpeg $\to$ MediaRecorder, WebGL $\to$ Canvas2D, WebGPU $\to$ WASM) handle rejections cleanly and revoke object URLs without memory leaks.
7. **Playwright Cross-Browser Verification:** Verify that all 585 Playwright tests across Chromium, WebKit, and Firefox (desktop and mobile) execute cleanly without timeout flakes or profile errors.

---

### Task 1: Fix Core PDF Scanner Stream Decode & ToolsDialog dvh (PR #72 Blockers)

**Files:**
- Modify: `src/lib/compressPdf.ts:433-472, 580-615`
- Modify: `src/app/ToolsDialog.svelte:740-750`
- Test: `tests/compressPdf.test.ts`

**Interfaces:**
- `decompressFlate(bytes: Uint8Array, maxBytes?: number): Promise<Uint8Array | null>`
- `decodeAsciiHex(bytes: Uint8Array, maxBytes: number): Uint8Array | null`

- [ ] **Step 1: Write failing unit tests for malformed ASCIIHex and failed Flate decompression**
  In `tests/compressPdf.test.ts`:
  - Test that `decodeAsciiHex` with invalid characters (e.g. `48656c6c6fZZ>`) returns `null`.
  - Test that `decodeAsciiHex` on non-empty data without a terminating `>` returns `null`.
  - Test that `decompressFlate` on corrupted non-zlib payload returns `null` instead of echoing input.
  - Test that `structuralCompress` on a PDF containing corrupted streams marks the page scan `incomplete: true` and skips downsampling images on that page.

- [ ] **Step 2: Run tests to verify failures**
  Run: `npm test`
  Expected: FAIL on new decoder failure assertions.

- [ ] **Step 3: Implement stream decoder error handling in `src/lib/compressPdf.ts`**
  - In `decodeAsciiHex()`, enforce ISO 32000-1 §7.4.2: reject non-hexadecimal non-whitespace characters and unclosed non-empty streams by returning `null`.
  - In `decompressFlate()`, return `null` when web or node decompression streams fail, rather than returning `bytes.subarray(0, maxBytes)`.
  - In `structuralCompress()`, propagate `null` to `failedOrUnsupported = true` and `incomplete = true` on the page scan.

- [ ] **Step 4: Fix CSS declaration ordering in `src/app/ToolsDialog.svelte`**
  - In `@media (max-width: 520px)`, order declarations with fallback first:
    ```css
    max-height: calc(100vh - 24px);
    max-height: 92dvh;
    ```

- [ ] **Step 5: Run tests and typecheck**
  Run: `npm test && npm run typecheck`
  Expected: PASS

- [ ] **Step 6: Commit**
  ```bash
  git commit -m "fix(pdf): propagate stream decode failures to incomplete scan and fix mobile dialog dvh"
  ```

---

### Task 2: Fix AI Sort Queue Mutation, auto Tier, and Gating in `ImagesToPdf.svelte`

**Files:**
- Modify: `src/routes/ImagesToPdf.svelte:160-185, 380-400`
- Test: `tests/options.test.ts`

**Interfaces:**
- Consumes: `resolvedAiModelTier(settings: AppSettings): AiModelTier` from `src/lib/settings`
- Consumes: `smartAnalyze(files: File[], tier: AiModelTier): Promise<SmartAnalysis[]>` from `src/lib/aiEngine`
- Consumes: `sortByPredictedLabel(files: File[], analysis: SmartAnalysis[]): File[]` from `src/lib/aiEngine`

- [ ] **Step 1: Write unit tests for queue reconciliation and AI tier resolution**
  In `tests/options.test.ts`:
  - Test `resolvedAiModelTier` returns `"efficient"` or `"powerful"` when settings tier is `"auto"`.
  - Test reconciliation logic: given initial queue `[A, B]`, sorted order `[B, A]`, and current queue mutated to `[A, B, C]` (with `C` added), reconciled result is `[B, A, C]`.
  - Test reconciliation when initial files are removed or cleared during sorting.

- [ ] **Step 2: Run test to verify coverage**
  Run: `npm test`
  Expected: PASS on newly written pure logic assertions.

- [ ] **Step 3: Update `ImagesToPdf.svelte`**
  - Gate UI control: wrap `<button class="cz-btn-ai">` in `{#if settings.ai?.enabled}`.
  - In `handleAiSmartSort()`:
    - Check `const settings = getSettings(); if (!settings.ai?.enabled) return;`.
    - Resolve tier with `const tier = resolvedAiModelTier(settings);`.
    - Snapshot `const rawFiles = imagesToPdfState.files;`.
    - Await `const analyses = await smartAnalyze(rawFiles, tier);`.
    - Check `const currentFiles = imagesToPdfState.files;`. If `currentFiles.length === 0`, abort.
    - Inspect predicted labels: `const hasPredictions = analyses.some(a => a.tag?.label);`. If false, call `sortNatural()` and toast `"Could not classify images; sorted numerically"`, `"warn"`.
    - If true, compute `sortedFiles = sortByPredictedLabel(rawFiles, analyses);`.
    - Reconcile:
      ```typescript
      const currentSet = new Set(currentFiles);
      const remainingSorted = sortedFiles.filter(f => currentSet.has(f));
      const newlyAdded = currentFiles.filter(f => !rawFiles.includes(f));
      updateStore({ files: [...remainingSorted, ...newlyAdded] });
      toast("Organized images by predicted content class", "success");
      ```

- [ ] **Step 4: Run typecheck and lint**
  Run: `npm run typecheck && npm run lint`
  Expected: 0 errors.

- [ ] **Step 5: Commit**
  ```bash
  git commit -m "fix(imagesToPdf): reconcile queue edits, resolve auto tier, and gate AI sort"
  ```

---

### Task 3: Hardened SVG Entity Resolution & XML Validity

**Files:**
- Modify: `src/lib/optimizeSvg.ts:400-515`
- Test: `tests/optimizeSvg.test.ts`

**Interfaces:**
- `resolveAndStripDocTypeEntities(svg: string): string`

- [ ] **Step 1: Write tests for entity resolution and valid XML output**
  In `tests/optimizeSvg.test.ts`:
  - Test SVG with internal DTD entities: `<text>&label;</text>` produces `<text>Hello</text>` and opens with `DOMParser` without XML parsing errors.
  - Test SVG containing undefined external entity references: safe replacement or error reporting rather than leaving raw undefined entities that crash XML parsers.
  - Test SVG with entity-defined `javascript:` URI in `href`: stripped to `#`.
  - Test SVG with out-of-range numeric character reference: replaces with `\uFFFD` without throwing `RangeError`.

- [ ] **Step 2: Run test to verify behavior**
  Run: `npm test`
  Expected: PASS

- [ ] **Step 3: Implement entity resolution and XML safety in `src/lib/optimizeSvg.ts`**
  - Ensure `resolveAndStripDocTypeEntities` substitutes all defined internal entities in text and attribute values.
  - Verify that no dangling non-standard entity references remain in the output SVG that would cause XML parse failure.
  - Verify `safeCodePoint` bounds: `Number.isInteger(n) && n >= 0 && n <= 0x10FFFF` or return `\uFFFD`.

- [ ] **Step 4: Run tests and typecheck**
  Run: `npm test && npm run typecheck`
  Expected: PASS

- [ ] **Step 5: Commit**
  ```bash
  git commit -m "fix(svg): ensure optimized SVGs resolve entities and remain valid XML"
  ```

---

### Task 4: Multi-Theme Engine & Calibrated Color Schemes (`polished`, `origin`, `blood moon`)

**Files:**
- Modify: `src/lib/theme.ts`
- Modify: `src/lib/settings.ts`
- Modify: `public/earlyTheme.js`
- Modify: `src/style.css`
- Modify: `src/toast.ts`
- Modify: `src/app/SettingsDialog.svelte`
- Test: `tests/theme.test.ts`
- Test: `tests/settings.test.ts`

**Interfaces:**
- `export type ColorScheme = 'polished' | 'origin' | 'blood-moon'`
- `getColorScheme(): ColorScheme`
- `setColorScheme(scheme: ColorScheme): void`
- `public/earlyTheme.js`: synchronous execution reading both `theme` and `cz-color-scheme`.

- [ ] **Step 1: Write failing test for color scheme persistence and resolution**
  In `tests/theme.test.ts`:
  - Test default color scheme is `'polished'`.
  - Test setting and retrieving `'origin'` and `'blood-moon'`.
  - Test invalid values safely resolve to `'polished'`.

- [ ] **Step 2: Run test to verify it fails**
  Run: `npm test`
  Expected: FAIL on undefined `getColorScheme`.

- [ ] **Step 3: Implement ColorScheme support in `src/lib/theme.ts` and `public/earlyTheme.js`**
  - Add `export type ColorScheme = 'polished' | 'origin' | 'blood-moon';`.
  - Add `export const COLOR_SCHEME_KEY = 'cz-color-scheme';`.
  - Implement `getColorScheme()`, `setColorScheme(scheme: ColorScheme)`, updating `document.documentElement.setAttribute('data-color-scheme', scheme)`.
  - Update `public/earlyTheme.js` to synchronously read and set `data-color-scheme`.

- [ ] **Step 4: Define tokens in `src/style.css` for each color scheme & fix green message illegibility**
  - **`polished` (Default)**:
    - Light: `--accent: #059669; --accent-2: #10b981;`
    - Dark: `--accent: #10b981; --accent-2: #34d399; --surface: #121614; --surface2: #181f1b;`
    - **Fix green message readability**: Define `--toast-success-bg: #064e3b; --toast-success-text: #ecfdf5; --toast-success-border: #059669;` so success toasts have high contrast (> 8:1) instead of white text on lime green.
  - **`origin`**:
    - Light: `--accent: #3b5bdb; --accent-2: #4c6ef5; --brand: #3b5bdb;`
    - Dark: `--accent: #4c6ef5; --accent-2: #748ffc; --surface: #111420; --surface2: #181d2e; --border: #232a42;`
    - Messages: `--toast-success-bg: #1e3a8a; --toast-success-text: #eff6ff; --toast-success-border: #3b82f6;`
  - **`blood moon`**:
    - Light: `--accent: #be123c; --accent-2: #e11d48; --brand: #be123c;`
    - Dark: `--accent: #f43f5e; --accent-2: #fb7185; --surface: #140a0e; --surface2: #1e0e15; --border: #331722;`
    - Messages: `--toast-success-bg: #4c0519; --toast-success-text: #fff1f2; --toast-success-border: #e11d48;`

- [ ] **Step 5: Add Color Scheme Selector in `src/app/SettingsDialog.svelte`**
  - Add interactive radio/pill selector under Appearance section: "Polished (Emerald)", "Origin (Classic Blue)", "Blood Moon (Ruby Scarlet)".

- [ ] **Step 6: Run tests and typecheck**
  Run: `npm test && npm run typecheck`
  Expected: PASS

- [ ] **Step 7: Commit**
  ```bash
  git commit -m "feat(theme): add polished, origin, and blood moon color schemes with accessible status contrast"
  ```

---

### Task 5: Feature Tag Optimization & Anti-Slop Card Polish

**Files:**
- Modify: `src/routes/Home.svelte:28-140, 260-270`
- Modify: `src/components/ToolCard.svelte:45-66, 115-140, 185-198`
- Modify: `src/style.css`
- Test: `tests/hallmark.test.ts`
- Test: `tests/toolLanding.test.ts`

- [ ] **Step 1: Write test for clean tag density**
  In `tests/hallmark.test.ts`:
  - Assert that tool cards carry at most 2 curated badges/tags to prevent visual clutter and card unevenness.

- [ ] **Step 2: Curate tool tags in `src/routes/Home.svelte`**
  - Replace 5–6 pill dumps with 1–2 high-signal, purposeful tags without altering page structure:
    - Images: `["WebP · AVIF · JPEG", "✨ AI Guard"]`
    - PDF: `["Structural", "Target Size"]`
    - Video: `["WebCodecs", "Hardware"]`
    - Audio: `["FFmpeg", "Bitrate Control"]`
    - OCR: `["Tesseract 5", "Searchable PDF"]`
    - PDF to Markdown: `["Markdown", "Tables & Math"]`
    - PDF Suite: `["Edit · Annotate", "Fill & Sign"]`

- [ ] **Step 3: Refine tag styling in `ToolCard.svelte` and `Home.svelte`**
  - Apply Hallmark micro-spacing: font-size 0.72rem, font-family `--mono`, border 1px solid `var(--border)`, subtle opacity, no harsh neon gradients.

- [ ] **Step 4: Run tests and typecheck**
  Run: `npm test && npm run typecheck`
  Expected: PASS

- [ ] **Step 5: Commit**
  ```bash
  git commit -m "refactor(ui): optimize feature tags and eliminate visual card clutter"
  ```

---

### Task 6: Reorganize Top Tool Collections (Eliminating Horizontal Scrolling)

**Files:**
- Modify: `src/components/HubHeader.svelte:50-75, 137-185`
- Test: `tests/toolLanding.test.ts`

- [ ] **Step 1: Write test for responsive tool container wrapping**
  In `tests/toolLanding.test.ts`:
  - Verify `HubHeader` tool chips wrap (`flex-wrap: wrap`) and do not enforce `overflow-x: auto` without multi-row display.

- [ ] **Step 2: Update `HubHeader.svelte` tool organization**
  - Replace `flex-wrap: nowrap; overflow-x: auto;` with responsive wrapped flexbox:
    ```css
    .cz-hub-tools-row {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      min-width: 0;
      max-width: 100%;
    }
    ```
  - All tools for the active hub are visible at a glance without horizontal scrolling.

- [ ] **Step 3: Run tests and typecheck**
  Run: `npm test && npm run typecheck`
  Expected: PASS

- [ ] **Step 4: Commit**
  ```bash
  git commit -m "refactor(hub): reorganize top tool header to eliminate horizontal scrolling"
  ```

---

### Task 7: CloudConvert-Style Universal Upload Modal (Strictly Scoped)

**Files:**
- Modify: `src/lib/fileRouter.ts`
- Modify: `src/components/ActionPalette.svelte`
- Test: `tests/fileRouter.test.ts`

**Interfaces:**
- Consumes: `detectFileTypeAndActions(file: File, headerBytes?: Uint8Array): DetectionResult`
- Consumes: `resolveExecutionProfile()` for hardware acceleration reporting
- Produces: `ConversionTargetGroup[]` with format pills (e.g. `PDF -> DOCX, XLSX, PPTX, MD, Images`) and 1-click execution routing inside the modal.

- [ ] **Step 1: Write unit tests for conversion target mappings in `tests/fileRouter.test.ts`**
  - Test PDF returns document targets (`DOCX`, `XLSX`, `PPTX`), image targets (`PNG`, `JPEG`, `WebP`), structured targets (`Markdown`, `Text`), and suite actions (`Compress`, `Split`, `Sign`, `OCR`).
  - Test Video returns video formats (`MP4`, `WebM`), GIF, and audio extraction (`MP3`, `WAV`).
  - Test Image returns modern web formats (`WebP`, `AVIF`, `PNG`, `JPEG`, `PDF`).

- [ ] **Step 2: Run test to verify coverage**
  Run: `npm test`
  Expected: PASS

- [ ] **Step 3: Expand `src/lib/fileRouter.ts` with CloudConvert conversion matrices**
  - Add `export interface ConversionOption { format: string; label: string; actionId: string; route: string; description: string; }`.
  - Add conversion groups per detected category: `conversions: { [group: string]: ConversionOption[] }`.

- [ ] **Step 4: Redesign the Universal Upload modal in `ActionPalette.svelte` (CloudConvert Style)**
  - File identity header: filename, formatted file size, detected badge, preview icon.
  - **Device Optimization Callout**: "⚡ Optimized for your device: Hardware WebCodecs / WebGL2 Canvas / WASM SIMD enabled" derived from `resolveExecutionProfile()`.
  - **"Convert To..." Matrix**: Grouped format pills with active hover states.
  - **Available Tools Section**: Quick action cards for Compress, Convert, Edit/Sign, and OCR.
  - 1-click routing directly into the pre-configured workbench with the staged file.

- [ ] **Step 5: Run tests and typecheck**
  Run: `npm test && npm run typecheck`
  Expected: PASS

- [ ] **Step 6: Commit**
  ```bash
  git commit -m "feat(upload): implement CloudConvert-style universal conversion modal with device optimization"
  ```

---

### Task 8: In-Depth Engine Audit & Interworking Verification

**Files:**
- Audit & Verify: `src/lib/compressImage.ts`, `src/lib/compressPdf.ts`, `src/lib/compressVideo.ts`, `src/lib/webcodecsVideo.ts`, `src/lib/compressAudio.ts`, `src/lib/compressGif.ts`, `src/lib/ocrEngines.ts`, `src/lib/searchablePdf.ts`, `src/lib/conversions/*`, `src/lib/tar.ts`, `src/lib/zip.ts`, `src/lib/archives.ts`, `src/lib/qpdfWasm.ts`, `src/lib/fileEncryption.ts`
- Test: `tests/*.test.ts`

- [ ] **Step 1: Audit Image Engine & Memory Lifecycle**
  - Verify `OffscreenCanvas` release and WebGL2 context loss handling in `src/lib/webgl.ts` and `src/lib/compressImage.ts`.
  - Verify SSIM sampler memory bounding and `measureEncoded` cleanup.

- [ ] **Step 2: Audit Video & Audio Engine Interworking**
  - Verify WebCodecs fallback chain: capability test $\to$ Mediabunny encoder $\to$ FFmpeg.wasm fallback $\to$ MediaRecorder fallback.
  - Verify all audio tracks are preserved or cleanly rejected (never silently discarded).
  - Verify playback timers and recorder abort handlers are cleared in all branches.

- [ ] **Step 3: Audit PDF & Document Extraction Pipelines**
  - Verify PDF reading order clustering and Markdown export table formatting in `src/lib/pdfToMarkdown.ts`.
  - Verify QPDF WebAssembly execution bridge and error capture in `src/lib/qpdfWasm.ts`.
  - Verify OCR sequential batch processing and single-page rendering memory reclamation in `src/lib/ocrEngines.ts`.

- [ ] **Step 4: Audit Tar, Zip, and WebCrypto Vault Security**
  - Verify `MAX_DECOMPRESSED_BYTES` (256 MB) ceiling and path traversal guards in `tar.ts` and `archives.ts`.
  - Verify AES-256-GCM authentication tag verification and key zeroization in `src/lib/fileEncryption.ts`.

- [ ] **Step 5: Fix any latent engine bugs discovered during audit and commit**
  ```bash
  git commit -m "fix(engines): harden cross-engine error propagation and resource cleanup"
  ```

---

### Task 9: Playwright Suite & Browser Verification

**Files:**
- Verify: `playwright.config.ts`, `package.json`, browser binaries in `ms-playwright`
- Test: `e2e/smoke.spec.ts`, `e2e/conversions.spec.ts`, `e2e/engines.spec.ts`, `e2e/settings.spec.ts`

- [ ] **Step 1: Check Playwright dependencies and browser installations**
  - Verify `@playwright/test` 1.65.1.
  - Verify Chromium, Firefox, WebKit binaries in `C:\Users\user\AppData\Local\ms-playwright`.

- [ ] **Step 2: Run full Playwright test suite**
  Run: `npx playwright test`
  Expected: All 5 projects (`chromium-desktop`, `chromium-mobile`, `webkit-desktop`, `webkit-mobile`, `firefox-desktop`) PASS.

- [ ] **Step 3: Run full offline test suite**
  Run: `npm test`
  Expected: 34 suites (239+ tests) PASS.

- [ ] **Step 4: Run typecheck and lint**
  Run: `npm run typecheck && npm run lint`
  Expected: 0 errors.

- [ ] **Step 5: Run production build**
  Run: `npm run build`
  Expected: Build succeeds, no asset $\ge 25\text{ MiB}$.

---

### Task 10: Documentation Updates & Push to Branch `patches-done`

**Files:**
- Modify: `AGENTS.md`
- Modify: `README.md`
- Modify: `STANDARDS.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Update documentation files**
  - Document the three color schemes (`polished`, `origin`, `blood moon`), message contrast invariants, and storage key `cz-color-scheme` in `AGENTS.md`.
  - Document the CloudConvert-style universal upload dialog box flow in `README.md` and `AGENTS.md`.
  - Document the engine audit findings and Playwright verification in `CHANGELOG.md`.

- [ ] **Step 2: Commit all changes and push to GitHub remote**
  ```bash
  git commit -m "docs: finalize specifications, engine audit report, and PR #72 fixes"
  git push origin patches-done
  ```
