# Sentry Anonymous Error Reporting with Opt-Out & Support Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Configure Sentry error reporting to be strictly anonymous and enabled by default to detect application crashes and issues, provide an opt-out toggle with a warning prompt, add a new Support tab in Settings with a GitHub Issues reporting pill and troubleshooting/diagnostic context info, and update documentation and tests to reflect this transparently.

**Architecture:**
- Initialize Sentry only when an explicit DSN is available and error reporting has not been disabled by the user via local storage key `cz-telemetry-opt-out`.
- Strip all personal data, file names, paths, URLs, and console/DOM breadcrumbs using `beforeSend`, `beforeBreadcrumb`, and SDK configuration.
- Add an "Anonymous Error Diagnostics" toggle in Settings under Privacy with a warning confirmation on opt-out.
- Add a new "Support" tab to `SettingsDialog.svelte` featuring a GitHub Issues reporting pill button, system/runtime diagnostics (OS, browser, WebGPU, WebCodecs, memory profile, cross-origin isolation), a one-click "Copy Diagnostic Info" button for bug reports, and common troubleshooting tips.
- Update `e2e/smoke.spec.ts` to include the Support tab in the Settings navigation test suite.
- Document this policy in `PRIVACY.md` and `Privacy.svelte`.

**Tech Stack:** Svelte 5, TypeScript, `@sentry/svelte` v11.14.0, Vite, Playwright.

**Spec:** User instructions modifying code review issue 3: default ON, opt-out with warning, anonymous metadata only (no file names or ads/tracking), evaluation of the six privacy/telemetry protection measures, and adding a Support tab in Settings with a GitHub Issues pill and diagnostic/troubleshooting context.

---

## Evaluation of Proposed Measures: What They Block & Best Plan Analysis

Below is the technical evaluation of the 6 measures specified:
`{Drop Replays & Performance Tracing, Disable PII and IP Collection, Disable Breadcrumb Scraping (Console & DOM), Scrub File Names and URLs with beforeSend, Require Explicit User Opt-In & Environment Variable, Transparent Disclosure}`

1. **Drop Replays & Performance Tracing**:
   - *What it blocks:* Blocks visual DOM session recording (`replayIntegration`), user mouse movements, canvas screenshots, and performance/navigation waterfall spans (`browserTracingIntegration`).
   - *Impact on Debugging:* Zero negative impact on error diagnosis; eliminates the most severe privacy risk where documents or images rendered in the DOM could be visually captured.
   - *Verdict:* **Adopt immediately.**

2. **Disable PII and IP Collection**:
   - *What it blocks:* Disables attaching client IP addresses, cookies, user identifiers, or network headers to error events.
   - *Impact on Debugging:* None; bug fixing relies on stack traces, OS, and browser versions, not user identity or IP addresses.
   - *Verdict:* **Adopt immediately.**

3. **Disable Breadcrumb Scraping (Console & DOM)**:
   - *What it blocks:* Sentry's default breadcrumbs capture `console.log` statements (which frequently include file names in media processing tools, e.g. `[videoCompress] ... file.mp4`) and DOM clicks (`button > span: "my_tax_return.pdf"`).
   - *Impact on Debugging:* Slightly reduces the trail of actions preceding a crash, but completely eliminates accidental leaks of document names and user inputs.
   - *Verdict:* **Adopt immediately.** Configure `beforeBreadcrumb: () => null` or disable console/DOM breadcrumb integrations so logs and DOM text are never captured.

4. **Scrub File Names and URLs with `beforeSend`**:
   - *What it blocks:* Parses event error messages, exception values, and request URLs to strip specific file names (e.g. `secret.pdf` -> `[filename]`), system file paths (`C:\Users\...` -> `[path]`), and query parameters.
   - *Impact on Debugging:* Preserves exception types, line numbers, and engine error categories while removing all user-identifying strings.
   - *Verdict:* **Adopt immediately.**

5. **Opt-Out Mechanism with Warning (Default ON as requested by user)**:
   - *Comparison:* The bracket list proposed "Require Explicit User Opt-In", but the user explicitly requested: *"i want the default to be ON so that sentry can detect issues and bugs etc , opt out with warning makes it so that sentry does not get any more data for issue tracking"*.
   - *Approach:* Enabled by default so that unexpected production exceptions and WASM failures are caught. If the user opts out, Sentry is completely silenced and sends zero data.
   - *Warning dialog:* When opting out, warn the user that disabling error diagnostics prevents automated detection and fixing of issues they encounter.
   - *Verdict:* **Adopt user's preferred default-ON with opt-out model.**

6. **Transparent Disclosure**:
   - *What it blocks:* Prevents discrepancies between marketing/docs ("zero telemetry") and runtime network behavior.
   - *Verdict:* **Adopt immediately.** Document accurately in `Privacy.svelte`, `PRIVACY.md`, and `Settings.svelte`.

---

## Global Constraints

