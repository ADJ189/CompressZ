/**
 * removePagesPdf.test.ts — Unit tests for PDF page removal logic and engine.
 */

import { assertEquals, assertThrows } from "./assert.ts";
import {
  parseRemovalRange,
  formatRemovalRange,
  getEvenPageIndices,
  getOddPageIndices,
  planPageRemoval,
} from "../src/lib/pdfTools/removePagesPdf.ts";

Deno.test("removePagesPdf: parseRemovalRange parses single pages and ranges", () => {
  const result = parseRemovalRange("1, 3, 5-7", 10);
  // Pages 1, 3, 5, 6, 7 -> 0-based indices 0, 2, 4, 5, 6
  assertEquals(result, [0, 2, 4, 5, 6]);
});

Deno.test("removePagesPdf: parseRemovalRange handles whitespace and reverse ranges", () => {
  const result = parseRemovalRange("  2 - 4 ,  6 ", 10);
  assertEquals(result, [1, 2, 3, 5]);

  // Reverse range "6-4" normalized to 4, 5, 6 -> 0-based 3, 4, 5
  const reverse = parseRemovalRange("6-4", 10);
  assertEquals(reverse, [3, 4, 5]);
});

Deno.test("removePagesPdf: parseRemovalRange clamps out-of-bounds indices", () => {
  const result = parseRemovalRange("1-3, 8-12", 5);
  // Total pages is 5, so 8-12 is discarded, only 1-3 remains -> 0-based [0, 1, 2]
  assertEquals(result, [0, 1, 2]);

  const zeroOrNegative = parseRemovalRange("0, -2, 2", 5);
  // Page 0 / negative ignored, only page 2 remains -> 0-based [1]
  assertEquals(zeroOrNegative, [1]);
});

Deno.test("removePagesPdf: parseRemovalRange handles empty or invalid strings gracefully", () => {
  assertEquals(parseRemovalRange("", 5), []);
  assertEquals(parseRemovalRange("   ", 5), []);
  assertEquals(parseRemovalRange("abc, xyz", 5), []);
});

Deno.test("removePagesPdf: formatRemovalRange formats compact page strings", () => {
  assertEquals(formatRemovalRange([0]), "1");
  assertEquals(formatRemovalRange([0, 1, 2]), "1-3");
  assertEquals(formatRemovalRange([0, 2, 3, 4, 7]), "1, 3-5, 8");
  assertEquals(formatRemovalRange([]), "");
});

Deno.test("removePagesPdf: getEvenPageIndices and getOddPageIndices calculate correctly", () => {
  // 5 total pages: pages 1, 2, 3, 4, 5
  // Evens: 2, 4 -> 0-based [1, 3]
  assertEquals(getEvenPageIndices(5), [1, 3]);
  // Odds: 1, 3, 5 -> 0-based [0, 2, 4]
  assertEquals(getOddPageIndices(5), [0, 2, 4]);

  // 1 total page
  assertEquals(getEvenPageIndices(1), []);
  assertEquals(getOddPageIndices(1), [0]);
});

Deno.test("removePagesPdf: planPageRemoval plans removal of target pages", () => {
  // 5 total pages, remove "2, 4"
  const plan = planPageRemoval(5, "2, 4");
  assertEquals(plan.toRemoveIndices, [1, 3]);
  assertEquals(plan.remainingIndices, [0, 2, 4]);

  // 6 total pages, remove via Set
  const planSet = planPageRemoval(6, new Set([1, 3, 5]), true);
  assertEquals(planSet.toRemoveIndices, [1, 3, 5]);
  assertEquals(planSet.remainingIndices, [0, 2, 4]);
});

Deno.test("removePagesPdf: planPageRemoval rejects when 0 pages or all pages are selected", () => {
  // Empty input throws
  assertThrows(
    () => planPageRemoval(5, ""),
    "No valid pages were selected for removal.",
  );

  // Removing all pages throws
  assertThrows(
    () => planPageRemoval(3, "1-3"),
    "Cannot remove all 3 pages from the PDF. At least 1 page must remain.",
  );
});
