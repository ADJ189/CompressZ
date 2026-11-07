# CompressZ — Repository, Review & Deployment Standards

This document defines the strict engineering standards, manual re-review checklist, and deployment specifications for CompressZ prior to uploading to GitHub and deploying to Cloudflare Pages.

---

## 1. Toolchain & Package Manager Standard

### 1.1 Canonical Package Manager (npm)
- **`npm` is the canonical package manager** for the repository, GitHub Actions CI/CD workflows, and Cloudflare Pages deployment.
- **Node.js runtime requirements:** `^20.19.0 || ^22.13.0 || >=24`.
- **`package.json` Purity:**
  - `package.json` and `package-lock.json` must **never mention `deno`** in dependencies, devDependencies, or scripts.
  - The test script must invoke the unified Node-compatible test runner: `"test": "node scripts/test.mjs"`.
  - All CI and production scripts must execute standard npm commands (`npm ci`, `npm run dev`, `npm run build`, `npm run preview`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:e2e`).

### 1.2 Local Deno Isolation & Non-Interference
- **Purpose of Deno:** `deno.json` and `deno.lock` exist **strictly for local offline developer convenience** (e.g. running unit tests on environments where Node is not installed).
- **Git Isolation Guarantee:**
  - `deno.json`, `deno.jsonc`, `deno.lock`, and `.deno/` are explicitly added to `.gitignore`.
  - They must **never be committed or pushed to the GitHub repository**.
- **Why This Is Critical:**
  - **Cloudflare Pages Auto-Detection:** Cloudflare Pages inspects repository roots. If `deno.json` or `deno.lock` is detected in Git, Cloudflare Pages attempts to switch the build system to Deno, which breaks standard Vite build pipelines and server headers.
  - **GitHub Actions & Dependabot:** Having Deno manifests tracked in Git causes Dependabot, Linguist, and GitHub Actions to detect multiple conflicting package ecosystems.

---

## 2. Cloudflare Pages Deployment Standard

CompressZ is deployed as a static Single Page Application (SPA) on Cloudflare Pages (<https://compressz.pages.dev>).

### 2.1 Build Configuration
| Setting | Production Value |
|---|---|
| **Framework preset** | None / Vite |
| **Build command** | `npm run build` |
| **Build output directory** | `dist` |
| **Root directory** | `/` |

### 2.2 Node Version Pinning
- `.node-version` (`22.14.0`) and `.nvmrc` (`22.14.0`) are pinned in the repository root.
- Cloudflare Pages automatically detects `.node-version` to build using the pinned modern Node 22 runtime.

### 2.3 Asset Size Ceiling (≤ 24 MiB)
- Cloudflare Pages enforces a hard **25 MiB per-file limit** (`"Pages only supports files up to 25 MiB in size"`).
- `scripts/strip-oversized-assets.mjs` automatically executes post-build to delete non-essential bundled assets exceeding 24 MiB (such as unneeded asyncify ONNX runtime binaries that are loaded from CDN at runtime).
- Verify before uploading: `dist/assets/` must contain zero files ≥ 24 MiB.

### 2.4 Security & Threading Headers
- `public/_headers` configures cross-origin isolation headers for all HTML/assets:
  - `Cross-Origin-Opener-Policy: same-origin`
  - `Cross-Origin-Embedder-Policy: require-corp`
- These headers are strictly required to enable `SharedArrayBuffer` for multithreaded FFmpeg.wasm in the browser.
- `public/_redirects` provides SPA routing fallback (`/* /index.html 200`).

---

## 3. GitHub Actions CI/CD Standard

All workflows in `.github/workflows/` must follow strict stability standards:

### 3.1 Official Action Versions
- Use official, existing action versions:
  - `actions/checkout@v4` (never unreleased or invalid versions like `@v7`)
  - `actions/setup-node@v4`
  - `actions/upload-artifact@v4`

### 3.2 Workflow Definitions
1. **`ci.yml` (Lint, Typecheck, Test & Build):**
   - Installs with `npm ci --ignore-scripts`
   - Validates types: `npm run typecheck`
   - Validates lint: `npm run lint`
   - Executes unit tests: `npm test`
   - Builds production distribution: `npm run build`
2. **`e2e.yml` (Browser Integration Matrix):**
   - Matrix across 5 projects: `chromium-desktop`, `chromium-mobile`, `webkit-desktop`, `webkit-mobile`, `firefox-desktop`.
   - Browser installation: `npx --no-install playwright install --with-deps chromium webkit firefox`.
   - Artifact retention: uploads Playwright trace and screenshots on failure.
3. **`lighthouse.yml` (Audit & Quality):**
   - Runs `npx --no-install lhci autorun` against the production build.

---

## 4. Code Architecture & Quality Standards

### 4.1 UI Layer (Svelte 5)
- All user-facing components (`src/app/`, `src/routes/`, `src/components/`) use **Svelte 5 runes**:
  - `$state` for reactive local state
  - `$derived` for computed values
  - `$props` for typed component properties
  - `$effect` for lifecycle side-effects
- **Zero TSX / React:** React and `animejs` have been completely removed. No `.tsx` files in `src/components/`.

### 4.2 Processing Layer (Pure TypeScript)
- Core engines in `src/lib/` are **100% framework-independent TypeScript**.
- **Zero Svelte imports in `src/lib/`:** Ensures modules can be executed headlessly in Node and test runners without DOM or component lifecycles.
- **Dynamic CDN Loading:** Heavy runtime engines (FFmpeg.wasm, PDF.js, pdf-lib, Tesseract.js, PaddleOCR, mammoth.js, html2canvas, heic2any) are loaded lazily on demand from CDNs; they are not bundled in npm dependencies.

### 4.3 Hallmark Anti-Slop & Design Floor
All frontend styles and interactions must comply with the Hallmark floor:
1. **Token discipline:** Colors, radii, and timings must use CSS custom properties (`--bg`, `--accent`, `--r`, `--t`).
2. **No `transition: all`:** Transitions must specify explicit properties (e.g. `transition: color var(--t), background var(--t)`).
3. **Overflow protection:** `overflow-x: clip` on `html` and `body` to prevent horizontal scrolling.
4. **Accessibility focus rings:** Instant, high-contrast `:focus-visible` styling on all interactive elements.
5. **Reduced motion:** `@media (prefers-reduced-motion: reduce)` must instantly disable or collapse animations.
6. **Heading wrap:** Headings must carry `overflow-wrap: break-word`.
7. **Zero LaTeX Hallucination:** Handwritten formulas and complex PDF diagrams must be preserved as visual image crops (`assets/figures/*.png`), never hallucinated into syntactically invalid LaTeX code.

---

## 5. Privacy & Security Invariants

- **Zero Server Uploads:** Files are processed exclusively in-memory on the client via Canvas, WebAssembly, and Web platform APIs.
- **Zero Telemetry / Analytics:** No analytics scripts, no tracking pixels, and no tracking cookies.
- **ZIP Traversal Defense:** `src/lib/zip.ts` sanitizes all relative and absolute paths (`../`, `..\`, leading slashes) to prevent zip-slip directory traversal vulnerabilities.
- **SVG Sanitization:** SVG optimization strips `<script>`, inline `on*` event handlers, and `javascript:` URLs.

---

## 6. Pre-Upload Manual Re-Review Checklist

Before pushing this codebase to GitHub:

- [ ] **1. Deno Isolation:** Confirm `deno.json` and `deno.lock` are ignored by git (`git status` should not track them).
- [ ] **2. Package Manifest:** Inspect `package.json` and confirm zero mentions of `deno` in `scripts`, `dependencies`, and `devDependencies`.
- [ ] **3. Runtime Pinning:** Confirm `.node-version` and `.nvmrc` exist and specify `22.14.0`.
- [ ] **4. GitHub Workflows:** Confirm all GitHub Action steps use `@v4` (`actions/checkout@v4`, `actions/setup-node@v4`, `actions/upload-artifact@v4`).
- [ ] **5. Unit Tests:** Run `npm test` (or `node scripts/test.mjs`). All 29 unit and compliance tests must pass.
- [ ] **6. Typecheck:** Run `npm run typecheck`. Must exit with code 0.
- [ ] **7. Lint:** Run `npm run lint`. Must report 0 errors.
- [ ] **8. Production Build:** Run `npm run build`. Confirm:
  - Vite build completes cleanly.
  - `strip-oversized-assets.mjs` executes and removes assets over 24 MiB.
  - `dist/assets` has no files ≥ 24 MiB.
- [ ] **9. Public Assets:** Confirm `public/_headers` (COOP/COEP) and `public/_redirects` (SPA route fallback) exist.
- [ ] **10. Documentation Integrity:** Confirm `README.md`, `AGENTS.md`, and `CONTRIBUTING.md` accurately document npm as canonical runner and reflect all engine claims truthfully.
