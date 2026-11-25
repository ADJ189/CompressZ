/**
 * metadataPdf.test.ts — Unit tests for PDF metadata inspection and sanitization helpers.
 */

import { assertEquals } from "./assert.ts";
import {
  sanitizeMetadataString,
  formatPdfDate,
  parseMetadataKeywords,
  updatePdfMetadata,
  readPdfMetadata,
} from "../src/lib/pdfTools/metadataPdf.ts";
import { setPdfLibForTesting, resetPdfLibForTesting } from "../src/lib/pdfLibs.ts";

Deno.test("metadata: sanitizeMetadataString strips unprintable and control codes", () => {
  assertEquals(sanitizeMetadataString("Clean Title"), "Clean Title");
  assertEquals(sanitizeMetadataString("  Spaces Around  "), "Spaces Around");
  // Null bytes and control codes
  assertEquals(sanitizeMetadataString("Hello\x00World\x08"), "HelloWorld");
  assertEquals(sanitizeMetadataString(undefined), "");
  assertEquals(sanitizeMetadataString(""), "");
});

Deno.test("metadata: formatPdfDate formats valid Dates and handles invalid dates", () => {
  const d = new Date("2026-05-15T10:30:00.000Z");
  assertEquals(formatPdfDate(d), "2026-05-15T10:30:00.000Z");

  assertEquals(formatPdfDate(undefined), undefined);
  assertEquals(formatPdfDate(new Date("invalid")), undefined);
});

Deno.test("metadata: stripAll deletes Info fields, dates, custom entries, and XMP Metadata stream", async () => {
  interface StoredMetaState {
    info: Record<string, string>;
    catalogHasMetadata: boolean;
    xmpDeletedFromContext: boolean;
    infoDeletedFromContext: boolean;
    updateMetadataArg?: boolean;
  }

  const initialState: StoredMetaState = {
    info: {
      Title: "Private Contract",
      Author: "Jane Doe",
      Subject: "NDA",
      Keywords: "secret, legal",
      Creator: "Word",
      Producer: "Acrobat",
      CreationDate: "2026-01-01T00:00:00.000Z",
      ModDate: "2026-02-01T00:00:00.000Z",
      CustomCompany: "Acme Corp",
    },
    catalogHasMetadata: true,
    xmpDeletedFromContext: false,
    infoDeletedFromContext: false,
  };

  const xmpRef = { objectNumber: 99, generationNumber: 0 };
  const infoRef = { objectNumber: 88, generationNumber: 0 };

  const mockLib = {
    PDFName: { of: (name: string) => name },
    PDFDocument: {
      load: async (bytes: Uint8Array, opts?: { updateMetadata?: boolean }) => {
        const st: StoredMetaState = JSON.parse(new TextDecoder().decode(bytes));
        st.updateMetadataArg = opts?.updateMetadata;
        const infoDict = {
          keys: () => Object.keys(st.info),
          delete: (k: string) => {
            delete st.info[k];
          },
        };
        return {
          isEncrypted: false,
          getPageCount: () => 1,
          getPages: () => [],
          getTitle: () => st.info.Title,
          getAuthor: () => st.info.Author,
          getSubject: () => st.info.Subject,
          getKeywords: () => st.info.Keywords,
          getCreator: () => st.info.Creator,
          getProducer: () => st.info.Producer,
          getCreationDate: () => (st.info.CreationDate ? new Date(st.info.CreationDate) : undefined),
          getModificationDate: () => (st.info.ModDate ? new Date(st.info.ModDate) : undefined),
          setTitle: (v: string) => { st.info.Title = v; },
          setAuthor: (v: string) => { st.info.Author = v; },
          setSubject: (v: string) => { st.info.Subject = v; },
          setKeywords: (v: string[]) => { st.info.Keywords = v.join(", "); },
          setCreator: (v: string) => { st.info.Creator = v; },
          setProducer: (v: string) => { st.info.Producer = v; },
          setModificationDate: (d: Date) => { st.info.ModDate = d.toISOString(); },
          catalog: {
            get: (k: string) => (k === "Metadata" && st.catalogHasMetadata ? xmpRef : undefined),
            delete: (k: string) => {
              if (k === "Metadata") st.catalogHasMetadata = false;
            },
          },
          context: {
            trailerInfo: Object.keys(st.info).length > 0 ? { Info: infoRef } : ({} as Record<string, unknown>),
            lookup: (ref: unknown) => (ref === infoRef ? infoDict : undefined),
            delete: (ref: unknown) => {
              if (ref === xmpRef) st.xmpDeletedFromContext = true;
              if (ref === infoRef) st.infoDeletedFromContext = true;
            },
          },
          save: async () => new TextEncoder().encode(JSON.stringify(st)),
        };
      },
    },
  };

  setPdfLibForTesting(mockLib);
  try {
    const inputBytes = new TextEncoder().encode(JSON.stringify(initialState));
    const sanitizedBytes = await updatePdfMetadata(inputBytes, {}, true);
    const parsed: StoredMetaState = JSON.parse(new TextDecoder().decode(sanitizedBytes));

    assertEquals(parsed.updateMetadataArg, false);
    assertEquals(Object.keys(parsed.info), []);
    assertEquals(parsed.catalogHasMetadata, false);
    assertEquals(parsed.xmpDeletedFromContext, true);
    assertEquals(parsed.infoDeletedFromContext, true);

    const readBack = await readPdfMetadata(sanitizedBytes);
    assertEquals(readBack.title, undefined);
    assertEquals(readBack.author, undefined);
    assertEquals(readBack.subject, undefined);
    assertEquals(readBack.keywords, undefined);
    assertEquals(readBack.creator, undefined);
    assertEquals(readBack.producer, undefined);
    assertEquals(readBack.creationDate, undefined);
    assertEquals(readBack.modificationDate, undefined);
  } finally {
    resetPdfLibForTesting();
  }
});

Deno.test("metadata: parseMetadataKeywords preserves multi-word comma-separated phrases across save and read", async () => {
  assertEquals(parseMetadataKeywords("annual report, Q4; tax filing"), [
    "annual report",
    "Q4",
    "tax filing",
  ]);
  assertEquals(parseMetadataKeywords("   "), []);

  let storedKeywords: string | undefined;
  const mockLib = {
    PDFName: { of: (name: string) => name },
    PDFDocument: {
      load: async () => ({
        isEncrypted: false,
        getPageCount: () => 1,
        getPages: () => [],
        getTitle: () => "",
        getAuthor: () => "",
        getSubject: () => "",
        getKeywords: () => storedKeywords,
        getCreator: () => "",
        getProducer: () => "",
        getCreationDate: () => undefined,
        getModificationDate: () => undefined,
        setTitle: () => {},
        setAuthor: () => {},
        setSubject: () => {},
        // Replicate real pdf-lib setKeywords behavior (joins array entries with space)
        setKeywords: (v: string[]) => {
          storedKeywords = v.join(" ");
        },
        setCreator: () => {},
        setProducer: () => {},
        setModificationDate: () => {},
        save: async () => new Uint8Array([1, 2, 3]),
      }),
    },
  };

  setPdfLibForTesting(mockLib);
  try {
    const saved = await updatePdfMetadata(new Uint8Array([1]), {
      keywords: parseMetadataKeywords("annual report, Q4"),
    });
    const reopened = await readPdfMetadata(saved);
    assertEquals(reopened.keywords, ["annual report", "Q4"]);
  } finally {
    resetPdfLibForTesting();
  }
});
