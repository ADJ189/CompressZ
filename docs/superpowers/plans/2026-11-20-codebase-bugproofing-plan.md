# Comprehensive Codebase Bugproofing Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Systematically audit, stress-test, and harden CompressZ against security vulnerabilities, memory leaks, parser crashes, and architectural defects using the Cloudflare 6-Phase Vulnerability Assessment Harness, Elephant-Goldfish (EGM) multi-perspective critique, and TypeScript strict buffer verification.

**Architecture:** Client-side zero-backend media workstation running TypeScript 5.9, Svelte 5, WebAssembly, WebCodecs, Web Streams, and WebCrypto on Cloudflare Pages.

---

### Task 1: Cloudflare Security Audit — Attack Surface Reconnaissance & Coverage Ledger
- [ ] Map all entrypoints, file ingest points, parsers, cryptographic modules, and output formatters in `coverage-ledger.json`.
- [ ] Verify security boundary policies (CSP, COOP/COEP headers in `public/_headers` and `vite.config.ts`).
- [ ] Confirm baseline verification (`npm run typecheck` and `npm run test`).

### Task 2: Cloudflare Security Audit — High-Risk Hunter Phase (Parsers & Archives)
- [ ] Audit `src/lib/zip.ts`, `src/lib/tar.ts`, and `src/lib/archives.ts` for directory traversal (Zip Slip), unhandled zip bombs, and integer overflows.
- [ ] Audit `src/lib/conversions/` (Excel, Word, PowerPoint OOXML parsers) for XML External Entity (XXE) patterns, HTML/formula injection, and unconstrained loop boundaries.
- [ ] Audit `src/lib/optimizeSvg.ts` and `src/lib/markdownPreview.ts` for DOM XSS and script execution vectors.

### Task 3: Cloudflare Security Audit — Cryptography & Privacy Hunter Phase
- [ ] Audit `src/lib/fileEncryption.ts` (PBKDF2 iteration count, AES-256-GCM authentication tag verification, key reuse, and IV uniqueness).
- [ ] Audit `src/lib/telemetry.ts` and `src/lib/qpdfWasm.ts` to guarantee zero-data leaks, strict opt-out compliance, and memory wiping of sensitive cryptographic buffers.

### Task 4: Candidate-Disprover Verification Pass
- [ ] For every candidate vulnerability discovered in Tasks 2 and 3, execute an adversarial disprover check.
- [ ] Test if Svelte escaping, browser sandboxing, existing sanitizers, or TypeScript type guards disprove exploitability.
- [ ] Categorize each candidate as either `disproven` (with rationale) or `confirmed` in `findings.json`.

### Task 5: Elephant-Goldfish Audit — Invariant & Specification Verification (`egm-codebase-details`)
- [ ] Verify each invariant in `AGENTS.md` and `AGENT_ROADMAP.md` against actual codebase behavior.
- [ ] Verify that all fallback paths (WebCodecs -> FFmpeg.wasm, native OffscreenCanvas -> fallback) function without silent unhandled rejections.
- [ ] Audit for dead code, unhandled promise errors, and unreached branches.

### Task 6: Elephant-Goldfish Audit — Hostile Design & Memory Stress (`egm-design`)
- [ ] Audit resource cleanup: `URL.revokeObjectURL` coverage across all export and preview paths.
- [ ] Audit Canvas/WebGL lifecycle (`dispose`, context loss handling, OffscreenCanvas memory release).
- [ ] Audit Web Worker and WASM heap management: verifying workers terminate and do not leak memory during rapid tool switches or batch cancellations.

### Task 7: Strict Typing & Buffer Hardening (`typescript-strict-patterns`)
- [ ] Audit and eliminate high-risk `any` types in parser routines (`src/lib/compressPdf.ts`, `src/lib/compressVideo.ts`, `src/lib/conversions/common.ts`, `src/lib/aiEngine.ts`).
- [ ] Ensure typed arrays (`Uint8Array`, `ArrayBuffer`) have verified bounds checks before slicing or copying.

### Task 8: Test-Driven Bug Fixes & Full Verification
- [ ] Write failing regression test suites in `tests/` for each confirmed issue found in previous phases.
- [ ] Implement minimal, surgical fixes respecting Svelte 5 and zero-backend constraints.
- [ ] Run full test suite (`npm run test`), type check (`npm run typecheck`), and lint (`npm run lint`).
- [ ] Generate comprehensive final audit report in `docs/security/AUDIT-REPORT.md`.
