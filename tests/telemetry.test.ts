import { assertEquals } from "./assert.ts";
import {
  isTelemetryOptedOut,
  setTelemetryOptOut,
  scrubDiagnosticText,
  sanitizeSentryEvent,
  clearStoragePreservingTelemetry,
  TELEMETRY_STORAGE_KEY,
} from "../src/lib/telemetry.ts";

function setStorageMock(mock: any) {
  Object.defineProperty(globalThis, "localStorage", {
    value: mock,
    configurable: true,
    writable: true,
  });
}

Deno.test("telemetry: isTelemetryOptedOut and setTelemetryOptOut safely handle localStorage", () => {
  const origDesc = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

  try {
    setTelemetryOptOut(false);
    // 1. Storage available
    const store: Record<string, string> = {};
    setStorageMock({
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
      clear: () => {
        for (const k of Object.keys(store)) delete store[k];
      },
    });

    // Defaults to false (telemetry enabled)
    assertEquals(isTelemetryOptedOut(), false);

    // Persist opt-out
    const written = setTelemetryOptOut(true);
    assertEquals(written, true);
    assertEquals(isTelemetryOptedOut(), true);

    // Reset opt-out
    setTelemetryOptOut(false);
    assertEquals(isTelemetryOptedOut(), false);

    // 2. Storage throws SecurityError (restricted browser environment)
    setStorageMock({
      getItem: () => { throw new Error("SecurityError: Access denied"); },
      setItem: () => { throw new Error("SecurityError: Access denied"); },
      removeItem: () => { throw new Error("SecurityError: Access denied"); },
      clear: () => { throw new Error("SecurityError: Access denied"); },
    });

    // When storage throws, runtimeOptOut was set to false above, so it remains false
    assertEquals(isTelemetryOptedOut(), false);
    // Setting opt out updates runtime preference, but storage persistence returns false
    assertEquals(setTelemetryOptOut(true), false);
    assertEquals(isTelemetryOptedOut(), true);
  } finally {
    setTelemetryOptOut(false);
    if (origDesc) {
      Object.defineProperty(globalThis, "localStorage", origDesc);
    } else {
      delete (globalThis as any).localStorage;
    }
  }
});

Deno.test("telemetry: scrubDiagnosticText redacts paths, unfamiliar extensions, spaces, and Unicode", () => {
  // 1. Windows path and file with spaces
  const win = scrubDiagnosticText("Error reading C:\\Users\\Administrator\\Documents\\My Tax 2024.pdf: corrupt");
  assertEquals(win.includes("C:\\Users"), false);
  assertEquals(win.includes("My Tax 2024.pdf"), false);
  assertEquals(win.includes("[path]"), true);

  const fileSpaces = scrubDiagnosticText("Failed to process My Tax 2024.pdf");
  assertEquals(fileSpaces.includes("My Tax 2024.pdf"), false);
  assertEquals(fileSpaces.includes("[filename]"), true);

  // 2. Unfamiliar extensions (HEIC, HEIF, MOV, FLAC)
  const standaloneHeic = scrubDiagnosticText("Failed decoding vacation_photo.heic (unsupported)");
  assertEquals(standaloneHeic.includes("vacation_photo.heic"), false);
  assertEquals(standaloneHeic.includes("[filename]"), true);

  const mov = scrubDiagnosticText("Demuxer failed on sample_video.mov");
  assertEquals(mov.includes("sample_video.mov"), false);
  assertEquals(mov.includes("[filename]"), true);

  // 3. Quoted strings (common container for user filenames in errors)
  const quoted = scrubDiagnosticText('Failed to process "Confidential Report.docx"');
  assertEquals(quoted.includes("Confidential Report"), false);
  assertEquals(quoted.includes('"[redacted]"'), true);

  // 4. Non-ASCII and Unicode filenames
  const unicodeJpg = scrubDiagnosticText("Cannot read image 写真_2026.jpg");
  assertEquals(unicodeJpg.includes("写真_2026.jpg"), false);
  assertEquals(unicodeJpg.includes("[filename]"), true);

  const unicodePdf = scrubDiagnosticText("Parser error in résumé_final.pdf");
  assertEquals(unicodePdf.includes("résumé_final.pdf"), false);
  assertEquals(unicodePdf.includes("[filename]"), true);
});

