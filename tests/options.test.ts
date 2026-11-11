import { assert, assertEquals } from "./assert.ts";
import {
  PDF_PAGE_SIZES,
  audioOptions,
  gifOptions,
  imageOptions,
  imagesToPdfOptions,
  pdfOptions,
  pdfPageSize,
  qualityToUnit,
  videoOptions,
  videoQualityFromCrf,
  videoCrfFromQuality,
} from "../src/lib/options.ts";
import {
  extensionForMime,
  getOutputExtension,
  outputFilename,
} from "../src/lib/types.ts";

Deno.test("options: quality percentages map to the engines' 0–1 range", () => {
  assertEquals(qualityToUnit(82), 0.82);
  assertEquals(qualityToUnit(100), 0.99);
  assertEquals(qualityToUnit(1), 0.01);
  assertEquals(qualityToUnit(Number.NaN), 0.82);
});

Deno.test("options: image quality, maxDim and target-size mode", () => {
  const quality = imageOptions({
    quality: 82,
    format: "image/webp",
    maxDim: 1600,
  });
  assertEquals(quality.quality, 0.82);
  assertEquals(quality.maxWidth, 1600);
  assertEquals(quality.maxHeight, 1600);
  assertEquals(quality.format, "image/webp");

  const targeted = imageOptions({
    quality: 82,
    format: "image/jpeg",
    mode: "targetSize",
    targetSizeKB: 240,
  });
  assertEquals(targeted.targetSizeKB, 240);
  assertEquals(targeted.quality, undefined);
});

Deno.test("options: audio uses engine keys, not UI keys", () => {
  const actual = audioOptions({
    fmt: "flac",
    bitrate: 320,
    sampleRate: 44100,
    stripMeta: true,
    passthrough: true,
  });
  assertEquals(actual.audioFormat, "flac");
  assertEquals(actual.audioBitrate, 320);
  assertEquals(actual.audioSampleRate, 44100);
  assertEquals(actual.stripMetadata, true);
  assertEquals(actual.audioPassthrough, true);
  assertEquals((actual as Record<string, unknown>).format, undefined);
  assertEquals((actual as Record<string, unknown>).bitrate, undefined);
});

Deno.test("options: video mode selects one rate control and keeps codec/preset", () => {
  const crf = videoOptions({
    mode: "crf",
    crfQuality: 75,
    bitrate: 2000,
    targetSizeMB: 8,
    codec: "h264",
    preset: "fast",
    maxWidth: 1280,
    fps: 30,
  });
  assertEquals(crf.quality, 0.75);
  assertEquals(crf.videoCodec, "h264");
  assertEquals(crf.videoPreset, "fast");
  assertEquals(crf.videoBitrate, undefined);
  assertEquals(crf.targetSizeKB, undefined);
  assertEquals(crf.maxWidth, 1280);
  assertEquals(crf.fps, 30);

  const bitrate = videoOptions({
    mode: "bitrate",
    crfQuality: 75,
    bitrate: 2000,
    targetSizeMB: 8,
    codec: "vp9",
    preset: "medium",
  });
  assertEquals(bitrate.videoBitrate, 2_000_000);
  assertEquals(bitrate.quality, undefined);

  const target = videoOptions({
    mode: "targetSize",
    crfQuality: 75,
    bitrate: 2000,
    targetSizeMB: 8,
    codec: "av1",
    preset: "slow",
    tenBit: true,
    audioPassthrough: true,
    audioDownmix: true,
    audioTrackMode: "all",
    subtitleMode: "all",
  });
  assertEquals(target.targetSizeKB, 8192);
  assertEquals(target.videoTenBit, true);
  assertEquals(target.audioPassthrough, true);
  assertEquals(target.audioDownmixStereo, undefined);
  assertEquals(target.audioTrackMode, "all");
  assertEquals(target.subtitleMode, "all");
});

Deno.test("options: 10-bit is only offered to h265/av1", () => {
  const h264 = videoOptions({
    mode: "crf",
    crfQuality: 75,
    bitrate: 0,
    targetSizeMB: 0,
    codec: "h264",
    preset: "fast",
    tenBit: true,
  });
  assertEquals(h264.videoTenBit, undefined);
});

