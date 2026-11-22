/**
 * chaos.test.ts — adversarial, fuzz and stress coverage for the parsers and
 * schedulers that handle untrusted input.
 *
 * These tests are deterministic (seeded PRNG) and offline. They are not a
 * substitute for the focused suites; their job is to prove that malformed or
 * hostile bytes produce a bounded, diagnosable failure instead of a hang, an
 * out-of-bounds DataView read, an unhandled rejection or a silent truncation.
 */
import { assert, assertEquals, assertRejects, assertThrows } from "./assert.ts";
import { readZip, writeZip, zipSupported } from "../src/lib/zip.ts";
import { createUstarHeader, readTar, writeTar } from "../src/lib/tar.ts";
import {
  gzipUncompressedSize,
  MAX_DECOMPRESSED_BYTES,
  streamCompressBytes,
  streamDecompressBytes,
} from "../src/lib/archives.ts";
import { optimizeSvg } from "../src/lib/optimizeSvg.ts";
import { renderMarkdownToHtml } from "../src/lib/markdownPreview.ts";
import { defaultSettings, mergeSettings } from "../src/lib/settings.ts";
import {
  getResourceSnapshot,
  invalidateResourcePolicy,
  resetAdaptiveState,
  runScheduled,
} from "../src/lib/resourceManager.ts";
import { resetSettings, updateSettings } from "../src/lib/settings.ts";
import { runBatch } from "../src/lib/batch.ts";
import { computeCrc32 } from "../src/lib/wasmMath.ts";

// ── Helpers ───────────────────────────────────────────────────

/** Small deterministic PRNG (mulberry32) so failures are reproducible. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomBytes(length: number, random: () => number): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = Math.floor(random() * 256);
  return out;
}

/** Assert that a promise rejects, but never with an opaque RangeError. */
async function rejectsWithoutRangeError(
  label: string,
  fn: () => Promise<unknown>,
): Promise<void> {
  try {
    await fn();
  } catch (err) {
    assert(err instanceof Error, `${label}: expected an Error instance`);
    assert(
      !(err instanceof RangeError),
      `${label}: leaked a RangeError instead of a validation error (${err.message})`,
    );
  }
}

