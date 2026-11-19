# Telemetry & Error Diagnostics Policy

This document provides complete, transparent disclosure of CompressZ's diagnostic error reporting architecture, anonymization pipeline, and user opt-out controls.

---

## 1. Overview & Core Guarantee

CompressZ is fundamentally a **local-first, privacy-respecting application**:
- **Zero Document Telemetry**: Your files, documents, audio, videos, and images are never uploaded to any remote server or analytics service.
- **No Third-Party Analytics**: We run zero marketing trackers, no Google Analytics, no Facebook Pixels, and no behavioral tracking scripts.
- **No Session Replays**: We do not use session recording or DOM replay tools (e.g. Sentry Session Replay, LogRocket, Hotjar).

To catch software crashes, unhandled WASM exceptions, and browser compatibility bugs across the multitude of operating systems and hardware configurations, CompressZ includes **Anonymous Error Diagnostics** powered by Sentry.

---

## 2. Default Configuration & Rationale

- **Default State**: **ON (Enabled)**.
- **Why Enabled by Default**: Client-side media processing relies heavily on bleeding-edge Web platform APIs (WebAssembly SIMD, WebCodecs, WebGPU, OffscreenCanvas). Many critical failures (e.g., GPU driver crashes, WASM out-of-memory traps, container demuxing bugs) can only be identified and resolved if developers receive anonymized crash reports.
- **Opt-Out Control**: Users can disable anonymous error diagnostics at any time with a single click in **Settings → Privacy & data**.

---

## 3. Strict Anonymization Pipeline (`beforeSend`)

Before any error event is dispatched over the network, it passes through a multi-stage sanitizer implemented in `src/lib/telemetry.ts`:

### 3.1 What is EXCLUDED from Event Payloads:
1. **User Filenames & Paths**:
   - All Windows drive paths (e.g. `C:\Users\Username\...`) and Unix paths are redacted to `[path]`.
   - Quoted strings (common containers of filenames in exception messages) are redacted to `"[redacted]"`.
   - File-like tokens with any extension (including `.heic`, `.heif`, `.mov`, `.flac`, `.pdf`, `.docx`, etc.) across ASCII and non-ASCII/Unicode character sets are replaced with `[filename]`.
2. **User Identifiers & IP Addresses**:
   - `event.user` is explicitly deleted.
   - User account IDs, email addresses, usernames, and client IP fields are omitted from the JSON payload.
3. **HTTP Headers & Cookies**:
   - `event.request.headers` is completely purged. No cookies, authorization tokens, or browser fingerprints are transmitted.
4. **URL Sanitization**:
   - Request URLs are stripped of query parameters and route paths, transmitting only the root origin (`https://compressz.pages.dev/`).
5. **No Context Leaks**:
   - Custom tags and application state contexts are cleared (`event.extra = {}; event.tags = {};`).

### 3.2 Network Socket vs. Payload IP Disclosure
- **Payload Level**: The JSON error payload sent to Sentry contains zero IP address data.
- **Transport Layer**: As with any standard HTTPS network request, the TCP/IP network packets connecting to the ingest endpoint (`ingest.us.sentry.io`) inevitably carry the client's public socket IP address to complete the TCP handshake. Sentry's ingest endpoint processes this transient socket metadata in accordance with its privacy terms and does not append it to our scrubbed event records.

---

## 4. Live Opt-Out & Re-Enabling Lifecycle

Unlike typical web applications that require a full browser reload to apply telemetry toggles:
1. **Immediate Disablement Without Reload**:
   - Clicking "Disable" in Settings immediately invokes `disableTelemetry()`.
   - The active Sentry client is closed (`Sentry.close()`).
   - The `beforeSend` hook dynamically queries `isTelemetryOptedOut()` and instantly drops any pending, queued, or subsequent events (`return null`).
2. **Immediate Re-Enabling**:
   - Clicking "Enable" in Settings immediately resets the preference and invokes `initTelemetry()`, restoring crash reporting without page refresh.
3. **Resilient Local Storage**:
   - Telemetry preferences are accessed through guarded helpers (`isTelemetryOptedOut`, `setTelemetryOptOut`) wrapped in `try...catch` blocks. If local storage is blocked by strict browser security settings, the application defaults to safe operation without throwing unhandled `SecurityError` exceptions or crashing on startup.

---

## 5. Support Diagnostics (Manual Bug Reporting)

For users who encounter an issue and prefer to report it manually on GitHub:
- The **Settings → Support & Issues** panel provides a direct pill link to [GitHub Issues](https://github.com/ADJ189/CompressZ/issues/new).
- A one-click **"Copy Diagnostic Info"** button allows users to copy high-level system diagnostics:
  - Application version
  - User Agent & Browser version
  - Screen resolution & Device Pixel Ratio
  - CPU hardware concurrency
  - Cross-Origin Isolation status (COOP/COEP)
  - WebCodecs & WebGPU capability flags
- **Zero Document Data**: The diagnostic copier collects only device capabilities; it never inspects file names, processed data, or queue contents.
