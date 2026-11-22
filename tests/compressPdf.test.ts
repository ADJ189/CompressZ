import { assertEquals, assert } from "./assert.ts";
import {
  calculateImageDrawnSizes,
  calculateEffectiveDpi,
  calculateDpiScale,
  calculateTargetQuality,
  decompressFlate,
  getPageContentText,
  MAX_PAGE_SCAN_STREAM_BYTES,
  MAX_PAGE_SCAN_TOTAL_BYTES,
} from "../src/lib/compressPdf.ts";

Deno.test("compressPdf: calculateImageDrawnSizes extracts drawn dimensions from CTM", () => {
  const stream = `
    q
    100 0 0 200 50 80 cm
    /Im1 Do
    Q
    q
    0 300 -150 0 20 40 cm
    /Im2 Do
    Q
  `;
  const drawn = calculateImageDrawnSizes(stream);
  assertEquals(drawn.has("Im1"), true);
  const im1 = drawn.get("Im1")!;
  assertEquals(im1.length, 1);
  assertEquals(Math.round(im1[0].widthPt), 100);
  assertEquals(Math.round(im1[0].heightPt), 200);

  assertEquals(drawn.has("Im2"), true);
  const im2 = drawn.get("Im2")!;
  assertEquals(im2.length, 1);
  assertEquals(Math.round(im2[0].widthPt), 300);
  assertEquals(Math.round(im2[0].heightPt), 150);
});

Deno.test("compressPdf: calculateImageDrawnSizes ignores strings and comments", () => {
  const stream = `
    % /ImFake Do
    (Some text with /ImFake Do and 100 0 0 200 0 0 cm) Tj
    q
    120 0 0 240 0 0 cm
    /ImReal Do
    Q
  `;
  const drawn = calculateImageDrawnSizes(stream);
  assertEquals(drawn.has("ImFake"), false);
  assertEquals(drawn.has("ImReal"), true);
  const imReal = drawn.get("ImReal")!;
  assertEquals(Math.round(imReal[0].widthPt), 120);
  assertEquals(Math.round(imReal[0].heightPt), 240);
});

Deno.test("compressPdf: calculateImageDrawnSizes handles TJ text arrays with [ and ] without infinite loop", () => {
  const stream = `
    BT
    /F1 12 Tf
    [(Hello) -250 (World) 100 (PDF)] TJ
    [3 2] 0 d
    ET
    q
    150 0 0 250 10 20 cm
    /ImWithTJ Do
    Q
  `;
  const drawn = calculateImageDrawnSizes(stream);
  assertEquals(drawn.has("ImWithTJ"), true);
  const im = drawn.get("ImWithTJ")!;
  assertEquals(im.length, 1);
  assertEquals(Math.round(im[0].widthPt), 150);
  assertEquals(Math.round(im[0].heightPt), 250);
});

Deno.test("compressPdf: effective DPI and dpiScale avoids blanket 300 DPI assumption", () => {
  // An image of 300x300 displayed at 300x300 points (4.17 x 4.17 inches):
  // effDpi = 300 / (300 / 72) = 72 DPI.
  // If targetDpi is 150, effDpi (72) <= targetDpi (150).
  // dpiScale MUST be 1 (no downsampling!), unlike old blanket targetDpi/300 which gave 0.5.
  const effDpi = calculateEffectiveDpi(300, 300, 300, 300);
  assertEquals(Math.round(effDpi), 72);

  const scale = calculateDpiScale(effDpi, 150);
  assertEquals(scale, 1);
});

Deno.test("compressPdf: effective DPI downsamples only when exceeding targetDpi", () => {
  // An image of 1200x1200 displayed at 144x144 points (2 x 2 inches):
  // effDpi = 1200 / (144 / 72) = 600 DPI.
  // If targetDpi is 150: dpiScale = 150 / 600 = 0.25.
  const effDpi = calculateEffectiveDpi(1200, 1200, 144, 144);
  assertEquals(Math.round(effDpi), 600);

  const scale = calculateDpiScale(effDpi, 150);
  assertEquals(scale, 0.25);
});

