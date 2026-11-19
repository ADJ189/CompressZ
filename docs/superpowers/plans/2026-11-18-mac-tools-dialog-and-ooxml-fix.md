# Mac Tools Dialog & OOXML Fix Implementation Plan

## Overview
This plan implements:
1. XML escaping and OOXML control character stripping verification and hardening.
2. An authentic macOS-style redesign of the Tools Dialog (`ToolsDialog.svelte`) with a segmented toolbar, Spotlight search, and ranked/grouped tool cards with native macOS squircle icons.
3. An updated Universal Upload Button Pill (`UniversalUpload.svelte`) with macOS glassmorphism pill styling, quick-route metadata, and shortcut badge.
4. ActionPalette (`ActionPalette.svelte`) Mac icon upgrade.
5. Standard CSS property fixes and full verification audit across all engines and test suites.

---

## Tasks

### Task 1: Verify & Harden XML Escaping & OOXML Control Character Stripping
- **Files**:
  - `src/lib/conversions/common.ts`
  - `src/lib/conversions/pdfToWord.ts`
  - `src/lib/conversions/pdfToPpt.ts`
  - `src/lib/conversions/pdfToExcel.ts`
  - `tests/conversions.test.ts`
- **Actions**:
  1. Inspect `stripInvalidXml` and `escapeXml` in `common.ts` to guarantee regex `replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")` runs before entity replacement.
  2. Verify all OOXML builders in `pdfToWord.ts` (`buildHeadingXml`, `buildParagraphXml`, `buildListItemXml`), `pdfToPpt.ts` (`generateSlideXml`), and `pdfToExcel.ts` (`generateWorksheetXml`) pass text through `escapeXml`.
  3. Expand `tests/conversions.test.ts` to test edge-case control characters combined with XML entities and ensure 100% compliance.
  4. Run `node scripts/test.mjs` to verify test suite passes.

### Task 2: Enhance Universal Upload Button Pill
- **Files**:
  - `src/components/UniversalUpload.svelte`
- **Actions**:
  1. Update `UniversalUpload.svelte` to support a modern macOS-inspired pill variant (`pill?: boolean`).
  2. Style with glassmorphism backdrop (`backdrop-filter: blur(12px)`), macOS SF-style upload squircle/glyph, clean typography, quick-route metadata, and keyboard badge `<kbd class="cz-mac-kbd">⌘U</kbd>`.
  3. Support tactile press (`scale(0.98)`), hover illumination, and drag-and-drop elevation.
  4. Ensure WCAG AA touch targets (min 44px on coarse pointers), focus ring `:focus-visible`, and zero `transition: all`.

### Task 3: Redesign Tools Dialog into macOS Native Palette
- **Files**:
  - `src/app/ToolsDialog.svelte`
- **Actions**:
  1. Reorganize `ALL_TOOLS` into 5 clean, non-duplicated, ranked categories:
     - Rank 1: **PDF Suite & Studio** (Split, Organize, Merge, Edit & Annotate, Fill & Sign, Add Watermark, Crop Pages, Fill Forms, Redact Content, Password Protect, Repair File)
     - Rank 2: **Media Compression** (Images, PDF, Video, Audio, GIF)
     - Rank 3: **Format Conversions** (Universal Converter, PDF to Markdown, PDF to Word, PDF to Excel, PDF to PPT, Office to PDF, Images to PDF)
     - Rank 4: **AI & Neural OCR** (Searchable PDF OCR, Handwriting Recognition)
     - Rank 5: **Resources & System** (Documentation, Privacy Guarantee, About)
  2. Add macOS native window styling with subtle window header and close button.
  3. Mount the updated `UniversalUpload` pill prominently at the top of the dialog.
  4. Implement an interactive macOS segmented toolbar for 1-click category filtering (`All`, `PDF Suite`, `Compression`, `Conversions`, `AI & OCR`, `System`).
  5. Add Spotlight-style search bar with magnifying glass icon and instant filtering.
  6. Replace all raw emoji icons with native macOS squircle icons from `MacIcon.svelte`.
  7. Add badges (`Studio`, `Office`, `New`, `Advanced`, `Security`, `AI`) and hover chevron affordance.
  8. Enforce CSS floor compliance (no `transition: all`, `:focus-visible` offset ring, reduced-motion fallback).

### Task 4: Upgrade ActionPalette with Mac Squircle Icons
- **Files**:
  - `src/components/ActionPalette.svelte`
- **Actions**:
  1. Map action IDs (or action icons) to native `MacIcon` names.
  2. Replace raw emoji in `cz-palette-card-icon` with `MacIcon` squircle icons.
  3. Polish card hover and focus states to match macOS Human Interface Guidelines.

### Task 5: Fix Linter and Svelte Warnings
- **Files**:
  - `src/components/ToolCard.svelte`
- **Actions**:
  1. Add standard `line-clamp: 2;` property alongside `-webkit-line-clamp: 2;`.

### Task 6: Comprehensive Code Audit & Verification
- **Actions**:
  1. Run unit test suite: `node scripts/test.mjs` (must pass 100%).
  2. Run TypeScript checks: `node node_modules/typescript/bin/tsc --noEmit`.
  3. Run Svelte diagnostics: `node node_modules/svelte-check/bin/svelte-check --tsconfig ./tsconfig.json`.
  4. Run ESLint: `node node_modules/eslint/bin/eslint.js .`.
  5. Run production build: `node node_modules/vite/bin/vite.js build`.