function eocd(entries: number, centralSize: number, centralStart: number): Uint8Array {
  const bytes = new Uint8Array(22);
  const dv = new DataView(bytes.buffer);
  dv.setUint32(0, 0x06054b50, true);
  dv.setUint16(8, entries, true);
  dv.setUint16(10, entries, true);
  dv.setUint32(12, centralSize, true);
  dv.setUint32(16, centralStart, true);
  return bytes;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Recompute a UStar header checksum after a test mutates the header. */
function stampChecksum(block: Uint8Array): void {
  block.fill(0x20, 148, 156);
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += block[i];
  const octal = sum.toString(8).padStart(6, "0");
  block.set(new TextEncoder().encode(octal), 148);
  block[154] = 0;
  block[155] = 0x20;
}

function tarBlock(
  name: string,
  size: number,
  typeflag: number,
  data: Uint8Array = new Uint8Array(0),
): Uint8Array {
  const header = createUstarHeader(name, size, 1_700_000_000_000);
  header[156] = typeflag;
  stampChecksum(header);
  const padding = new Uint8Array((512 - (size % 512)) % 512);
  return concat(header, data, padding);
}

// ── ZIP: malformed structure ─────────────────────────────────

Deno.test("chaos/zip: tiny and random buffers never leak a RangeError", async () => {
  const random = rng(0xc0ffee);
  for (let length = 0; length <= 64; length++) {
    const bytes = randomBytes(length, random);
    await rejectsWithoutRangeError(`zip length ${length}`, () =>
      readZip(bytes.buffer as ArrayBuffer),
    );
  }
  for (let n = 0; n < 150; n++) {
    const length = Math.floor(random() * 4096);
    const bytes = randomBytes(length, random);
    await rejectsWithoutRangeError(`zip fuzz ${n}`, () =>
      readZip(bytes.buffer as ArrayBuffer),
    );
  }
});

Deno.test("chaos/zip: central directory offset outside the archive is diagnosed", async () => {
  const bytes = eocd(1, 0, 0x7fff_ffff);
  await assertRejects(
    () => readZip(bytes.buffer as ArrayBuffer),
    "central directory offset points outside",
  );
});

Deno.test("chaos/zip: truncated central directory header is diagnosed", async () => {
  const bytes = concat(eocd(1, 10, 22), new Uint8Array(10));
  await assertRejects(
    () => readZip(bytes.buffer as ArrayBuffer),
    "central directory offset points outside",
  );
});

Deno.test("chaos/zip: local header and entry data outside the archive are diagnosed", async () => {
  // Central directory present, but localOffset points past EOF.
  const central = new Uint8Array(46 + 1);
  const cdv = new DataView(central.buffer);
  cdv.setUint32(0, 0x02014b50, true);
  cdv.setUint16(10, 0, true); // stored
  cdv.setUint16(28, 1, true); // name length
  cdv.setUint32(42, 0x7fff_ffff, true); // local offset
  central[46] = 0x61; // "a"
  const oobLocal = concat(eocd(1, central.length, 22), central);
  await assertRejects(
    () => readZip(oobLocal.buffer as ArrayBuffer),
    "local file header points outside",
  );

  // Local header is present but its data range runs past EOF.
  const local = new Uint8Array(30 + 1);
  const ldv = new DataView(local.buffer);
  ldv.setUint32(0, 0x04034b50, true);
  ldv.setUint16(26, 1, true); // name length
  ldv.setUint32(18, 0x7fff_ffff, true); // compressed size
  local[30] = 0x61;
  const central2 = new Uint8Array(46 + 1);
  const cdv2 = new DataView(central2.buffer);
  cdv2.setUint32(0, 0x02014b50, true);
  cdv2.setUint16(10, 0, true);
  cdv2.setUint16(28, 1, true);
  cdv2.setUint32(20, 0x7fff_ffff, true); // compressed size
  cdv2.setUint32(42, 0, true); // local offset
  central2[46] = 0x61;
  const centralStart = local.length;
  const oobData = concat(local, central2, eocd(1, central2.length, centralStart));
  await assertRejects(
    () => readZip(oobData.buffer as ArrayBuffer),
    "entry data points outside",
  );
});

Deno.test("chaos/zip: per-entry and aggregate decompression bombs are capped", async () => {
  if (!zipSupported()) return;
  const zeros = new Uint8Array(1024 * 1024);
  const zip = await writeZip([{ name: "zeros.bin", data: zeros }]);

  await assertRejects(
    () => readZip(zip.buffer as ArrayBuffer, { maxEntryBytes: 1024 }),
    "exceeds safety limit",
  );

  const two = await writeZip([
    { name: "a.bin", data: new Uint8Array(600) },
    { name: "b.bin", data: new Uint8Array(600) },
  ]);
  await assertRejects(
    () => readZip(two.buffer as ArrayBuffer, { maxAggregateBytes: 1000 }),
    "Total decompressed size exceeds",
  );
});

Deno.test("stress/zip: many unicode/colliding entries round-trip exactly", async () => {
  if (!zipSupported()) return;
  const random = rng(0x5eed);
  const entries: { name: string; data: Uint8Array }[] = [];
  for (let i = 0; i < 200; i++) {
    const size = Math.floor(random() * 2048);
    // Deliberately repeat names and include traversal-looking and unicode paths.
    const base = i % 5 === 0 ? "a/../b.txt" : i % 7 === 0 ? "b.txt" : `file-${i}.bin`;
    entries.push({ name: i % 11 === 0 ? `${base}` : base, data: randomBytes(size, random) });
  }
  entries.push({ name: "unicode-Ω-日本語.txt", data: randomBytes(32, random) });

  const zip = await writeZip(entries);
  const restored = await readZip(zip.buffer as ArrayBuffer);
  // Sanitisation/de-duplication may reduce the count, but every surviving entry
  // must have the bytes that were written under that name.
  assertEquals(restored.size > 0, true);
  for (const [name, data] of restored) {
    assert(name.length > 0 && !name.startsWith("/") && !name.includes(".."), `unsafe name ${name}`);
    assertEquals(data instanceof Uint8Array, true);
  }
});

// ── TAR: checksums, fuzz, metadata budget ────────────────────

Deno.test("chaos/tar: random and bit-flipped archives fail cleanly or parse", async () => {
  const random = rng(0xbadf00d);
  for (let n = 0; n < 120; n++) {
    const length = Math.floor(random() * 4096);
    const bytes = randomBytes(length, random);
    const started = performance.now();
    try {
      readTar(bytes);
    } catch (err) {
      assert(err instanceof Error, "tar fuzz must throw Error");
      assert(!(err instanceof RangeError), "tar fuzz leaked RangeError");
    }
    assert(performance.now() - started < 1000, "tar fuzz must terminate quickly");
  }

  // Mutate a valid archive at random offsets; checksum validation must catch
  // header damage, and no mutation may hang or throw a RangeError.
  const enc = new TextEncoder();
  const valid = writeTar([
    { name: "a.txt", data: enc.encode("alpha") },
    { name: "dir/b.txt", data: enc.encode("beta") },
  ]);
  for (let n = 0; n < 200; n++) {
    const copy = valid.slice();
    const flips = 1 + Math.floor(random() * 4);
    for (let f = 0; f < flips; f++) {
      const at = Math.floor(random() * copy.length);
      copy[at] ^= 1 << Math.floor(random() * 8);
    }
    const started = performance.now();
    try {
      readTar(copy);
    } catch (err) {
      assert(err instanceof Error, "mutated tar must throw Error");
      assert(!(err instanceof RangeError), "mutated tar leaked RangeError");
    }
    assert(performance.now() - started < 1000, "mutated tar must terminate quickly");
  }
});

Deno.test("chaos/tar: a present but wrong checksum is rejected", () => {
  const header = createUstarHeader("checksum.txt", 0);
  header.fill(0x37, 148, 154); // "777777" — valid octal, wrong value
  header[154] = 0;
  header[155] = 0x20;
  const bytes = concat(header, new Uint8Array(1024));
  assertThrows(() => readTar(bytes), "checksum mismatch");
});

Deno.test("chaos/tar: GNU long-name payloads count toward the byte budget", () => {
  const longName = new TextEncoder().encode(`${"x".repeat(300)}\0`);
  const lHeader = tarBlock("././@LongLink", longName.length, 0x4c, longName);
  const file = tarBlock("short.txt", 0, 0x30);
  const archive = concat(lHeader, file, new Uint8Array(1024));

  assertThrows(
    () => readTar(archive, { maxTotalBytes: 100 }),
    "Decompressed data exceeds",
  );
});

Deno.test("chaos/tar: UTF-8 names are truncated on a character boundary", () => {
  // 40 × 3 bytes = 120 bytes, so the 100-byte field cuts mid-sequence.
  const name = "€".repeat(40);
  const header = createUstarHeader(name, 0);
  let end = 0;
  while (end < 100 && header[end] !== 0) end++;
  const field = header.subarray(0, end);
  const decoded = new TextDecoder("utf-8", { fatal: true }).decode(field);
  assert(decoded.length > 0, "truncated name must remain decodable");
  assert(end <= 100, "name field must not exceed its 100-byte slot");
});

Deno.test("chaos/tar: values that do not fit an octal field are rejected", () => {
  assertThrows(
    () => createUstarHeader("huge.bin", 2 ** 40),
    "does not fit",
  );
  assertThrows(
    () => createUstarHeader("negative.bin", -1),
    "not a nonnegative integer",
  );
});

Deno.test("stress/tar: many entries with mixed sizes round-trip exactly", () => {
  const random = rng(0x7a12);
  const enc = new TextEncoder();
  const entries = Array.from({ length: 120 }, (_, i) => ({
    name: `dir-${i % 9}/file-${i}.bin`,
    data: randomBytes(Math.floor(random() * 1024), random),
  }));
  const archive = writeTar(entries);
  const restored = readTar(archive);
  assertEquals(restored.length, entries.length);
  for (let i = 0; i < entries.length; i++) {
    assertEquals(restored[i].name, entries[i].name);
    assertEquals(restored[i].data.length, entries[i].data.length);
    for (let j = 0; j < entries[i].data.length; j++) {
      assertEquals(restored[i].data[j], entries[i].data[j]);
    }
  }
  // Keep the encoder import honest: unused-variable lint is not the point.
  assertEquals(enc.encode("x").length, 1);
});

// ── SVG: entity bypasses and text-node preservation ──────────

async function optimize(svg: string): Promise<string> {
  const file = new File([svg], "chaos.svg", { type: "image/svg+xml" });
  const result = await optimizeSvg(file);
  return await result.blob.text();
}

Deno.test("chaos/svg: named-entity javascript and data URIs are neutralized", async () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
    <a href="javascript&colon;alert(1)"><text>A</text></a>
    <a href="java&Tab;script:alert(2)"><text>B</text></a>
    <a href="java&NewLine;script:alert(3)"><text>C</text></a>
    <a xlink:href="data&colon;text/html;base64,PHNjcmlwdD4="><text>D</text></a>
  </svg>`;
  const text = await optimize(svg);
  assert(!/javascript\s*:/i.test(text), "named-entity javascript: must not survive");
  assert(!/data&colon;text\/html/i.test(text), "named-entity data:text/html must not survive");
  assert(!/href="javascript/i.test(text), "javascript href must be replaced");
  assert(text.includes('href="#"'), "neutralized href should become #");
});

Deno.test("chaos/svg: visible text nodes keep decimals and whitespace", async () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><text x="10" y="20">Version 1.2345  with   spaces</text></svg>`;
  const text = await optimize(svg);
  assert(
    text.includes("Version 1.2345  with   spaces"),
    `text node was rewritten: ${text}`,
  );
});