Deno.test("compressPdf: effective DPI falls back to page bound when displayed size unavailable", () => {
  // Page is 612 x 792 pt. max(origW, origH) = 1584.
  // Page size in inches = 792 / 72 = 11 inches.
  // effDpi = 1584 / 11 = 144 DPI.
  const effDpi = calculateEffectiveDpi(1584, 1224, undefined, undefined, 612, 792);
  assertEquals(Math.round(effDpi), 144);

  // If target is 150, 144 <= 150, so scale is 1
  const scale = calculateDpiScale(effDpi, 150);
  assertEquals(scale, 1);
});

Deno.test("compressPdf: calculateTargetQuality does not scale quality by pixel area ratio", () => {
  const baseQuality = 0.75;
  // targetSizeKB = 500, originalSize = 1000KB -> sizeRatio = 0.5
  // Downscaling from 1000x1000 to 500x500 is area ratio 0.25.
  // Old formula did: 0.75 * 0.25 = 0.1875 -> clamped to 0.2 floor!
  // New formula derives quality from target size vs original size and does not multiply by area ratio.
  const quality = calculateTargetQuality(baseQuality, 500, 1000 * 1024);
  // Quality should be based on sizeRatio (e.g. 0.75 * 0.5 = 0.375), well above the 0.2 floor
  assert(quality > 0.3, `Quality ${quality} should be above 0.3 and not crushed to 0.2 floor`);
  assertEquals(Math.round(quality * 100) / 100, 0.38);

  // If targetSizeKB is not set (<= 0), quality remains baseQuality
  const unconstrainedQuality = calculateTargetQuality(baseQuality, 0, 1000 * 1024);
  assertEquals(unconstrainedQuality, baseQuality);
});

Deno.test("compressPdf: decompressFlate respects decoded-byte limits", async () => {
  assertEquals(MAX_PAGE_SCAN_STREAM_BYTES > 0, true);
  assertEquals(MAX_PAGE_SCAN_TOTAL_BYTES > MAX_PAGE_SCAN_STREAM_BYTES, true);

  // Compress a repeated sequence
  const raw = new TextEncoder().encode("Hello world! ".repeat(1000)); // 13,000 bytes
  let compressed: Uint8Array;
  if (typeof CompressionStream !== "undefined") {
    const cs = new CompressionStream("deflate");
    const writer = cs.writable.getWriter();
    void (async () => {
      await writer.write(raw);
      await writer.close();
    })();
    const reader = cs.readable.getReader();
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    const len = chunks.reduce((s, c) => s + c.length, 0);
    compressed = new Uint8Array(len);
    let o = 0;
    for (const c of chunks) {
      compressed.set(c, o);
      o += c.length;
    }
  } else {
    return;
  }

  // Decompressing with limit of 100 bytes must cap output at 100 bytes
  const bounded = await decompressFlate(compressed, 100);
  assertEquals(bounded.length, 100);

  // Decompressing without limit (or large limit) returns all bytes
  const full = await decompressFlate(compressed, 50_000);
  assertEquals(full.length, raw.length);
});

Deno.test("compressPdf: getPageContentText stops reading when decoded-byte limit is reached", async () => {
  const item1 = {
    contents: new TextEncoder().encode("q 100 0 0 100 0 0 cm /Im1 Do Q"),
    dict: { lookup: () => null },
  };
  const item2 = {
    contents: new TextEncoder().encode("q 200 0 0 200 0 0 cm /Im2 Do Q"),
    dict: { lookup: () => null },
  };

  const mockPage = {
    node: {
      Contents: () => [item1, item2],
    },
  };
  const mockPdfDoc = {
    context: {
      obj: (v: string) => v,
      lookup: (v: any) => v,
    },
  };

  // With a limit of 25 bytes, it reads item1 up to 25 bytes and stops before item2
  const { text, bytesRead, truncated } = await getPageContentText(mockPage, mockPdfDoc, undefined, 25);
  assertEquals(bytesRead, 25);
  assertEquals(truncated, true);
  assertEquals(text.includes("/Im1"), true);
  assertEquals(text.includes("/Im2"), false);
});

