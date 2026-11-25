/**
 * removePagesPdf.test.ts — Unit tests for PDF page removal logic and engine.
 */

import { assertEquals, assertThrows, assertRejects } from "./assert.ts";
import {
  parseRemovalRange,
  formatRemovalRange,
  getEvenPageIndices,
  getOddPageIndices,
  planPageRemoval,
  removePagesFromPdf,
} from "../src/lib/pdfTools/removePagesPdf.ts";
import { setPdfLibForTesting, resetPdfLibForTesting } from "../src/lib/pdfLibs.ts";

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

Deno.test("removePagesPdf: parseRemovalRange tokenizes mixed whitespace and ranges (1 3-5 regression)", () => {
  // Regression test: "1 3-5" should tokenize into "1" and "3-5"
  const result = parseRemovalRange("1 3-5", 10);
  assertEquals(result, [0, 2, 3, 4]);

  // Multiple spaces and ranges: "1   3 - 5   8"
  const multiSpace = parseRemovalRange("1   3 - 5   8", 10);
  assertEquals(multiSpace, [0, 2, 3, 4, 7]);
});

Deno.test("removePagesPdf: parseRemovalRange clamps out-of-bounds indices", () => {
  const result = parseRemovalRange("1-3, 8-12", 5);
  // Total pages is 5, so 8-12 is discarded, only 1-3 remains -> 0-based [0, 1, 2]
  assertEquals(result, [0, 1, 2]);
});