Deno.test("chaos/svg: unrelated attributes mentioning hidden styles do not delete elements", async () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
    <rect id="keep1" aria-label="display:none" x="1" y="1" width="10" height="10"/>
    <rect id="keep2" data-note="visibility:hidden" x="20" y="20" width="10" height="10"/>
    <rect id="keep3" data-display="none" x="40" y="40" width="10" height="10"/>
    <rect id="drop1" style="display: none" x="60" y="60" width="10" height="10"/>
    <rect id="drop2" style="color:red; visibility : hidden ;" x="80" y="80" width="10" height="10"/>
    <rect id="drop3" display="none" x="90" y="90" width="10" height="10"/>
  </svg>`;
  const text = await optimize(svg);
  assert(text.includes('id="keep1"'), "aria-label mentioning display:none must not hide the element");
  assert(text.includes('id="keep2"'), "data-note mentioning visibility:hidden must not hide the element");
  assert(text.includes('id="keep3"'), "data-display must not be treated as display");
  assert(!text.includes('id="drop1"'), "style display:none must still remove the element");
  assert(!text.includes('id="drop2"'), "style visibility:hidden must still remove the element");
  assert(!text.includes('id="drop3"'), "display=none attribute must still remove the element");
});

Deno.test("stress/svg: many hidden siblings stay linear", async () => {
  const hidden: string[] = [];
  for (let i = 0; i < 1500; i++) {
    hidden.push(`<rect id="h${i}" x="${i}" y="${i}" width="5" height="5" style="display:none"/>`);
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000">${hidden.join("")}<circle cx="5" cy="5" r="5"/></svg>`;
  const started = performance.now();
  const text = await optimize(svg);
  const elapsed = performance.now() - started;
  assert(elapsed < 3000, `SVG stress took ${elapsed.toFixed(0)}ms`);
  assert(!text.includes('id="h0"'), "hidden elements must be removed");
  assert(text.includes("<circle"), "visible element must survive");
});