Deno.test("compressPdf: production decoder path limits highly compressible Flate stream incrementally", async () => {
  // Create a highly compressible stream (e.g. 200,000 bytes repeating)
  const expanded = new TextEncoder().encode("q 100 0 0 100 0 0 cm /HugeImage Do Q\n".repeat(5000)); // ~185,000 bytes
  let compressedStream: Uint8Array;
  if (typeof CompressionStream !== "undefined") {
    const cs = new CompressionStream("deflate");
    const writer = cs.writable.getWriter();
    void (async () => {
      await writer.write(expanded);
      await writer.close();
    })();
    const reader = cs.readable.getReader();
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    const len = chunks.reduce((s, c) => s + c.length, 0);
    compressedStream = new Uint8Array(len);
    let o = 0;
    for (const c of chunks) {
      compressedStream.set(c, o);
      o += c.length;
    }
  } else {
    return;
  }

  const mockItem = {
    contents: compressedStream,
    dict: {
      lookup: () => ({ encodedName: "/FlateDecode" }),
    },
  };
  const mockPage = {
    node: {
      Contents: () => [mockItem],
    },
  };
  const mockPdfDoc = {
    context: {
      obj: (v: string) => v,
      lookup: (v: any) => v,
    },
  };

  // Decode with remaining budget of 500 bytes: must stop decoding and not expand the full 185 KB
  const cap = 500;
  const { text, bytesRead, truncated } = await getPageContentText(mockPage, mockPdfDoc, undefined, cap);
  assertEquals(bytesRead, cap);
  assertEquals(truncated, true);
  assertEquals(text.length <= cap + 10, true);
  assertEquals(text.includes("/HugeImage"), true);
});

Deno.test("compressPdf: getPageContentText handles PDFArray filter chains (ASCIIHexDecode + FlateDecode)", async () => {
  const rawText = "q 250 0 0 350 10 20 cm /TargetImage Do Q\n";
  const rawBytes = new TextEncoder().encode(rawText);

  // Compress with Flate
  let compressed: Uint8Array;
  if (typeof CompressionStream !== "undefined") {
    const cs = new CompressionStream("deflate");
    const writer = cs.writable.getWriter();
    void (async () => {
      await writer.write(rawBytes);
      await writer.close();
    })();
    const reader = cs.readable.getReader();
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    const len = chunks.reduce((s, c) => s + c.length, 0);
    compressed = new Uint8Array(len);
    let o = 0;
    for (const c of chunks) {
      compressed.set(c, o);
      o += c.length;
    }
  } else {
    return;
  }

  // Convert to ASCIIHex
  let hexString = "";
  for (let i = 0; i < compressed.length; i++) {
    hexString += compressed[i].toString(16).padStart(2, "0");
  }
  hexString += ">";
  const hexBytes = new TextEncoder().encode(hexString);

  // Real PDFArray mock matching pdf-lib structure (not a JS Array)
  class MockPDFArray {
    asArray() {
      return [{ encodedName: "/ASCIIHexDecode" }, { encodedName: "/FlateDecode" }];
    }
    get array() {
      return this.asArray();
    }
  }

  const mockItem = {
    contents: hexBytes,
    dict: {
      lookup: () => new MockPDFArray(),
    },
  };
  const mockPage = {
    node: {
      Contents: () => [mockItem],
    },
  };
  const mockPdfDoc = {
    context: {
      obj: (v: string) => v,
      lookup: (v: any) => v,
    },
  };

  const res = await getPageContentText(mockPage, mockPdfDoc);
  assertEquals(res.incomplete, false);
  assertEquals(res.truncated, false);
  assertEquals(res.text.includes("/TargetImage"), true);
});

Deno.test("compressPdf: getPageContentText marks incomplete: true on unsupported filter (e.g. ASCII85Decode)", async () => {
  const mockItem = {
    contents: new TextEncoder().encode("<~s4IA0~>"),
    dict: {
      lookup: () => ({ encodedName: "/ASCII85Decode" }),
    },
  };
  const mockPage = {
    node: {
      Contents: () => [mockItem],
    },
  };
  const mockPdfDoc = {
    context: {
      obj: (v: string) => v,
      lookup: (v: any) => v,
    },
  };

  const res = await getPageContentText(mockPage, mockPdfDoc);
  assertEquals(res.incomplete, true);
});