Deno.test("telemetry: sanitizeSentryEvent strips user, headers, URLs, and drops when opted out", () => {
  const origDesc = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

  try {
    setTelemetryOptOut(false);
    const store: Record<string, string> = {};
    setStorageMock({
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
      clear: () => {
        for (const k of Object.keys(store)) delete store[k];
      },
    });

    const mockEvent: NonNullable<Parameters<typeof sanitizeSentryEvent>[0]> = {
      user: { id: "user-123", ip_address: "192.168.1.1" },
      request: {
        url: "https://compressz.pages.dev/compress/images?secret=token&file=test.png",
        headers: { Cookie: "session=xyz", Authorization: "Bearer 123" },
      },
      message: 'Crash while processing "financial_data.xlsx"',
      exception: {
        values: [
          { value: "Error in /home/user/private/notes.txt: parsing failed" },
        ],
      },
      extra: { leakedData: "secret" },
      tags: { customUserTag: "tag" },
    };

    // When telemetry is enabled, event is sanitized and returned
    const sanitized = sanitizeSentryEvent(mockEvent);
    assertEquals(sanitized !== null, true);
    assertEquals(sanitized?.user, undefined);
    assertEquals(sanitized?.request?.headers, undefined);
    assertEquals(sanitized?.request?.url, "https://compressz.pages.dev/");
    assertEquals(sanitized?.extra, {});
    assertEquals(sanitized?.tags, {});
    assertEquals(sanitized?.message?.includes("financial_data.xlsx"), false);
    assertEquals(sanitized?.exception?.values?.[0]?.value?.includes("notes.txt"), false);

    // When opted out, sanitizeSentryEvent immediately drops the event (returns null)
    setTelemetryOptOut(true);
    const dropped = sanitizeSentryEvent(mockEvent);
    assertEquals(dropped, null);
  } finally {
    setTelemetryOptOut(false);
    if (origDesc) {
      Object.defineProperty(globalThis, "localStorage", origDesc);
    } else {
      delete (globalThis as any).localStorage;
    }
  }
});

Deno.test("telemetry: clearStoragePreservingTelemetry preserves opt-out across clear operations", () => {
  const origDesc = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

  try {
    const store: Record<string, string> = {};
    const mockStorage = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
      clear: () => {
        for (const k of Object.keys(store)) delete store[k];
      },
    };
    setStorageMock(mockStorage);

    // 1. User opted out -> Clear data -> opt-out preserved
    setTelemetryOptOut(true);
    store["cz-recent-tools"] = JSON.stringify(["image", "pdf"]);
    store["cz-recommendations-v1"] = JSON.stringify(["dismiss1"]);
    store["other-cached-key"] = "123";

    assertEquals(isTelemetryOptedOut(), true);
    clearStoragePreservingTelemetry(mockStorage as any);

    // Other keys deleted, telemetry opt-out preserved
    assertEquals(store["cz-recent-tools"], undefined);
    assertEquals(store["cz-recommendations-v1"], undefined);
    assertEquals(store["other-cached-key"], undefined);
    assertEquals(store[TELEMETRY_STORAGE_KEY], "true");
    assertEquals(isTelemetryOptedOut(), true);

    // 2. User did not opt out -> Clear data -> no spurious opt-out added
    setTelemetryOptOut(false);
    store["cz-recent-tools"] = JSON.stringify(["video"]);
    assertEquals(isTelemetryOptedOut(), false);

    clearStoragePreservingTelemetry(mockStorage as any);
    assertEquals(store["cz-recent-tools"], undefined);
    assertEquals(store[TELEMETRY_STORAGE_KEY], undefined);
    assertEquals(isTelemetryOptedOut(), false);
  } finally {
    setTelemetryOptOut(false);
    if (origDesc) {
      Object.defineProperty(globalThis, "localStorage", origDesc);
    } else {
      delete (globalThis as any).localStorage;
    }
  }
});
