/**
 * telemetry.ts — Anonymous error reporting and diagnostics lifecycle.
 *
 * Configures Sentry for pure crash and exception tracking:
 * - Session tracking, replays, performance tracing, DOM scraping, and console interceptors are disabled.
 * - Client-side event payloads are stripped of personal identifiers, user IPs, cookies, headers,
 *   system paths, query parameters, and filenames (including spaces, Unicode, and all extensions).
 * - Live opt-out immediately disables the in-memory Sentry client and drops queued events without requiring a reload.
 * - Re-enabling in Settings initializes the client on-the-fly.
 * - All localStorage reads/writes are wrapped in try/catch to protect startup in restricted browser environments.
 */

import * as Sentry from "@sentry/svelte";

export const TELEMETRY_STORAGE_KEY = "cz-telemetry-opt-out";

export const DEFAULT_SENTRY_DSN =
  "https://8acc8037c5074ed5bfcc11793aff8c8e@o4512456407515136.ingest.us.sentry.io/4512456419770368";

function getStorage(): Storage | null {
  try {
    if (typeof globalThis !== "undefined" && (globalThis as any).localStorage) {
      return (globalThis as any).localStorage;
    }
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage;
    }
    if (typeof localStorage !== "undefined") {
      return localStorage;
    }
    return null;
  } catch {
    return null;
  }
}

let runtimeOptOut = false;

/**
 * Safely check if the user has opted out of error diagnostics.
 * Returns false by default (error diagnostics enabled), or true if opted out.
 * Never throws, even if storage access is restricted.
 */
export function isTelemetryOptedOut(): boolean {
  if (runtimeOptOut) return true;
  try {
    const storage = getStorage();
    if (storage?.getItem(TELEMETRY_STORAGE_KEY) === "true") {
      runtimeOptOut = true;
      return true;
    }
    return runtimeOptOut;
  } catch {
    return runtimeOptOut;
  }
}

/**
 * Safely persist the user's error diagnostics opt-out preference.
 * Records the runtime choice immediately, then persists to storage if available.
 * Returns true if written successfully to storage, false if storage was blocked.
 */
