import { test, expect } from "@playwright/test";
import {
  naturalCompare,
  naturalOrder,
  isNaturallySorted,
  recommendFor,
} from "../src/lib/recommendations";
import { defaultSettings } from "../src/lib/settings";
import {
  estimateJob,
  isAllocationFailure,
} from "../src/lib/resourceManager";

/**
 * Pure unit tests for the deterministic rules layer and the Adaptive Resource
 * Guard estimators. These import the source modules directly, so they run in
 * Node under each configured project without needing a page. `defaultSettings()`
 * is dependency-free in a non-browser context (its auto-detection is guarded
 * by `typeof window`).
 */

const settings = defaultSettings();

test.describe("natural filename ordering", () => {
  test("compares digit runs numerically, not lexically", () => {
    expect(naturalCompare("page2.png", "page10.png")).toBeLessThan(0);
    expect(naturalCompare("page10.png", "page2.png")).toBeGreaterThan(0);
    expect(naturalCompare("page7.png", "page7.jpg")).toBe(0);
  });

  test("is case-insensitive, extension-agnostic and zero-padding aware", () => {
    expect(naturalCompare("Page 2.PNG", "page 10.jpg")).toBeLessThan(0);
    expect(naturalCompare("scan007.png", "scan7.png")).toBeGreaterThan(0);
  });

  test("naturalOrder returns stable indices and detects sorted input", () => {
    const messy = ["p10.jpg", "p2.jpg", "p1.jpg"];
    expect(naturalOrder(messy)).toEqual([2, 1, 0]);
    expect(isNaturallySorted(messy)).toBe(false);
    expect(isNaturallySorted(["p1.jpg", "p2.jpg", "p10.jpg"])).toBe(true);
    expect(naturalOrder(["b.jpg", "a.jpg", "a.jpg"])).toEqual([1, 2, 0]);
  });
});

test.describe("recommendation rules", () => {
  test("suggests a natural reorder only for 3+ numbered, unsorted files", () => {
    const recs = recommendFor(
      {
        scope: "images",
        files: [
          { name: "p10.jpg", size: 1000, type: "image/jpeg" },
          { name: "p2.jpg", size: 1000, type: "image/jpeg" },
          { name: "p1.jpg", size: 1000, type: "image/jpeg" },
        ],
      },
      settings,
    );
    const order = recs.find((r) => r.id === "order/natural");
    expect(order?.action).toEqual({ type: "reorder", order: [2, 1, 0] });
    expect(order?.reversible).toBe(true);

    expect(
      recommendFor(
        {
          scope: "images",
          files: [
            { name: "a.jpg" },
            { name: "b.jpg" },
          ],
        },
        settings,
      ),
    ).toHaveLength(0);
  });

  test("suggests WebP for photo inputs targeting PNG", () => {
    const recs = recommendFor(
      {
        scope: "images",
        files: [{ name: "photo.jpeg", size: 900, type: "image/jpeg" }],
        imageFormat: "image/png",
        imageQuality: 92,
      },
      settings,
    );
    expect(recs.map((r) => r.id)).toContain("images/photo-to-png");
    expect(recs.find((r) => r.id === "images/photo-to-png")?.action).toEqual({
      type: "image-format",
      format: "image/webp",
      quality: 90,
    });
  });

  test("suggests quality 82 only when quality is 96+", () => {
    const high = recommendFor(
      {
        scope: "images",
        files: [{ name: "graphic.png", size: 900, type: "image/png" }],
        imageFormat: "image/webp",
        imageQuality: 98,
      },
      settings,
    );
    expect(high.map((r) => r.id)).toContain("images/quality-high");

    const normal = recommendFor(
      {
        scope: "images",
        files: [{ name: "graphic.png", size: 900, type: "image/png" }],
        imageFormat: "image/webp",
        imageQuality: 82,
      },
      settings,
    );
    expect(normal.map((r) => r.id)).not.toContain("images/quality-high");
  });

  test("suggests Auto page size for a fixed Images → PDF preset", () => {
    const recs = recommendFor(
      {
        scope: "images-to-pdf",
        files: [{ name: "one.jpg", size: 10 }],
        pageSize: "a4",
      },
      settings,
    );
    expect(recs.find((r) => r.id === "images-to-pdf/page-size")?.action).toEqual({
      type: "page-size",
      pageSize: "auto",
    });
  });

  test("recommends Recommended over Extreme and for large Low inputs", () => {
    const extreme = recommendFor(
      { scope: "pdf", files: [{ name: "doc.pdf", size: 100 }], pdfLevel: "extreme" },
      settings,
    );
    expect(extreme.find((r) => r.id === "pdf/rasterised")?.action).toEqual({
      type: "pdf-level",
      level: "recommended",
    });

    const largeLow = recommendFor(
      {
        scope: "pdf",
        files: [{ name: "big.pdf", size: 9 * 1024 * 1024 }],
        pdfLevel: "low",
        pdfBytes: 9 * 1024 * 1024,
      },
      settings,
    );
    expect(largeLow.length).toBeGreaterThan(0);
    expect(largeLow[0].action.type).toBe("pdf-level");
  });

  test("routes CJK scripts to PaddleOCR and Latin to Tesseract", () => {
    const cjk = recommendFor(
      {
        scope: "ocr",
        files: [{ name: "scan.pdf", size: 100 }],
        ocrEngine: "tesseract",
        ocrScript: "cjk",
      },
      settings,
    );
    expect(cjk.find((r) => r.id === "ocr/cjk-engine")?.action).toEqual({
      type: "ocr-engine",
      engine: "paddle",
    });

    const latin = recommendFor(
      {
        scope: "ocr",
        files: [{ name: "scan.pdf", size: 100 }],
        ocrEngine: "paddle",
        ocrScript: "latin",
      },
      settings,
    );
    expect(latin.find((r) => r.id === "ocr/latin-engine")?.action).toEqual({
      type: "ocr-engine",
      engine: "tesseract",
    });
  });

  test("returns nothing when suggestions are disabled", () => {
    const disabled = defaultSettings();
    disabled.recommendations.enabled = false;
    expect(
      recommendFor(
        {
          scope: "images",
          files: [{ name: "p10.jpg" }, { name: "p2.jpg" }, { name: "p1.jpg" }],
        },
        disabled,
      ),
    ).toHaveLength(0);
  });
});