Deno.test("removePagesPdf: parseRemovalRange rejects non-positive pages and unrecognized tokens visibly", () => {
  // Non-positive page numbers throw descriptive error
  assertThrows(
    () => parseRemovalRange("0", 5),
    "Page numbers must be 1 or greater",
  );
  assertThrows(
    () => parseRemovalRange("0-3", 5),
    "Page numbers must be 1 or greater",
  );

  // Unrecognized tokens throw visibly rather than silently applying partial selection
  assertThrows(
    () => parseRemovalRange("abc, xyz", 5),
    "Unrecognized page token",
  );
  assertThrows(
    () => parseRemovalRange("1, invalid-token, 3", 5),
    "Unrecognized page token",
  );

  // Empty or whitespace strings return empty array cleanly
  assertEquals(parseRemovalRange("", 5), []);
  assertEquals(parseRemovalRange("   ", 5), []);
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

Deno.test("removePagesPdf: planPageRemoval handles 1-based indexing without collapsing [0, 1]", () => {
  // Bug fix verification: [0, 1] with zeroBased=false must NOT collapse 0 and 1 to 0.
  // 0 is invalid in 1-based, page 1 maps to index 0.
  const planArray = planPageRemoval(5, [0, 1], false);
  assertEquals(planArray.toRemoveIndices, [0]);
  assertEquals(planArray.remainingIndices, [1, 2, 3, 4]);

  const planSet = planPageRemoval(5, new Set([0, 1]), false);
  assertEquals(planSet.toRemoveIndices, [0]);
  assertEquals(planSet.remainingIndices, [1, 2, 3, 4]);

  // Valid 1-based pages [1, 3]
  const plan1Based = planPageRemoval(5, [1, 3], false);
  assertEquals(plan1Based.toRemoveIndices, [0, 2]);
  assertEquals(plan1Based.remainingIndices, [1, 3, 4]);

  // Explicit 0-based indices [0, 1]
  const plan0Based = planPageRemoval(5, [0, 1], true);
  assertEquals(plan0Based.toRemoveIndices, [0, 1]);
  assertEquals(plan0Based.remainingIndices, [2, 3, 4]);
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

// Mock document infrastructure for engine-level testing
interface MockPage {
  pageNum: number;
  content: string;
}

interface MockDocState {
  title: string;
  author: string;
  subject: string;
  bookmarks: string[];
  isEncrypted: boolean;
  formFlattened: boolean;
  formFields: { name: string; value: string; isEditable: boolean }[];
  pages: MockPage[];
  removedIndices: number[];
}

function createMockPdfDocument(state: MockDocState) {
  interface MockRef {
    objectNumber: number;
    generationNumber: number;
  }
  interface MockIndirectObj {
    entries?: () => [string, unknown][];
    dict?: { entries: () => unknown[] };
    text?: string;
  }
  const indirectObjects = new Map<string, MockIndirectObj>();
  const refFor = (id: number): MockRef => ({ objectNumber: id, generationNumber: 0 });
  const rootRef = refFor(1);
  const pagesRef = refFor(2);
  const infoRef = refFor(3);

  const rebuildTree = () => {
    indirectObjects.clear();
    const kidRefs: MockRef[] = [];
    let nextId = 10;
    const pagesDict: MockIndirectObj = {
      entries: () => [
        ["Kids", { asArray: () => kidRefs }],
      ],
    };
    const rootDict: MockIndirectObj = {
      entries: () => [["Pages", pagesRef]],
    };
    const infoDict: MockIndirectObj = {
      entries: () => [["Title", state.title]],
    };
    indirectObjects.set("1:0", rootDict);
    indirectObjects.set("2:0", pagesDict);
    indirectObjects.set("3:0", infoDict);

    for (const p of state.pages) {
      const pRef = refFor(nextId++);
      const cRef = refFor(nextId++);
      (p as MockPage & { ref?: MockRef }).ref = pRef;
      kidRefs.push(pRef);
      indirectObjects.set(`${pRef.objectNumber}:0`, {
        entries: () => [["Contents", cRef]],
      });
      indirectObjects.set(`${cRef.objectNumber}:0`, {
        dict: { entries: () => [] },
        text: p.content,
      });
    }
  };
  rebuildTree();

  return {
    isEncrypted: state.isEncrypted,
    getPageCount: () => state.pages.length,
    getTitle: () => state.title,
    getAuthor: () => state.author,
    getSubject: () => state.subject,
    getBookmarks: () => [...state.bookmarks],
    getPages: () => [...state.pages],
    getPage: (idx: number) => state.pages[idx],
    removePage: (idx: number) => {
      const [removed] = state.pages.splice(idx, 1);
      state.removedIndices.push(idx);
      // Remove from Kids in Pages tree (just like pdf-lib removePage leaves page/contents orphaned)
      const pagesDict = indirectObjects.get("2:0");
      if (pagesDict?.entries && removed) {
        const removedRef = (removed as MockPage & { ref?: MockRef }).ref;
        if (removedRef) {
          const kidsWrapper = pagesDict.entries()[0][1] as { asArray: () => MockRef[] };
          const kidsEntry = kidsWrapper.asArray();
          const kIdx = kidsEntry.findIndex(
            (r) => r.objectNumber === removedRef.objectNumber,
          );
          if (kIdx >= 0) kidsEntry.splice(kIdx, 1);
        }
      }
    },
    context: {
      trailerInfo: { Root: rootRef, Info: infoRef },
      lookup: (ref: MockRef) => indirectObjects.get(`${ref.objectNumber}:${ref.generationNumber ?? 0}`),
      enumerateIndirectObjects: () =>
        Array.from(indirectObjects.entries()).map(([k, v]) => {
          const [objNum, genNum] = k.split(":").map(Number);
          return [refFor(objNum), v, genNum] as [MockRef, MockIndirectObj, number];
        }),
      delete: (ref: MockRef) => {
        indirectObjects.delete(`${ref.objectNumber}:${ref.generationNumber ?? 0}`);
      },
    },
    getForm: () => ({
      getFields: () => state.formFields,
      flatten: () => {
        state.formFlattened = true;
        for (const f of state.formFields) {
          f.isEditable = false;
        }
      },
    }),
    save: async () => {
      const serialized = {
        ...state,
        retainedIndirectObjects: Array.from(indirectObjects.values())
          .map((v) => v.text)
          .filter(Boolean),
      };
      return new TextEncoder().encode(JSON.stringify(serialized));
    },
  };
}

function createMockPdfLib() {
  return {
    PDFDocument: {
      load: async (bytes: Uint8Array, _options?: unknown) => {
        const text = new TextDecoder().decode(bytes);
        const state: MockDocState = JSON.parse(text);
        return createMockPdfDocument(state);
      },
    },
  };
}

Deno.test("removePagesPdf: removePagesFromPdf removes target pages in-place and preserves metadata and forms", async () => {
  const initialDocState: MockDocState = {
    title: "Quarterly Financial Report",
    author: "CompressZ Team",
    subject: "Audit 2026",
    bookmarks: ["Cover", "Balance Sheet", "Disclosures"],
    isEncrypted: false,
    formFlattened: false,
    formFields: [{ name: "ApprovedBy", value: "CFO", isEditable: true }],
    pages: [
      { pageNum: 1, content: "Page 1 - Executive Summary" },
      { pageNum: 2, content: "Page 2 - Confidential Draft" },
      { pageNum: 3, content: "Page 3 - Balance Sheet" },
    ],
    removedIndices: [],
  };

  const initialBytes = new TextEncoder().encode(JSON.stringify(initialDocState));
  const mockLib = createMockPdfLib();
  setPdfLibForTesting(mockLib);

  try {
    // Remove Page 2 (1-based: "2") with default flattenForms: false
    let progressCalls = 0;
    const result = await removePagesFromPdf(initialBytes, {
      pagesToRemove: "2",
      onProgress: (pct) => {
        progressCalls++;
        assertEquals(pct >= 0 && pct <= 100, true);
      },
    });

    assertEquals(result.removedCount, 1);
    assertEquals(result.remainingCount, 2);
    assertEquals(result.removedPages, [2]);
    assertEquals(result.remainingPages, [1, 3]);
    assertEquals(progressCalls > 0, true);

    // Reopen the result bytes and verify contents, metadata, and form fields
    const reopenedDoc = await mockLib.PDFDocument.load(result.bytes);
    assertEquals(reopenedDoc.getPageCount(), 2);

    const pages = reopenedDoc.getPages();
    assertEquals(pages[0].content, "Page 1 - Executive Summary");
    assertEquals(pages[1].content, "Page 3 - Balance Sheet");

    // Verify document-level properties are preserved
    assertEquals(reopenedDoc.getTitle(), "Quarterly Financial Report");
    assertEquals(reopenedDoc.getAuthor(), "CompressZ Team");
    assertEquals(reopenedDoc.getSubject(), "Audit 2026");
    assertEquals(reopenedDoc.getBookmarks(), ["Cover", "Balance Sheet", "Disclosures"]);

    // Verify form fields remain editable by default
    const form = reopenedDoc.getForm();
    const fields = form.getFields();
    assertEquals(fields.length, 1);
    assertEquals(fields[0].isEditable, true);
    assertEquals(fields[0].value, "CFO");
  } finally {
    resetPdfLibForTesting();
  }
});

Deno.test("removePagesPdf: removePagesFromPdf flattens forms when flattenForms is true", async () => {
  const initialDocState: MockDocState = {
    title: "Interactive Form",
    author: "Legal Dept",
    subject: "NDA",
    bookmarks: [],
    isEncrypted: false,
    formFlattened: false,
    formFields: [{ name: "Signature", value: "John Doe", isEditable: true }],
    pages: [
      { pageNum: 1, content: "Page 1 - Agreement" },
      { pageNum: 2, content: "Page 2 - Signature Block" },
    ],
    removedIndices: [],
  };

  const initialBytes = new TextEncoder().encode(JSON.stringify(initialDocState));
  const mockLib = createMockPdfLib();
  setPdfLibForTesting(mockLib);

  try {
    // Remove Page 1 with explicit flattenForms: true
    const result = await removePagesFromPdf(initialBytes, {
      pagesToRemove: [1], // 1-based: remove page 1
      flattenForms: true,
    });

    assertEquals(result.remainingCount, 1);

    // Reopen result and assert form fields are flattened
    const reopened = await mockLib.PDFDocument.load(result.bytes);
    const form = reopened.getForm();
    const fields = form.getFields();
    assertEquals(fields[0].isEditable, false);
  } finally {
    resetPdfLibForTesting();
  }
});

Deno.test("removePagesPdf: removePagesFromPdf rejects encrypted PDFs with clear security error", async () => {
  const encryptedDocState: MockDocState = {
    title: "Locked Doc",
    author: "Admin",
    subject: "Secret",
    bookmarks: [],
    isEncrypted: true, // Encrypted!
    formFlattened: false,
    formFields: [],
    pages: [{ pageNum: 1, content: "Secret Page" }, { pageNum: 2, content: "Secret Page 2" }],
    removedIndices: [],
  };

  const initialBytes = new TextEncoder().encode(JSON.stringify(encryptedDocState));
  const mockLib = createMockPdfLib();
  setPdfLibForTesting(mockLib);

  try {
    await assertRejects(
      async () => {
        await removePagesFromPdf(initialBytes, {
          pagesToRemove: "1",
        });
      },
      "encrypted",
    );
  } finally {
    resetPdfLibForTesting();
  }
});

Deno.test("removePagesPdf: pruned indirect objects exclude removed page unique text from output bytes", async () => {
  const uniqueSecret = "UNIQUE_CONFIDENTIAL_PAGE2_TOKEN_98765";
  const initialDocState: MockDocState = {
    title: "Secret Purge Test",
    author: "QA",
    subject: "Pruning",
    bookmarks: [],
    isEncrypted: false,
    formFlattened: false,
    formFields: [],
    pages: [
      { pageNum: 1, content: "Retained Page 1 Text" },
      { pageNum: 2, content: uniqueSecret },
      { pageNum: 3, content: "Retained Page 3 Text" },
    ],
    removedIndices: [],
  };

  const initialBytes = new TextEncoder().encode(JSON.stringify(initialDocState));
  const mockLib = createMockPdfLib();
  setPdfLibForTesting(mockLib);

  try {
    const result = await removePagesFromPdf(initialBytes, {
      pagesToRemove: "2",
    });

    const rawOutput = new TextDecoder().decode(result.bytes);
    assertEquals(rawOutput.includes(uniqueSecret), false);
    assertEquals(rawOutput.includes("Retained Page 1 Text"), true);
    assertEquals(rawOutput.includes("Retained Page 3 Text"), true);

    const reopened = await mockLib.PDFDocument.load(result.bytes);
    assertEquals(reopened.getPageCount(), 2);
  } finally {
    resetPdfLibForTesting();
  }
});