Deno.test("options: PDF level and metadata intent", () => {
  assertEquals(pdfOptions({ level: "extreme" }), {
    pdfCompressionLevel: "extreme",
  });
  assertEquals(pdfOptions({ level: "low", stripMeta: "on" }), {
    pdfCompressionLevel: "low",
    stripMetadata: true,
  });
  assertEquals(pdfOptions({ level: "recommended", stripMeta: "off" }), {
    pdfCompressionLevel: "recommended",
    stripMetadata: false,
  });
  assertEquals(pdfOptions({ level: "recommended", stripMeta: "auto" }), {
    pdfCompressionLevel: "recommended",
  });
});

Deno.test("options: GIF quality feeds a valid palette size", () => {
  const gif = gifOptions({
    quality: 82,
    gifToVideo: true,
    maxWidth: 720,
    fps: 15,
  });
  assertEquals(gif.quality, 0.82);
  assertEquals(gif.gifToVideo, true);
  assertEquals(gif.maxWidth, 720);
  assertEquals(gif.fps, 15);

  // compressGif.ts turns quality into palettegen's max_colors.
  const colors = Math.round(16 + (gif.quality ?? 0) * 240);
  assert(
    colors > 1 && colors <= 256,
    `palette colours must stay within FFmpeg's 256 limit, got ${colors}`,
  );
});

Deno.test("options: Images → PDF page-size id becomes PDF points", () => {
  assertEquals(pdfPageSize("auto"), undefined);
  assertEquals(pdfPageSize("a4"), PDF_PAGE_SIZES.a4);
  assertEquals(pdfPageSize("letter"), { w: 612, h: 792 });

  const auto = imagesToPdfOptions({
    pageSize: "auto",
    quality: 82,
    maxDim: 0,
  });
  assertEquals(auto, { quality: 0.82 });

  const fixed = imagesToPdfOptions({
    pageSize: "a4",
    quality: 82,
    maxDim: 2400,
  });
  assertEquals(fixed.quality, 0.82);
  assertEquals(fixed.pageSize, { w: 595.28, h: 841.89 });
  assertEquals(fixed.maxDim, 2400);
});

Deno.test("types: extension follows the actual blob MIME type", () => {
  assertEquals(extensionForMime("image/webp"), "webp");
  assertEquals(extensionForMime("audio/ogg; codecs=opus"), "ogg");
  assertEquals(extensionForMime("video/webm;codecs=vp9"), "webm");
  assertEquals(extensionForMime("audio/mp4"), "m4a");
  assertEquals(extensionForMime("application/zip"), "zip");
  assertEquals(extensionForMime(""), null);

  const avifFallback = new Blob([], { type: "image/webp" });
  assertEquals(
    getOutputExtension({
      blob: avifFallback,
      originalSize: 1,
      compressedSize: 1,
      compressionRatio: 1,
      format: "AVIF requested",
    }),
    "webp",
  );
});

Deno.test("types: download names never mislabel the output", () => {
  const webm = new Blob([], { type: "video/webm" });
  assertEquals(outputFilename("loop.gif", webm, { suffix: "-compressed" }), "loop-compressed.webm");

  const zip = new Blob([], { type: "application/zip" });
  assertEquals(outputFilename("report.pdf", zip, { suffix: "-images" }), "report-images.zip");

  const m4a = new Blob([], { type: "audio/mp4" });
  assertEquals(outputFilename("song.wav", m4a, { suffix: "-compressed" }), "song-compressed.m4a");

  const opaque = new Blob([], { type: "" });
  assertEquals(
    outputFilename("doc.docx", opaque, { suffix: "-converted", fallbackExt: "html" }),
    "doc-converted.html",
  );
});

Deno.test("options: video CRF slider endpoints preserve quality direction and defaults", () => {
  const options = (crfQuality: number) => videoOptions({
    mode: "crf", crfQuality, bitrate: 2000, targetSizeMB: 8,
    codec: "h264", preset: "fast",
  });
  assertEquals(options(videoQualityFromCrf(16)).quality, 0.99);
  assertEquals(options(videoQualityFromCrf(38)).quality, 0.01);
  assertEquals(options(75).quality, 0.75);
  assertEquals(videoCrfFromQuality(75), 22);
});