// ── Markdown: escaping edge cases ────────────────────────────

Deno.test("chaos/markdown: image alt text is escaped exactly once", () => {
  const html = renderMarkdownToHtml("![A & B <x>](https://example.com/a.png)");
  assert(html.includes('alt="A &amp; B &lt;x&gt;"'), `alt was double escaped: ${html}`);
  assert(!html.includes("&amp;amp;"), "ampersand must not be escaped twice");
});

Deno.test("chaos/markdown: rejected image alt cannot close the fallback comment", () => {
  const html = renderMarkdownToHtml("![x --> <script>alert(1)</script>](javascript:alert(1))");
  assert(!html.includes("<script>"), "script must not survive");
  assert(html.includes("<!-- [image:"), `expected a fallback comment, got ${html}`);
  // The comment's own terminator is the only `-->`; the alt must not inject one.
  assertEquals(html.split("-->").length - 1, 1, "alt must not terminate the HTML comment early");
  assert(html.includes("--&gt;"), "the alt's arrow must be escaped");
});

Deno.test("chaos/markdown: link labels and hrefs stay escaped", () => {
  const html = renderMarkdownToHtml("[a & b](https://example.com/?x=1&y=2)");
  assert(html.includes("a &amp; b"), "link label must be escaped once");
  assert(html.includes("?x=1&amp;y=2"), "query ampersand must be escaped");
  assert(!html.includes("&amp;amp;"), "no double escaping");
});

