/**
 * organizePdf.test.ts — Unit tests for PDF page reorganization logic.
 */

import { assertEquals } from "./assert.ts";
import {
  computeTargetSequence,
  type PageSpec,
} from "../src/lib/pdfTools/organizePdf.ts";

Deno.test("organizePdf: computeTargetSequence handles reorder, rotation, duplicates, and deletions", () => {
  const specs: PageSpec[] = [
    { id: "p1", originalIndex: 0, rotation: 90 },
    { id: "p2", originalIndex: 1, rotation: 0, deleted: true },
    { id: "p3", originalIndex: 2, rotation: 180, duplicateCount: 2 },
    { id: "blank", originalIndex: -1, rotation: 0, isBlank: true },
  ];

  const planned = computeTargetSequence(specs);

  assertEquals(planned.length, 4);
  // First item: original 0, rotated 90
  assertEquals(planned[0], { sourceIndex: 0, rotation: 90, isBlank: false });
  // Second & third items: original 2 duplicated twice, rotated 180
  assertEquals(planned[1], { sourceIndex: 2, rotation: 180, isBlank: false });
  assertEquals(planned[2], { sourceIndex: 2, rotation: 180, isBlank: false });
  // Fourth item: blank page
  assertEquals(planned[3], { sourceIndex: -1, rotation: 0, isBlank: true });
});