export function setTelemetryOptOut(optOut: boolean): boolean {
  runtimeOptOut = optOut;
  try {
    const storage = getStorage();
    if (!storage) return false;
    if (optOut) {
      storage.setItem(TELEMETRY_STORAGE_KEY, "true");
    } else {
      storage.removeItem(TELEMETRY_STORAGE_KEY);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Safely clear local storage while preserving the user's telemetry opt-out preference.
 * If the user has opted out, the opt-out preference key is preserved so error diagnostics
 * do not unexpectedly resume reporting after clearing cache or reloading.
 */
export function clearStoragePreservingTelemetry(storage?: Storage | null): void {
  const target = storage ?? getStorage();
  if (!target) return;
  try {
    const wasOptedOut = isTelemetryOptedOut();
    target.clear();
    if (wasOptedOut) {
      target.setItem(TELEMETRY_STORAGE_KEY, "true");
    }
  } catch {
    // Gracefully ignore storage restrictions
  }
}

const CONTEXT_PREFIX_WORDS =
  "process(?:ing)?|read(?:ing)?|load(?:ing)?|pars(?:e|ing|er)|open(?:ing)?|convert(?:ing)?|compress(?:ing)?|decod(?:e|ing|er)|handl(?:e|ing)|fetch(?:ing)?|in|on|at|for|from|into|with|file|document|image|photo|picture|audio|video|clip|archive|target|source|name|error|exception|failed|failure";

const KNOWN_FILE_EXTENSIONS =
  "heic|heif|mov|m4v|mp4|webm|mkv|avi|wav|mp3|flac|aac|ogg|pdf|docx|xlsx|pptx|odt|ods|odp|png|jpe?g|webp|gif|svg|tiff?|bmp|zip|tar|gz|7z|[a-zA-Z0-9]{2,6}";

/**
 * Thoroughly scrub filenames, system paths, and user-controlled strings from error text.
 * Handles Unicode, spaces, Windows/Unix paths, and unfamiliar extensions (e.g. HEIC, MOV, FLAC).
 */
export function scrubDiagnosticText(text: string): string {
  if (!text) return "";

  return text
    // 1. Strip complete Windows filesystem paths with spaces (e.g. C:\Users\Jane Doe\Docs\My Tax 2024.pdf)
    .replace(/[a-zA-Z]:\\(?:[^"'\n\r\t<>:*?/|:\\]+\\)*[^"'\n\r\t<>:*?/|\\:]+/g, "[path]")
    // 2. Strip complete Unix filesystem paths with spaces (e.g. /Users/jane doe/docs/My Tax 2024.pdf)
    .replace(/(^|[\s(,:])((?:~|\.{1,2})?\/(?:[^"'\n\r\t<>:*?|/:]+\/)+[^"'\n\r\t<>:*?|/:]+)/g, "$1[path]")
    // 3. Strip double and single quoted strings (frequent container of raw user filenames)
    .replace(/"[^"\r\n]{1,250}"/g, '"[redacted]"')
    .replace(/'[^'\r\n]{1,250}'/g, "'[redacted]'")
    // 4. Strip filenames containing spaces following context verbs, nouns or delimiters (using non-backtracking groups)
    .replace(
      new RegExp(`(\\b(?:${CONTEXT_PREFIX_WORDS})\\b[:\\s]+)([^\\r\\n/\\\\:?*"<>|]+?\\.(?:${KNOWN_FILE_EXTENSIONS}))\\b`, "giu"),
      "$1[filename]",
    )
    // 5. Strip filenames at start of text or following punctuation delimiters
    .replace(
      new RegExp(`(^|[\\r\\n]|[:\\-–—=\\t(]\\s*)([^\\r\\n/\\\\:?*"<>|\\s][^\\r\\n/\\\\:?*"<>|]*?\\.(?:${KNOWN_FILE_EXTENSIONS}))\\b`, "giu"),
      "$1[filename]",
    )
    // 6. Strip standalone filenames with extensions
    .replace(
      new RegExp(`\\b[^\\s/\\\\:?*"<>|]{1,80}\\.(?:${KNOWN_FILE_EXTENSIONS})\\b`, "giu"),
      "[filename]",
    )
    // 7. Collapse any redundant placeholders
    .replace(/(\[filename\]\s*)+/g, "[filename] ")
    .replace(/(\[path\]\s*)+/g, "[path] ")
    .trim();
}

/**
 * Sanitize a Sentry event before sending.
 * Drops the event completely if the user opted out or if the event cannot be safely anonymized.
 */
export function sanitizeSentryEvent(event: Sentry.Event): Sentry.Event | null {
  // 1. Dynamic opt-out check: drop immediately if opted out at runtime
  if (isTelemetryOptedOut()) {
    return null;
  }

  // 2. Strip request URLs to root origin only
  if (event.request?.url) {
    try {
      const parsed = new URL(event.request.url);
      event.request.url = `${parsed.origin}/`;
    } catch {
      event.request.url = "[redacted]";
    }
  }

  // 3. Remove all user identifiers, IP addresses, cookies, and HTTP headers
  delete event.user;
  if (event.request?.headers) {
    delete event.request.headers;
  }

  // 4. Scrub custom contexts, tags, and extra data to prevent accidental leakage
  event.extra = {};
  event.tags = {};
  if (event.contexts) {
    delete (event.contexts as Record<string, unknown>).state;
  }

  // 5. Scrub error message
  if (event.message) {
    event.message = scrubDiagnosticText(event.message);
  }

  // 6. Scrub exception values
  if (event.exception?.values) {
    for (const val of event.exception.values) {
      if (val.value) {
        val.value = scrubDiagnosticText(val.value);
      }
    }
  }

  return event;
}

declare const __APP_VERSION__: string | undefined;

let isInitialized = false;

/**
 * Initialize Sentry error reporting if enabled and configured.
 */
export function initTelemetry(dsnOverride?: string): boolean {
  if (isTelemetryOptedOut()) {
    return false;
  }

  const dsn =
    dsnOverride ||
    (typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_SENTRY_DSN) ||
    DEFAULT_SENTRY_DSN;

  if (!dsn) {
    return false;
  }

  // If already active with usable transport, return true
  const existingClient = Sentry.getClient();
  if (isInitialized && existingClient && typeof (existingClient as any).getTransport === "function" && (existingClient as any).getTransport()) {
    return true;
  }

  const appVersion = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "1.15.5";
  const envMode =
    typeof import.meta !== "undefined" && (import.meta as any).env
      ? (import.meta as any).env.MODE || ((import.meta as any).env.DEV ? "development" : "production")
      : "production";

  Sentry.init({
    dsn,
    sendDefaultPii: false,
    sendClientReports: false,
    release: `compressz@${appVersion}`,
    environment: envMode,
    // Drop session tracking, breadcrumb scraping, and console interceptors so zero telemetry is sent during normal usage
    integrations: (defaultIntegrations: any[]) =>
      defaultIntegrations.filter(
        (i) => i.name !== "BrowserSession" && i.name !== "Breadcrumbs" && i.name !== "Console",
      ),
    beforeBreadcrumb: () => null,
    beforeSend: sanitizeSentryEvent,
  } as any);

  const client = Sentry.getClient();
  if (client && typeof (client as any).getTransport === "function" && (client as any).getTransport()) {
    isInitialized = true;
    return true;
  }
  isInitialized = false;
  return false;
}

/**
 * Dynamically disable error reporting at runtime: closes the Sentry client and drops in-flight events.
 */
export async function disableTelemetry(): Promise<void> {
  isInitialized = false;
  setTelemetryOptOut(true);
  try {
    const client = Sentry.getClient();
    if (client && typeof (client as any).getTransport === "function") {
      const transport = (client as any).getTransport();
      if (typeof transport?.abort === "function") {
        transport.abort();
      }
    }
    if (typeof Sentry.close === "function") {
      await Promise.race([
        Sentry.close(500),
        new Promise((resolve) => setTimeout(resolve, 500)),
      ]);
    }
  } catch {
    // Ignore close errors
  }
}

/**
 * Dynamically re-enable error reporting at runtime: resets opt-out and initializes Sentry.
 */
export function enableTelemetry(): boolean {
  setTelemetryOptOut(false);
  return initTelemetry();
}
