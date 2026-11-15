/**
 * engineError.test.ts — Unit tests for the shared EngineError error type and log parsers.
 */
import { assert, assertEquals } from "./assert.ts";
import {
  EngineError,
  ENGINE_LABELS,
  splitLogLines,
  cleanLogLines,
  summarizeLog,
  describeFailure,
  engineFailure,
  toErrorMessage,
  toErrorLog,
  entryError,
} from "../src/lib/engineError.ts";

Deno.test("engineError: constructor sets engine, message, and detail", () => {
  assertEquals(ENGINE_LABELS.ffmpeg, "FFmpeg");
  const err = new EngineError("Test error", "ffmpeg", {
    exitCode: 1,
    log: ["line 1", "line 2"],
  });

  assertEquals(err instanceof Error, true);
  assertEquals(err instanceof EngineError, true);
  assertEquals(err.name, "EngineError");
  assertEquals(err.message, "Test error");
  assertEquals(err.engine, "ffmpeg");
  assertEquals(err.detail?.exitCode, 1);
  assertEquals(err.detail?.log?.length, 2);
});

Deno.test("engineError: splitLogLines handles mixed line breaks and whitespace", () => {
  const raw = "line 1\r\nline 2\r\n\r\nline 3\rline 4\nline 5\n";
  const lines = splitLogLines(raw);
  assertEquals(lines, ["line 1", "line 2", "line 3", "line 4", "line 5"]);
});

Deno.test("engineError: cleanLogLines bounds line count and line lengths", () => {
  const longLine = "a".repeat(400);
  const raw = `line 1\nline 2\nline 3\n${longLine}\nline 5`;
  const cleaned = cleanLogLines(raw, 3, 50);

  assertEquals(cleaned.length, 3);
  assertEquals(cleaned[0], "line 3");
  assertEquals(cleaned[1], `${"a".repeat(50)}…`);
  assertEquals(cleaned[2], "line 5");
});

Deno.test("engineError: summarizeLog extracts meaningful cause and strips pointer noise", () => {
  const ffmpegLog = `
[info] Input #0, mov,mp4,m4a, from 'in.mp4':
[libx264 @ 0x55f9a8b12] height not divisible by 2 (1080x1921)
Error while opening encoder for output stream #0:0
Conversion failed!
`;

  const summary = summarizeLog(ffmpegLog);
  assertEquals(summary, "height not divisible by 2 (1080x1921)");

  // Fallback when log is empty
  assertEquals(summarizeLog("", "default fallback"), "default fallback");
});

Deno.test("engineError: describeFailure formats readable message with exit code", () => {
  const msg = describeFailure("ffmpeg", "transcode the video", {
    exitCode: 1,
    output: "Unknown encoder 'libvpx-vp9'",
  });
  assertEquals(
    msg,
    "FFmpeg could not transcode the video (exit 1): Unknown encoder 'libvpx-vp9'",
  );

  const cleanExit = describeFailure("qpdf", "encrypt the PDF", {
    output: "Invalid password",
  });
  assertEquals(cleanExit, "QPDF could not encrypt the PDF: Invalid password");
});

Deno.test("engineError: engineFailure bundles EngineError with detail", () => {
  const err = engineFailure("qpdf", "decrypt the PDF", {
    exitCode: 2,
    output: "qpdf: invalid password\nsome other line",
  });

  assertEquals(err instanceof EngineError, true);
  assertEquals(err.engine, "qpdf");
  assertEquals(err.detail?.exitCode, 2);
  assertEquals(err.detail?.log?.length, 2);
  assert(err.message.includes("QPDF could not decrypt the PDF (exit 2):"));
});

Deno.test("engineError: toErrorMessage, toErrorLog, and entryError fold errors safely", () => {
  const plainErr = new Error("Something broke");
  assertEquals(toErrorMessage(plainErr, "fallback"), "Something broke");
  assertEquals(toErrorLog(plainErr), undefined);

  const stringErr = "raw error string";
  assertEquals(toErrorMessage(stringErr, "fallback"), "raw error string");

  const unknownErr = null;
  assertEquals(toErrorMessage(unknownErr, "fallback"), "fallback");

  const engErr = new EngineError("Engine failed", "ffmpeg", {
    log: ["diagnostic 1", "diagnostic 2"],
  });
  const folded = entryError(engErr, "default");
  assertEquals(folded.error, "Engine failed");
  assertEquals(folded.errorLog, ["diagnostic 1", "diagnostic 2"]);
});