test.describe("Adaptive Resource Guard estimators", () => {
  test("classifies image, PDF, OCR and video jobs from metadata only", () => {
    expect(estimateJob({ kind: "image", bytes: 1000 }).workload).toBe("light");
    expect(estimateJob({ kind: "image", bytes: 7 * 1024 * 1024 }).workload).toBe("medium");
    expect(estimateJob({ kind: "image", pixels: 30_000_000 }).workload).toBe("heavy");

    expect(estimateJob({ kind: "pdf", pages: 2, bytes: 5000 }).workload).toBe("light");
    expect(estimateJob({ kind: "pdf", pages: 10 }).workload).toBe("medium");
    expect(estimateJob({ kind: "pdf", pages: 40 }).workload).toBe("heavy");

    expect(estimateJob({ kind: "ocr", pages: 2 }).workload).toBe("medium");
    expect(estimateJob({ kind: "ocr", pages: 25 }).workload).toBe("heavy");

    expect(estimateJob({ kind: "video", bytes: 1 }).workload).toBe("heavy");
    expect(estimateJob({ kind: "audio", durationSec: 900 }).workload).toBe("heavy");
  });

  test("lets a caller-declared workload override heuristics", () => {
    expect(estimateJob({ kind: "image", bytes: 1, workload: "heavy" }).workload).toBe("heavy");
    expect(estimateJob({ kind: "video", workload: "light" }).workload).toBe("light");
  });

  test("recognises allocation-style failures and ignores ordinary errors", () => {
    expect(isAllocationFailure(new RangeError("Invalid array length"))).toBe(true);
    expect(isAllocationFailure(new Error("out of memory"))).toBe(true);
    expect(isAllocationFailure(new Error("Cannot enlarge memory arrays"))).toBe(true);
    expect(isAllocationFailure(new Error("Invalid PDF header"))).toBe(false);
    expect(isAllocationFailure("out of memory")).toBe(false);
    expect(isAllocationFailure(null)).toBe(false);
  });
});
