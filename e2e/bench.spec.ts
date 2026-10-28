import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";

/**
 * Opt-in benchmark harness.
 *
 * Normal `npm run test:e2e` runs never touch this file: playwright.config.ts
 * ignores it unless BENCH is set. `npm run bench` sets BENCH=1, switches the
 * web server to `vite dev` (so the real TypeScript engine modules can be
 * imported) and writes JSON + a table to bench-results/.
 *
 * The benchmark measures the shipped `compressImage()` pipeline — not a
 * re-implementation — on deterministic synthetic images. It reports medians
 * over several runs and never asserts on timing (machines differ). It is a
 * repeatability harness, not a pass/fail performance gate.
 */

const OUT_DIR = "bench-results";

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
) as { version: string };

test.describe("image pipeline benchmark", () => {
  test.skip(
    !process.env.BENCH,
    "Opt-in benchmark — set BENCH=1 or run `npm run bench`.",
  );

  test("real compressImage throughput", async ({ page }) => {
    test.setTimeout(10 * 60_000);
    test.slow();

    await page.goto("/");

    const environment = await page.evaluate(async () => {
      const configs = [
        ["avc1.42001f", "H.264 baseline"],
        ["hvc1.1.6.L93.B0", "HEVC Main"],
        ["av01.0.04M.08", "AV1"],
        ["vp09.00.10.08", "VP9"],
        ["vp8", "VP8"],
      ] as const;
      const support: { codec: string; label: string; supported: boolean }[] = [];
      if (typeof VideoEncoder !== "undefined") {
        for (const [codec, label] of configs) {
          try {
            const result = await VideoEncoder.isConfigSupported({
              codec,
              width: 1280,
              height: 720,
              bitrate: 2_000_000,
              framerate: 30,
            });
            support.push({ codec, label, supported: !!result.supported });
          } catch {
            support.push({ codec, label, supported: false });
          }
        }
      }
      return {
        userAgent: navigator.userAgent,
        hardwareConcurrency: navigator.hardwareConcurrency,
        deviceMemoryGB: (navigator as { deviceMemory?: number }).deviceMemory ?? null,
        webCodecs: typeof VideoEncoder !== "undefined",
        videoEncoderSupport: support,
      };
    });

    const rows = await page.evaluate(async () => {
      // Vite dev serves the real TypeScript module. A variable specifier keeps
      // TypeScript from trying to resolve the browser-only URL at build time.
      const modulePath = "/src/lib/compressImage.ts";
      const mod = (await import(/* @vite-ignore */ modulePath)) as {
        compressImage: (
          file: File,
          options: Record<string, unknown>,
        ) => Promise<{ blob: Blob; width?: number; height?: number }>;
      };

      interface Result {
        label: string;
        format: string;
        maxWidth: number | null;
        medianMs: number;
        minMs: number;
        maxMs: number;
        megapixels: number;
        megapixelsPerSecond: number;
        outputKB: number;
      }

      /** Seeded, deterministic image: smooth gradient plus sparse noise. */
      function makeImage(width: number, height: number): Promise<File> {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas 2D unavailable");
        const image = ctx.createImageData(width, height);
        let seed = 0x5eed1234;
        const random = () => {
          seed = (seed * 1664525 + 1013904223) >>> 0;
          return seed / 4294967296;
        };
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            const noise = (x * 7 + y * 13) % 11 === 0 ? (random() - 0.5) * 70 : 0;
            image.data[i] = Math.max(0, Math.min(255, (x / width) * 255 + noise));
            image.data[i + 1] = Math.max(
              0,
              Math.min(255, (y / height) * 255 + noise),
            );
            image.data[i + 2] = Math.max(
              0,
              Math.min(255, 180 - (x / width) * 80 + noise),
            );
            image.data[i + 3] = 255;
          }
        }
        ctx.putImageData(image, 0, 0);
        return new Promise<File>((resolve, reject) => {
          canvas.toBlob((blob) => {
            if (!blob) {
              reject(new Error("toBlob failed"));
              return;
            }
            resolve(
              new File([blob], `bench-${width}x${height}.png`, {
                type: "image/png",
              }),
            );
          }, "image/png");
        });
      }

      const sizes = [
        { width: 1280, height: 800, label: "1280×800 (1.0 MP)" },
        { width: 2048, height: 1536, label: "2048×1536 (3.1 MP)" },
        { width: 3264, height: 2448, label: "3264×2448 (8.0 MP)" },
      ];
      const cases: {
        size: (typeof sizes)[number];
        format: "image/webp" | "image/jpeg";
        maxWidth: number | null;
      }[] = [];
      for (const size of sizes) {
        for (const format of ["image/webp", "image/jpeg"] as const) {
          cases.push({ size, format, maxWidth: null });
        }
      }
      cases.push({
        size: sizes[sizes.length - 1],
        format: "image/webp",
        maxWidth: 1920,
      });

      const results: Result[] = [];
      for (const benchCase of cases) {
        const file = await makeImage(benchCase.size.width, benchCase.size.height);
        const times: number[] = [];
        let outputBytes = 0;
        const iterations = 3;
        for (let i = 0; i < iterations; i++) {
          const started = performance.now();
          const result = await mod.compressImage(file, {
            format: benchCase.format,
            quality: 0.8,
            ...(benchCase.maxWidth ? { maxWidth: benchCase.maxWidth } : {}),
          });
          times.push(performance.now() - started);
          outputBytes = result.blob.size;
        }
        times.sort((a, b) => a - b);
        const median = times[Math.floor(times.length / 2)];
        const megapixels = (benchCase.size.width * benchCase.size.height) / 1e6;
        results.push({
          label: benchCase.size.label,
          format: benchCase.format.replace("image/", ""),
          maxWidth: benchCase.maxWidth,
          medianMs: Math.round(median),
          minMs: Math.round(times[0]),
          maxMs: Math.round(times[times.length - 1]),
          megapixels: Number(megapixels.toFixed(2)),
          megapixelsPerSecond: Number((megapixels / (median / 1000)).toFixed(2)),
          outputKB: Math.round(outputBytes / 102.4) / 10,
        });
      }
      return results;
    });

    expect(rows.length).toBeGreaterThan(0);

    mkdirSync(OUT_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const report = {
      app: "CompressZ",
      version: pkg.version,
      kind: "image-pipeline",
      createdAt: new Date().toISOString(),
      note: "Medians over 3 runs of the shipped compressImage() on deterministic 1/3.1/8 MP PNG inputs. Timing is machine-dependent; this is not a pass/fail gate.",
      environment,
      results: rows,
    };
    const target = fileURLToPath(new URL(`../${OUT_DIR}/image-${stamp}.json`, import.meta.url));
    writeFileSync(target, JSON.stringify(report, null, 2) + "\n", "utf8");

    const table = rows.map((row) => ({
      input: row.label,
      output: row.format,
      "max width": row.maxWidth ?? "source",
      "median ms": row.medianMs,
      "MP/s": row.megapixelsPerSecond,
      "output KB": row.outputKB,
    }));
    // eslint-disable-next-line no-console
    console.log(`\nCompressZ ${pkg.version} image benchmark\n`);
    // eslint-disable-next-line no-console
    console.table(table);
    // eslint-disable-next-line no-console
    console.log(`WebCodecs encoder support: ${JSON.stringify(environment.videoEncoderSupport)}\n`);
    // eslint-disable-next-line no-console
    console.log(`Wrote ${target}\n`);
  });
});
