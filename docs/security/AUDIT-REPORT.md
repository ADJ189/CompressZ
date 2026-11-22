# CompressZ Comprehensive Security & Bugproofing Audit Report

**Standard:** Cloudflare 6-Phase Vulnerability Assessment & Elephant-Goldfish Model (EGM)  
**Date:** November 20, 2026  
**Status:** Audit Completed · All Confirmed Findings Remediated & Verified  
**Engine Invariants:** 100% Client-Side · Zero-Backend · Svelte 5 · WebAssembly / WebCodecs  

---

## 1. Executive Summary

A systematic code audit was performed across all 10 core processing modules of CompressZ using:
1. **Cloudflare 6-Phase Vulnerability Assessment Harness**:
   - Attack surface mapping (`coverage-ledger.json`).
   - Targeted hunting across parsers, binary extractors, and cryptographic layers.
   - Candidate-Disprover verification pass to eliminate false positives.
   - Structured JSON logging (`findings.json`).
2. **Elephant-Goldfish (EGM) Multi-Perspective Quality Audit**:
   - Invariant verification against `AGENTS.md` and `AGENT_ROADMAP.md`.
   - Adversarial stress testing for client memory leaks (`URL.revokeObjectURL`, canvas contexts, `MediaStreamTrack`s).
3. **Test-Driven Remediation (TDD)**:
   - Failing reproduction tests added to unit suites before patching.
   - Verification of 189 tests with 100% pass rate and zero TypeScript / Svelte diagnostics warnings.

---

## 2. Audited Attack Surfaces & Coverage Ledger

| Module | Source Path | Threat Category | Audit Outcome |
| :--- | :--- | :--- | :--- |
| **MOD-ARCHIVES** | `src/lib/archives.ts` | Archive Traversal & Decompression Bombs | Passed |
| **MOD-ZIP** | `src/lib/zip.ts` | Zip Slip & 16-Bit Integer Truncation | Remediated (SEC-ZIP-001) |
| **MOD-TAR** | `src/lib/tar.ts` | Entry Bounds & Long Filename Memory Leaks | Remediated (BUG-TAR-004) |
| **MOD-CRYPTO** | `src/lib/fileEncryption.ts` | PBKDF2/AES-256-GCM Cryptographic Sanity | Passed |
| **MOD-OOXML** | `src/lib/conversions/` | XML Entity Injection & CSV Formula Injection | Passed |
| **MOD-SVG** | `src/lib/optimizeSvg.ts` | Stored DOM XSS & Unquoted URI Bypasses | Remediated (SEC-SVG-002) |
| **MOD-MARKDOWN** | `src/lib/markdownPreview.ts` | HTML Injection & Table Parsing Bounds | Passed |
| **MOD-PRIVACY** | `src/lib/telemetry.ts` | Diagnostic Data Leakage & Path Scrubbing | Passed |
| **MOD-RESOURCE** | `src/lib/resourceManager.ts` | Browser Memory Pressure & Concurrency Limits | Passed |
| **MOD-MEDIA-PIPELINE** | `src/lib/compressVideo.ts` | MediaStreamTrack Leaks & Worker Lifecycles | Remediated (BUG-VID-003) |

---

## 3. Findings & Remediations

### SEC-ZIP-001: 16-Bit Entry Count Truncation in `writeZip`
* **Severity**: High (Data Integrity / Archive Corruption)
* **Location**: `src/lib/zip.ts`
* **Vulnerability**: In standard 32-bit ZIP archives, the End of Central Directory (EOCD) allocates a 16-bit unsigned integer (`setUint16`) for total entry count. When packaging $\ge 65,536$ entries without Zip64, the count truncated to $0$ (or modulo $65,536$), generating corrupted archives where unzip utilities reported 0 files.
* **Remediation**: Added a preflight safety check in `writeZip` rejecting entry counts $\ge 0\text{xFFFF}$ with a descriptive error.
* **Verification**: Verified with `tests/zip.test.ts`.

