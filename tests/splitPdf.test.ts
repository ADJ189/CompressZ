/**
 * splitPdf.test.ts — Unit tests for PDF splitting logic.
 */

import { assertEquals, assertThrows } from "./assert.ts";
import {
  parsePageRanges,
  planChunks,
  planBurst,
} from "../src/lib/pdfTools/splitPdf.ts";

Deno.test("splitPdf: parsePageRanges parses single pages and ranges", () => {
  const result = parsePageRanges("1, 3, 5-7", 10);
  assertEquals(result, [
    [0],
    [2],
    [4, 5, 6],
  ]);
});

Deno.test("splitPdf: parsePageRanges handles whitespace and reverse ranges", () => {
  const result = parsePageRanges("  2 - 4 ,  6 ", 10);
  assertEquals(result, [
    [1, 2, 3],
    [5],
  ]);

  // Reverse range "5-3" is normalized to 3..5
  const reverse = parsePageRanges("5-3", 10);
  assertEquals(reverse, [
    [2, 3, 4],
  ]);
});

Deno.test("splitPdf: parsePageRanges clamps out-of-bounds indices", () => {
  const result = parsePageRanges("1-3, 8-12", 5);
  // Total pages is 5, so 8-12 produces nothing, only 1-3 remains
  assertEquals(result, [
    [0, 1, 2],
  ]);
});

Deno.test("splitPdf: parsePageRanges clamps massive out-of-bounds endpoint in finite time", () => {
  // Very large endpoint (1 billion) with a 3-page PDF must resolve instantly without freezing
  const result = parsePageRanges("1-1000000000", 3);
  assertEquals(result, [
    [0, 1, 2],
  ]);

  // Out-of-bounds starting range skipped cleanly
  const partial = parsePageRanges("1-2, 500-1000000", 3);
  assertEquals(partial, [
    [0, 1],
  ]);
});

Deno.test("splitPdf: parsePageRanges throws on empty or invalid inputs", () => {
  assertThrows(() => parsePageRanges("", 5));
  assertThrows(() => parsePageRanges("   ", 5));
  assertThrows(() => parsePageRanges("abc", 5));
  assertThrows(() => parsePageRanges("2foo", 5)); // Malformed suffix rejected
  assertThrows(() => parsePageRanges("1e2", 5));  // Exponential token rejected
  assertThrows(() => parsePageRanges("10-15", 5)); // All out of bounds
});

Deno.test("splitPdf: planChunks chunks pages into even groups with remainder", () => {
  const chunks = planChunks(7, 3);
  assertEquals(chunks, [
    [0, 1, 2],
    [3, 4, 5],
    [6],
  ]);
});

Deno.test("splitPdf: planBurst plans 1 page per group", () => {
  const burst = planBurst(4);
  assertEquals(burst, [
    [0],
    [1],
    [2],
    [3],
  ]);
});
