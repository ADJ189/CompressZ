import { assertEquals, assert } from "./assert.ts";
import {
  calculateImageDrawnSizes,
  calculateEffectiveDpi,
  calculateDpiScale,
  calculateTargetQuality,
  decodeAsciiHex,
  decompressFlate,
  decompressFlateNode,
  getPageContentText,
  MAX_PAGE_SCAN_STREAM_BYTES,
  MAX_PAGE_SCAN_TOTAL_BYTES,
} from "../src/lib/compressPdf.ts";

async function compressWithDeflate(data: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === "undefined") return null;
  const cs = new CompressionStream("deflate");
  const writer = cs.writable.getWriter();
  void (async () => {
    await writer.write(data as any);
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
  const out = new Uint8Array(len);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function createMockPdfDoc() {
  return {
    context: {
      obj: (v: string) => v,
      lookup: (v: any) => v,
    },
  };
}

function createMockPageAndDoc(items: any[]) {
  const mockPage = {
    node: {
      Contents: () => items,
    },
  };
  return { mockPage, mockPdfDoc: createMockPdfDoc() };
}

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
  const compressed = await compressWithDeflate(raw);
  if (!compressed) return;

  // Decompressing with limit of 100 bytes must cap output at 100 bytes
  const bounded = await decompressFlate(compressed, 100);
  assert(bounded !== null);
  assertEquals(bounded!.length, 100);

  // Decompressing without limit (or large limit) returns all bytes
  const full = await decompressFlate(compressed, 50_000);
  assert(full !== null);
  assertEquals(full!.length, raw.length);
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

  const { mockPage, mockPdfDoc } = createMockPageAndDoc([item1, item2]);

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
  const compressedStream = await compressWithDeflate(expanded);
  if (!compressedStream) return;

  const mockItem = {
    contents: compressedStream,
    dict: {
      lookup: () => ({ encodedName: "/FlateDecode" }),
    },
  };
  const { mockPage, mockPdfDoc } = createMockPageAndDoc([mockItem]);

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
  const compressed = await compressWithDeflate(rawBytes);
  if (!compressed) return;

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
  const { mockPage, mockPdfDoc } = createMockPageAndDoc([mockItem]);

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
  const { mockPage, mockPdfDoc } = createMockPageAndDoc([mockItem]);

  const res = await getPageContentText(mockPage, mockPdfDoc);
  assertEquals(res.incomplete, true);
});

Deno.test("compressPdf: decodeAsciiHex handles valid hex and returns null on malformed content", () => {
  // Valid hex with whitespace and termination '>'
  const valid = new TextEncoder().encode(" 48 65 6c 6c 6f >");
  const decoded = decodeAsciiHex(valid, 1000);
  assert(decoded !== null);
  assertEquals(new TextDecoder().decode(decoded!), "Hello");

  // Invalid non-hexadecimal character before '>'
  const invalidChar = new TextEncoder().encode("4865ZZ6c>");
  assertEquals(decodeAsciiHex(invalidChar, 1000), null);

  // Unterminated non-empty stream (missing '>')
  const unterminated = new TextEncoder().encode("48656c6c6f");
  assertEquals(decodeAsciiHex(unterminated, 1000), null);
});

Deno.test("compressPdf: decompressFlate returns null on corrupted or invalid zlib payload", async () => {
  const corrupted = new Uint8Array([0x78, 0x9c, 0xff, 0xff, 0x00, 0x12, 0x34]);
  const result = await decompressFlate(corrupted, 1000);
  assertEquals(result, null);
});

Deno.test("compressPdf: getPageContentText marks incomplete: true when ASCIIHex or Flate decoding fails", async () => {
  // 1. Malformed ASCIIHex content stream
  const malformedHexItem = {
    contents: new TextEncoder().encode("4865ZZ>"), // invalid hex character
    dict: {
      lookup: () => ({ encodedName: "/ASCIIHexDecode" }),
    },
  };
  const { mockPage: mockPage1, mockPdfDoc: mockPdfDoc1 } = createMockPageAndDoc([malformedHexItem]);
  const res1 = await getPageContentText(mockPage1, mockPdfDoc1);
  assertEquals(res1.incomplete, true);

  // 2. Corrupted Flate stream
  const corruptedFlateItem = {
    contents: new Uint8Array([0x78, 0x9c, 0xff, 0xee, 0xdd]),
    dict: {
      lookup: () => ({ encodedName: "/FlateDecode" }),
    },
  };
  const { mockPage: mockPage2, mockPdfDoc: mockPdfDoc2 } = createMockPageAndDoc([corruptedFlateItem]);
  const res2 = await getPageContentText(mockPage2, mockPdfDoc2);
  assertEquals(res2.incomplete, true);
});