### SEC-SVG-002: Unquoted `href=javascript:`, Entity Bypass & `<foreignObject>` in `optimizeSvg`
* **Severity**: High (Stored DOM XSS)
* **Location**: `src/lib/optimizeSvg.ts`
* **Vulnerability**: The previous regex only stripped quoted (`"..."` or `'...'`) `javascript:` URLs. Unquoted attributes like `<a href=javascript:alert(1)>` and HTML entity encodings like `href="&#106;avascript:..."` bypassed the sanitizer completely. `<foreignObject>` elements were also unstripped and could contain embedded `<iframe>` tags.
* **Remediation**: Implemented entity-decoding protocol normalization across quoted and unquoted `href` and `xlink:href` attributes, and added recursive stripping of `<foreignObject>`.
* **Verification**: Verified with `tests/optimizeSvg.test.ts`.

### BUG-VID-003: Active `MediaStreamTrack` Retention in MediaRecorder Fallback
* **Severity**: Medium (Client Resource Leak)
* **Location**: `src/lib/compressVideo.ts`
* **Vulnerability**: `videoViaMediaRecorder` created `videoStream` and `combinedStream` using `canvas.captureStream()` and `vid.captureStream()`, but never stopped the tracks on completion or timeout. This kept the browser canvas capture pipeline active and leaked system media handles across sessions.
* **Remediation**: Added a track stopping loop in the `finally` block for all active tracks on both `videoStream` and `combinedStream`.
* **Verification**: Verified with full test runner.

### BUG-TAR-004: Leaked `pendingName` on Non-Regular TAR Entries
* **Severity**: Medium (Archive Corruption / Misnaming)
* **Location**: `src/lib/tar.ts`
* **Vulnerability**: In `readTar`, when a GNU long filename entry (`typeflag === 'L'`) was followed by a non-regular entry other than a directory (e.g. symlink `typeflag === '2'`), `pendingName` was not cleared. The subsequent regular file inherited the long filename intended for the skipped entry.
* **Remediation**: Added an explicit `pendingName = null` reset on all skipped non-regular entries.
* **Verification**: Verified with `tests/archives.test.ts`.

---

## 4. Verification Results

* **TypeScript Compilation**: Clean (`tsc --noEmit` exited 0).
* **Svelte Diagnostics**: 0 errors, 0 warnings (`svelte-check` clean).
* **Unit Test Suite**: 189 tests passed, 0 failed across 33 test suites.

---

## 5. Follow-up Audit — Chaos, Fuzz & Stress Pass (2026-11-22)

A second pass re-read every security-sensitive parser and added
`tests/chaos.test.ts` (28 offline tests) to keep the findings reproducible.
Each case feeds random, truncated or bit-flipped bytes and asserts only one of
two documented outcomes: a clean parse, or a descriptive `Error`. A raw
`RangeError`, hang, or unhandled promise rejection fails the suite.

### BUG-ZIP-005: Unchecked offsets in `readZip`
* **Severity**: High (DoS / confusing failure)
* **Location**: `src/lib/zip.ts`
* **Vulnerability**: The EOCD, central-directory header, local header and entry
  data offsets were read without confirming they fit the buffer. A truncated
  or crafted archive produced a raw `RangeError` from `DataView`, and entry
  data could be sliced from the wrong region.
* **Remediation**: Every offset/length is bounds-checked before use and mapped
  to a descriptive `Error` ("… points outside the archive (truncated ZIP)").
* **Verification**: `chaos/zip:*` tests, `tests/zip.test.ts`.

### BUG-TAR-006: Header checksum, metadata budget and octal overflow
* **Severity**: Medium (corrupt archive accepted / budget bypass)
* **Location**: `src/lib/tar.ts`
* **Vulnerability**: Header checksums were never verified, GNU long-name (`L`)
  and PAX (`x`/`g`) payloads did not count toward `maxTotalBytes`, a UTF-8
  filename could be cut mid-character, and an oversized octal field silently
  lost precision.