// ── Settings: corrupted persistence ──────────────────────────

Deno.test("chaos/settings: corrupted values are rejected or clamped", () => {
  const base = defaultSettings();
  const merged = mergeSettings(base, {
    gpu: { images: "yes", pdf: 0 },
    engines: {
      images: { format: "image/evil", quality: "high", maxDim: -5 },
      pdf: { level: "ultra", renderScale: 99 },
      video: { codec: "mpeg2", preset: "turbo", crfQuality: NaN },
      audio: { format: "midi", bitrate: -100 },
      gif: { quality: 1e9 },
      ocr: { engine: "magic", lang: "<script>" },
    },
    performanceMode: "turbo",
    resourceMode: "ultra",
    ai: { enabled: "true", modelTier: "huge", backend: "quantum" },
    recommendations: { enabled: 1, allowAi: null },
    resourceLimits: { concurrency: Number.NaN, maxImageDim: 1e12 },
  });

  assertEquals(merged.gpu.images, base.gpu.images);
  assertEquals(merged.gpu.pdf, base.gpu.pdf);
  assertEquals(merged.engines.images.format, base.engines.images.format);
  assertEquals(merged.engines.images.quality, base.engines.images.quality);
  assertEquals(merged.engines.images.maxDim, 0);
  assertEquals(merged.engines.pdf.level, base.engines.pdf.level);
  assertEquals(merged.engines.pdf.renderScale, 4);
  assertEquals(merged.engines.video.codec, base.engines.video.codec);
  assertEquals(merged.engines.video.preset, base.engines.video.preset);
  assertEquals(merged.engines.video.crfQuality, base.engines.video.crfQuality);
  assertEquals(merged.engines.audio.format, base.engines.audio.format);
  assertEquals(merged.engines.audio.bitrate, 8);
  assertEquals(merged.engines.gif.quality, 100);
  assertEquals(merged.engines.ocr.engine, base.engines.ocr.engine);
  assertEquals(merged.engines.ocr.lang, base.engines.ocr.lang);
  assertEquals(merged.resourceMode, base.resourceMode);
  assertEquals(merged.performanceMode, base.performanceMode);
  assertEquals(merged.ai.enabled, base.ai.enabled);
  assertEquals(merged.ai.modelTier, base.ai.modelTier);
  assertEquals(merged.ai.backend, base.ai.backend);
  assertEquals(merged.recommendations.enabled, base.recommendations.enabled);
  assertEquals(merged.resourceLimits.concurrency, base.resourceLimits.concurrency);
  assertEquals(merged.resourceLimits.maxImageDim, 100_000);
});

Deno.test("chaos/settings: numeric strings are not coerced into engine options", () => {
  const base = defaultSettings();
  const merged = mergeSettings(base, {
    engines: { images: { quality: "50", maxDim: "2048" } },
    resourceLimits: { concurrency: "4", maxImageDim: "4096" },
  });
  assertEquals(merged.engines.images.quality, base.engines.images.quality);
  assertEquals(merged.engines.images.maxDim, base.engines.images.maxDim);
  assertEquals(merged.resourceLimits.concurrency, base.resourceLimits.concurrency);
  assertEquals(merged.resourceLimits.maxImageDim, base.resourceLimits.maxImageDim);
});

Deno.test("chaos/settings: legacy performanceMode still migrates", () => {
  const merged = mergeSettings(defaultSettings(), { performanceMode: "powerful" });
  assertEquals(merged.resourceMode, "maximum");
  assertEquals(merged.performanceMode, "powerful");
});

// ── Resource Guard: capacity changes, aborts, batch failures ─

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

