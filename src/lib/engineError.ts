/**
 * engineError.ts — One error type for every heavyweight engine.
 *
 * The engines (FFmpeg.wasm, QPDF, PDF.js, pdf-lib, Tesseract, PaddleOCR) each
 * fail for their own reasons, but the UI needs the same three things every
 * time: which engine failed, what it said, and the raw log on demand. Before
 * this module the callers threw bare `Error("Compression failed")`, so the
 * actual reason — an unknown encoder, a corrupt container, a wrong password —
 * was discarded and the user got a generic "full error".
 *
 * Pure TypeScript with no DOM or Svelte imports so it can be unit-tested
 * headlessly (see `tests/engineError.test.ts`).
 */

export type EngineName =
  | "ffmpeg"
  | "qpdf"
  | "pdfjs"
  | "pdflib"
  | "tesseract"
  | "paddle"
  | "other";

export interface EngineErrorDetail {
  /** Process exit status, when the engine reports one. */
  exitCode?: number;
  /** Last N log lines, already trimmed and bounded. */
  log?: string[];
}

export class EngineError extends Error {
  readonly engine: EngineName;
  readonly detail?: EngineErrorDetail;

  constructor(message: string, engine: EngineName, detail?: EngineErrorDetail) {
    super(message);
    this.name = "EngineError";
    this.engine = engine;
    this.detail = detail;
    // Keep `instanceof` working if this class is ever down-levelled by a
    // bundler targeting ES5.
    Object.setPrototypeOf(this, EngineError.prototype);
  }
}

/** Human-facing engine names used in error messages. */
export const ENGINE_LABELS: Record<EngineName, string> = {
  ffmpeg: "FFmpeg",
  qpdf: "QPDF",
  pdfjs: "PDF.js",
  pdflib: "pdf-lib",
  tesseract: "Tesseract",
  paddle: "PaddleOCR",
  other: "The engine",
};

const MAX_LINE_LENGTH = 300;

function trimLine(line: string, maxLineLength: number): string {
  return line.length > maxLineLength ? `${line.slice(0, maxLineLength)}…` : line;
}

/**
 * Split arbitrary engine output into clean lines. Engine logs are long,
 * progress-heavy, and full of bare `\r`; the UI only ever wants the tail.
 * The input is clipped first so a runaway log cannot be split in full.
 */
export function splitLogLines(text: string): string[] {
  return text
    .slice(-8000)
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** The last `max` non-empty log lines, trimmed and length-capped. */
export function cleanLogLines(
  text: string,
  max = 20,
  maxLineLength = MAX_LINE_LENGTH,
): string[] {
  return splitLogLines(text)
    .slice(-max)
    .map((line) => trimLine(line, maxLineLength));
}

/** Lines that only restate "something failed" without saying what. */
const GENERIC_FAILURE = /^(?:conversion failed!?|error while (?:opening|writing|processing).*|failed!?)$/i;

/** Lines that actually name a cause. */
const CAUSE_HINT =
  /\b(?:error|invalid|unable|unsupported|unknown|no such|not found|does not|did not|cannot|can't|matches no streams|could not|failed to|incorrect|corrupt|missing)\b/i;

/**
 * Pick the most informative line out of an engine log. FFmpeg prints its real
 * cause above a generic trailing `Conversion failed!`, so scan from the end
 * but skip lines that carry no information.
 */
export function summarizeLog(
  text: string,
  fallback = "unknown error",
): string {
  const lines = splitLogLines(text);
  if (lines.length === 0) return fallback;

  let candidate = "";
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (GENERIC_FAILURE.test(line)) continue;
    if (CAUSE_HINT.test(line)) {
      candidate = line;
      break;
    }
  }

  if (!candidate) {
    // Nothing looked like a cause: the last line is still better than nothing.
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!GENERIC_FAILURE.test(lines[i])) {
        candidate = lines[i];
        break;
      }
    }
  }
  if (!candidate) candidate = lines[lines.length - 1];

  // FFmpeg prefixes a lot of lines with "[libx264 @ 0x55f...]"; drop the
  // pointer noise so the message stays readable in a toast. Disallowing nested brackets
  // and `@` prevents superlinear regex backtracking.
  candidate = candidate.replace(/\[[^[\]\r\n@]*@\s*0x[0-9a-f]+\]\s*/gi, "").trim();
  return trimLine(candidate, MAX_LINE_LENGTH) || fallback;
}

/**
 * Build the message a caller should throw for a failed engine run.
 * Reads like: `FFmpeg could not compress the video (exit 1): Unknown encoder 'libvpx-vp9'`.
 */
export function describeFailure(
  engine: EngineName,
  task: string,
  options: { exitCode?: number; output?: string; fallback?: string } = {},
): string {
  const label = ENGINE_LABELS[engine] ?? ENGINE_LABELS.other;
  const reason = summarizeLog(options.output ?? "", options.fallback ?? "unknown error");
  const code =
    typeof options.exitCode === "number" && options.exitCode !== 0
      ? ` (exit ${options.exitCode})`
      : "";
  return `${label} could not ${task}${code}: ${reason}`;
}

/**
 * Create the error for a failed engine run, carrying its exit code and the
 * bounded tail of its log for the expandable "details" UI.
 */
export function engineFailure(
  engine: EngineName,
  task: string,
  options: { exitCode?: number; output?: string; fallback?: string } = {},
): EngineError {
  return new EngineError(describeFailure(engine, task, options), engine, {
    exitCode: options.exitCode,
    log: cleanLogLines(options.output ?? ""),
  });
}

/** Return `err`'s message when it has one, else the caller's fallback. */export function toErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) {
    const message = err.message.trim();
    if (message) return message;
  }
  if (typeof err === "string" && err.trim()) return err.trim();
  return fallback;
}

/** The expandable log for an `EngineError`, or `undefined` for anything else. */
export function toErrorLog(err: unknown): string[] | undefined {
  if (err instanceof EngineError && err.detail?.log?.length) {
    return err.detail.log;
  }
  return undefined;
}

/**
 * Fold a failure into the two fields a file card renders: the one-line reason
 * and, when the engine reported one, the bounded log behind "Engine log".
 */
export function entryError(
  err: unknown,
  fallback: string,
): { error: string; errorLog?: string[] } {
  return { error: toErrorMessage(err, fallback), errorLog: toErrorLog(err) };
}