* **Remediation**: A checksum that is present must match (unsigned or signed
  sum); an empty checksum is still tolerated for historic writers and the
  existing synthetic fixtures. Metadata payloads are charged to the byte
  budget, names are truncated on a character boundary, and octal fields that
  are negative or exceed `Number.MAX_SAFE_INTEGER` are rejected.
* **Verification**: `chaos/tar:*` tests, `tests/archives.test.ts`.

### SEC-SVG-007: Named-entity URL bypass and text-node mangling
* **Severity**: High (stored XSS) / Low (output corruption)
* **Location**: `src/lib/optimizeSvg.ts`
* **Vulnerability**: Numeric entities were decoded before the `javascript:`
  check but named entities (`&colon;`, `&Tab;`, `&NewLine;`, …) were not, so
  `href="javascript&colon;alert(1)"` survived. Separately, any attribute whose
  value merely contained `display:none` (for example an `aria-label`) caused
  the element to be deleted, and decimal rounding/whitespace collapsing was
  applied to text nodes, changing rendered copy.
* **Remediation**: Decode named entities before protocol checks; inspect only
  real `style`, `display` and `visibility` attributes for hidden elements;
  keep text nodes verbatim and restrict numeric formatting to tag markup.
* **Verification**: `chaos/svg:*` tests, `tests/optimizeSvg.test.ts`.

### BUG-MD-008: Double-escaped image alt text
* **Severity**: Low (display)
* **Location**: `src/lib/markdownPreview.ts`
* **Vulnerability**: Alt text was escaped by both the inline renderer and the
  image fallback, producing `&amp;lt;` and a comment that could be closed by a
  crafted `-->` in the alt.
* **Remediation**: Escape alt exactly once and neutralize comment terminators
  in the fallback.
* **Verification**: `chaos/markdown:*` tests.

### BUG-SET-009: Persisted settings were spread without validation
* **Severity**: Medium (invalid engine options)
* **Location**: `src/lib/settings.ts`
* **Vulnerability**: `getSettings()` merged parsed JSON with a blind spread, so
  a stale or hand-edited `cz-settings-v2` could set unknown enum values,
  numeric strings, or out-of-range quality/concurrency.
* **Remediation**: New exported `mergeSettings()` validates and clamps every
  field; both the v1 migration and v2 load path use it.
* **Verification**: `chaos/settings:*` tests, `tests/settings.test.ts`.

### BUG-RES-010: Pool capacity changes orphaned queued jobs
* **Severity**: Medium (stuck queue)
* **Location**: `src/lib/resourceManager.ts`
* **Vulnerability**: Increasing `resourceLimits.concurrency` replaced the
  semaphores on the next `pools()` call, discarding waiters; queued jobs never
  started. Shrinking a pool also left stale weights in the queue.
* **Remediation**: Existing semaphores receive `setCapacity()` instead of being
  replaced, queued weights are clamped on shrink, and `onSettingsChange()`
  applies the new capacity immediately.
* **Verification**: `chaos/resourceManager:*` tests,
  `tests/resourceManager.test.ts`.

### BUG-ARC-011: Unhandled rejection in gzip streaming
* **Severity**: Low (console noise / abort path)
* **Location**: `src/lib/archives.ts`
* **Vulnerability**: The `writer.write()` promise in `streamCompressBytes()`
  was not settled when the source errored, producing an unhandled rejection.
* **Remediation**: The write promise is settled with a no-op catch.
* **Verification**: `chaos/archives:*` tests.

### Follow-up verification results

* **Deno test suite**: 222 tests passed, 0 failed (`deno task test`).
* **Type check**: clean (`deno task check`).
* **Lint**: 0 problems (`deno lint`).