- Must pass `npm run typecheck` (`tsc --noEmit` and `svelte-check`) with 0 errors.
- Must pass `npm run lint` with 0 errors.
- Must pass `npm test` (all 32 unit and integration test suites, including `privacy-parity.test.ts`).
- All `localStorage` keys used by `src` must be documented in `PRIVACY.md`.
- `public/_headers` and `vite.config.ts` Content-Security-Policy must remain strictly in sync.
- `e2e/smoke.spec.ts` must pass when checking all Settings sections.

---

## Review Focus

1. **Opt-Out Persistence:** When a user opts out in Settings, reload must preserve the setting and prevent Sentry from sending any network requests.
2. **Warning on Opt-Out:** Toggling off error reporting prompts a warning modal/banner confirming the decision.
3. **File Name Scrubbing:** Error messages containing filenames like `report_2026.pdf` or paths must have them replaced with `[filename]` before transmission.
4. **Breadcrumb Scrubbing:** Console logs containing user filenames must not appear in Sentry breadcrumbs.
5. **Support Tab Diagnostics & GitHub Pill:** The Support tab displays accurate client diagnostics, the GitHub issue pill opens `https://github.com/ADJ189/CompressZ/issues/new` with prefilled context, and the copy button copies clean markdown to clipboard.
6. **Privacy Parity Compliance:** The new localStorage key `cz-telemetry-opt-out` must be documented in `PRIVACY.md` to prevent CI failure in `privacy-parity.test.ts`.

---

## Implementation Tasks

### Task 1: Update Sentry Configuration in `src/main.ts`
**Files to modify:**
- `src/main.ts`

**Implementation details:**
- Check `const optOut = typeof window !== "undefined" && window.localStorage?.getItem("cz-telemetry-opt-out") === "true";`
- Only initialize Sentry when `!optOut` AND `import.meta.env.VITE_SENTRY_DSN` (or configured DSN) is present.
- Drop `replayIntegration()` and `browserTracingIntegration()`.
- Add `beforeBreadcrumb: () => null` to drop console and DOM event scraping.
- Add `beforeSend(event)` to redact URLs to bare origin and scrub file names and paths from error values using regex.
- Set `sendDefaultPii: false`.

### Task 2: Add Support Tab & Opt-Out Toggle in `src/app/SettingsDialog.svelte`
**Files to modify:**
- `src/app/SettingsDialog.svelte`

**Implementation details:**
1. **Nav Update:**
   - Expand `activeSection` union with `"support"`.
   - Add a `<button>` in `#settings-nav` for "Support & Issues".
2. **Opt-Out with Warning (under Privacy & Data):**
   - Add "Anonymous Error Diagnostics" toggle (Default: ON / Checked).
   - When toggling to off, open a confirmation prompt/dialog warning:
     *"Warning: Disabling anonymous error diagnostics stops crash reports from being sent. Bugs and unexpected failures cannot be automatically detected or fixed by the team. Do you still want to disable it?"*
   - On confirmation, set `localStorage.setItem("cz-telemetry-opt-out", "true")`.
   - If re-enabled, remove `cz-telemetry-opt-out` from `localStorage`.
3. **Support Tab Content:**
   - **GitHub Reporting Pill:** A button/pill link styled with the CompressZ design system:
     `Report Issue on GitHub ↗` navigating to `https://github.com/ADJ189/CompressZ/issues/new`.
   - **Troubleshooting & Diagnostic Info Box:**
     - CompressZ Version (`v1.15.0`)
     - User Agent / Browser & OS
     - Screen Resolution & DPR
     - WebCodecs, WebGPU, and SIMD support detection
     - Cross-Origin Isolation (`crossOriginIsolated`)
     - Current Resource Profile and concurrency ceiling
     - Anonymous diagnostics status
   - **"Copy Diagnostic Info" Button:** Copies formatted markdown to clipboard and shows toast notification.
   - **Quick Troubleshooting Guide:** Summary of solutions for common issues (codec support, memory limits).

### Task 3: Update Privacy Documentation & Parity
**Files to modify:**
- `src/routes/Privacy.svelte`
- `PRIVACY.md`
- `src/app/ToolsDialog.svelte`

**Implementation details:**
- In `PRIVACY.md`:
  - Add `- \`cz-telemetry-opt-out\` — indicates whether anonymous error diagnostics have been disabled (enabled by default).`
  - Update §4 and §5 to disclose anonymous, PII-scrubbed error reporting and opt-out instructions.
- In `src/routes/Privacy.svelte`:
  - Disclose that anonymous error reporting is active by default to catch software crashes, collects zero file contents/names, and can be disabled anytime in Settings.
- In `src/app/ToolsDialog.svelte`:
  - Ensure description reads accurately.

### Task 4: Update Playwright E2E Settings Spec
**Files to modify:**
- `e2e/smoke.spec.ts`

**Implementation details:**
- In test `"every Settings section opens with its own content"`:
  - Add `["Support & Issues", /GitHub|Troubleshooting|Report/i]` to the `sections` array.
  - Verify that the nav button count and section click iteration match.

### Task 5: Automated Verification
**Files to run/test:**
- `npm test` to verify `privacy-parity.test.ts` passes.
- `npm run typecheck` to verify zero TypeScript/Svelte errors.
- `npm run lint` to verify zero lint errors.