Deno.test("compressPdf: valid ASCIIHex stream exceeding cap returns prefix and counts toward budget", async () => {
  // A valid ASCIIHex stream with 760 chars (repeated 20 times) ending with '>'
  const rawChunk = "q 100 0 0 100 0 0 cm /AsciiImage Do Q\n";
  const repeated = rawChunk.repeat(20);
  let hexStr = "";
  for (let i = 0; i < repeated.length; i++) {
    hexStr += repeated.charCodeAt(i).toString(16).padStart(2, "0");
  }
  hexStr += " >";
  const hexBytes = new TextEncoder().encode(hexStr);

  // 1. Direct decodeAsciiHex with small maxBytes returns capped bytes and is not treated as null
  const cappedDecoded = decodeAsciiHex(hexBytes, 50);
  assert(cappedDecoded !== null);
  assertEquals(cappedDecoded!.length, 50);
  assertEquals(new TextDecoder().decode(cappedDecoded!).startsWith("q 100 0 0"), true);

  // 2. In getPageContentText, bytesRead must count the 50 bytes toward budget, and mark truncated & incomplete
  const mockItem = {
    contents: hexBytes,
    dict: {
      lookup: () => ({ encodedName: "/ASCIIHexDecode" }),
    },
  };
  const { mockPage, mockPdfDoc } = createMockPageAndDoc([mockItem]);
  const res = await getPageContentText(mockPage, mockPdfDoc, undefined, 50);

  assertEquals(res.bytesRead, 50);
  assertEquals(res.truncated, true);
  assertEquals(res.incomplete, true);
  assertEquals(res.text.includes("/AsciiImage"), true);
});

Deno.test("compressPdf: decompressFlateNode settles at maxBytes limit for normal and raw inflate", async () => {
  const zlib = await import("node:zlib");
  const payload = Buffer.from("q 10 0 0 10 0 0 cm /NodeFlateImage Do Q\n".repeat(100)); // ~4000 bytes

  // Normal zlib inflate
  const normalDeflated = new Uint8Array(zlib.deflateSync(payload));
  const normalResult = await decompressFlateNode(normalDeflated, 50);
  assert(normalResult !== null);
  assertEquals(normalResult!.length, 50);
  assertEquals(new TextDecoder().decode(normalResult!).startsWith("q 10 0 0"), true);

  // Raw deflate (no zlib headers)
  const rawDeflated = new Uint8Array(zlib.deflateRawSync(payload));
  const rawResult = await decompressFlateNode(rawDeflated, 50);
  assert(rawResult !== null);
  assertEquals(rawResult!.length, 50);
  assertEquals(new TextDecoder().decode(rawResult!).startsWith("q 10 0 0"), true);
});

Deno.test("compressPdf: valid ASCIIHex stream exceeding per-stream limit MAX_PAGE_SCAN_STREAM_BYTES is capped and accounted for", async () => {
  // Construct a valid ASCIIHex stream that decodes to more than the 4 MiB per-stream limit
  const decodedTargetLen = MAX_PAGE_SCAN_STREAM_BYTES + 2048;
  const hexInput = new Uint8Array(decodedTargetLen * 2 + 1);
  hexInput.fill(0x30); // Valid hex '0' digits
  hexInput[hexInput.length - 1] = 0x3e; // Terminating '>'

  // 1. decodeAsciiHex caps at MAX_PAGE_SCAN_STREAM_BYTES and marks terminated: false
  const directDecoded = decodeAsciiHex(hexInput, MAX_PAGE_SCAN_STREAM_BYTES);
  assert(directDecoded !== null);
  assertEquals(directDecoded!.length, MAX_PAGE_SCAN_STREAM_BYTES);
  assertEquals(directDecoded!.terminated, false);

  // 2. getPageContentText processes up to MAX_PAGE_SCAN_STREAM_BYTES, marks truncated & incomplete,
  // and counts all capped bytes toward the PDF budget
  const mockItem = {
    contents: hexInput,
    dict: {
      lookup: () => ({ encodedName: "/ASCIIHexDecode" }),
    },
  };
  const { mockPage, mockPdfDoc } = createMockPageAndDoc([mockItem]);
  const res = await getPageContentText(mockPage, mockPdfDoc);

  assertEquals(res.bytesRead, MAX_PAGE_SCAN_STREAM_BYTES);
  assertEquals(res.truncated, true);
  assertEquals(res.incomplete, true);
});

Deno.test("compressPdf: decodeAsciiHex distinguishes output cap from terminator and terminated streams decode cleanly", () => {
  // A stream with 5 bytes 'Hello' terminated by '>'
  const text = "48656c6c6f>";
  const bytes = new TextEncoder().encode(text);

  // Decoded with exact budget: terminated is true
  const exact = decodeAsciiHex(bytes, 5);
  assert(exact !== null);
  assertEquals(exact!.length, 5);
  assertEquals(exact!.terminated, true);

  // Decoded with cap smaller than available: terminated is false, does not fail
  const capped = decodeAsciiHex(bytes, 3);
  assert(capped !== null);
  assertEquals(capped!.length, 3);
  assertEquals(capped!.terminated, false);

  // Unterminated stream with cap larger than available: returns null (genuinely missing terminator)
  const unterminated = new TextEncoder().encode("48656c6c6f");
  const malformed = decodeAsciiHex(unterminated, 10);
  assertEquals(malformed, null);
});