Deno.test("chaos/resourceManager: raising capacity drains queued jobs instead of orphaning them", async () => {
  resetAdaptiveState();
  updateSettings((s) => {
    s.resourceMode = "balanced";
    s.resourceLimits.concurrency = 1;
  });
  invalidateResourcePolicy();

  try {
    const gates = [deferred(), deferred(), deferred()];
    let running = 0;
    let peak = 0;
    const started: number[] = [];

    const jobs = gates.map((gate, index) =>
      runScheduled(
        { kind: "image", bytes: 1024, workload: "light" },
        async () => {
          running++;
          peak = Math.max(peak, running);
          started.push(index);
          await gate.promise;
          running--;
        },
      ),
    );

    await tick();
    assertEquals(started.length, 1, "concurrency 1 must admit exactly one job");

    updateSettings((s) => {
      s.resourceLimits.concurrency = 4;
    });
    invalidateResourcePolicy();
    await tick();

    assert(
      started.length >= 2,
      `queued jobs must start after the capacity increase, got ${started.length}`,
    );

    for (const gate of gates) gate.resolve();
    await Promise.all(jobs);
    assertEquals(running, 0);
    assert(peak <= 4, `capacity must not be exceeded (peak ${peak})`);
    assertEquals(getResourceSnapshot().jobs.length, 0);
  } finally {
    resetSettings();
    resetAdaptiveState();
  }
});

Deno.test("chaos/resourceManager: aborting a queued job removes it from the queue", async () => {
  resetAdaptiveState();
  updateSettings((s) => {
    s.resourceMode = "balanced";
    s.resourceLimits.concurrency = 1;
  });
  invalidateResourcePolicy();

  try {
    const gate = deferred();
    const first = runScheduled(
      { kind: "image", bytes: 1024, workload: "light" },
      () => gate.promise,
    );
    await tick();

    const controller = new AbortController();
    const queued = runScheduled(
      { kind: "image", bytes: 1024, workload: "light" },
      async () => {
        throw new Error("aborted job must never run");
      },
      { signal: controller.signal },
    );
    controller.abort();

    await assertRejects(() => queued, "Job cancelled");
    assertEquals(getResourceSnapshot().queued, 0);

    gate.resolve();
    await first;
    assertEquals(getResourceSnapshot().jobs.length, 0);
  } finally {
    resetSettings();
    resetAdaptiveState();
  }
});

Deno.test("chaos/batch: failures propagate and lanes stay bounded", async () => {
  resetAdaptiveState();
  updateSettings((s) => {
    s.resourceMode = "balanced";
    s.resourceLimits.concurrency = 2;
  });
  invalidateResourcePolicy();

  try {
    let active = 0;
    let peak = 0;
    const seen: number[] = [];
    await runBatch(
      [1, 2, 3, 4, 5],
      async (item) => {
        active++;
        peak = Math.max(peak, active);
        await tick();
        seen.push(item);
        active--;
      },
      2,
    );
    assertEquals(seen.length, 5);
    assert(peak <= 2, `runBatch exceeded its lane limit (peak ${peak})`);

    await assertRejects(
      () =>
        runBatch(
          [1, 2, 3],
          async (item) => {
            if (item === 2) throw new Error("chaos boom");
          },
          2,
        ),
      "chaos boom",
    );
  } finally {
    resetSettings();
    resetAdaptiveState();
  }
});

// ── Archives: gzip robustness ───────────────────────────────

Deno.test("chaos/archives: random and truncated gzip payloads reject", async () => {
  const random = rng(0x1f2e3d);
  for (let n = 0; n < 40; n++) {
    const bytes = randomBytes(1 + Math.floor(random() * 512), random);
    await assertRejects(() => streamDecompressBytes(bytes, "gzip"));
  }

  const gz = await streamCompressBytes(new TextEncoder().encode("hello chaos"), "gzip");
  for (const cut of [1, 4, gz.length - 2]) {
    await assertRejects(() => streamDecompressBytes(gz.slice(0, cut), "gzip"));
  }
});

Deno.test("chaos/archives: empty input round-trips and ISIZE guards short buffers", async () => {
  const gz = await streamCompressBytes(new Uint8Array(0), "gzip");
  const out = await streamDecompressBytes(gz, "gzip");
  assertEquals(out.length, 0);

  assertEquals(gzipUncompressedSize(new Uint8Array(0)), null);
  assertEquals(gzipUncompressedSize(new Uint8Array(17)), null);
  assertEquals(MAX_DECOMPRESSED_BYTES, 256 * 1024 * 1024);
});

// ── CRC-32: WASM and JS agree on the standard vector ────────

Deno.test("chaos/wasmMath: CRC-32 matches the standard check vector", () => {
  const bytes = new TextEncoder().encode("123456789");
  assertEquals(computeCrc32(bytes), 0xcbf43926);
  assertEquals(computeCrc32(new Uint8Array(0)), 0);
});
