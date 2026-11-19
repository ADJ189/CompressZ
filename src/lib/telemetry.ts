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

/**
 * Safely check if the user has opted out of error diagnostics.
 * Returns false by default (error diagnostics enabled), or true if opted out.
 * Never throws, even if storage access is restricted.
 */
export function isTelemetryOptedOut(): boolean {
  try {
    const storage = getStorage();
    return storage?.getItem(TELEMETRY_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

/**
 * Safely persist the user's error diagnostics opt-out preference.
 * Returns true if written successfully, false if storage was blocked.
 */
export function setTelemetryOptOut(optOut: boolean): boolean {
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
 * Thoroughly scrub filenames, system paths, and user-controlled strings from error text.
 * Handles Unicode, spaces, Windows/Unix paths, and unfamiliar extensions (e.g. HEIC, MOV, FLAC).
 */
export function scrubDiagnosticText(text: string): string {
  if (!text) return "";

  return text
    // Strip Windows drive paths (e.g. C:\Users\... or D:\Documents\...)
    .replace(/[a-zA-Z]:\\[^"'\n\r\t<>]+/g, "[path]")
    // Strip Unix-style paths
    .replace(/(?:\/[a-zA-Z0-9_.-]+){2,}/g, "[path]")
    // Strip double and single quoted strings (frequent container of raw user filenames)
    .replace(/"[^"\r\n]{1,250}"/g, '"[redacted]"')
    .replace(/'[^'\r\n]{1,250}'/g, "'[redacted]'")
    // Strip filenames with extensions, including spaces and non-ASCII / Unicode characters
    .replace(
      /(?:[\p{L}\p{N}_.\s-]{1,80})\.(?:heic|heif|mov|m4v|mp4|webm|mkv|avi|wav|mp3|flac|aac|ogg|pdf|docx|xlsx|pptx|odt|ods|odp|png|jpe?g|webp|gif|svg|tiff?|bmp|zip|tar|gz|7z|[a-zA-Z0-9]{2,6})\b/giu,
      "[filename]",
    )
    // Collapse any redundant placeholders
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
    delete (event.contexts as any).state;
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
    (typeof import.meta !== "undefined" && import.meta.env?.VITE_SENTRY_DSN) ||
    DEFAULT_SENTRY_DSN;

  if (!dsn) {
    return false;
  }

  // If already active, return true
  if (isInitialized && Sentry.getClient()) {
    return true;
  }

  const appVersion = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "1.15.0";
  const envMode =
    typeof import.meta !== "undefined" && import.meta.env
      ? import.meta.env.MODE || (import.meta.env.DEV ? "development" : "production")
      : "production";

  Sentry.init({
    dsn,
    sendDefaultPii: false,
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

  isInitialized = true;
  return true;
}

/**
 * Dynamically disable error reporting at runtime: closes the Sentry client and drops in-flight events.
 */
export async function disableTelemetry(): Promise<void> {
  isInitialized = false;
  try {
    if (typeof Sentry.close === "function") {
      await Sentry.close();
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
