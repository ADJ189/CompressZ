import { assert, assertEquals } from "./assert.ts";
import {
  isLanguageSupported,
  TESSERACT_LANGUAGES,
  PADDLE_LANGUAGES,
} from "../src/lib/ocrEngines.ts";
import {
  TROCR_MODEL_ID,
  TROCR_ESTIMATED_DOWNLOAD_MB,
} from "../src/lib/ocrHandwriting.ts";

Deno.test("ocrEngines: validates language support correctly per engine", () => {
  assert(TESSERACT_LANGUAGES.size > 20);
  assert(PADDLE_LANGUAGES.size > 0);

  // Tesseract supports broad range
  assertEquals(isLanguageSupported("tesseract", "eng"), true);
  assertEquals(isLanguageSupported("tesseract", "hin"), true);
  assertEquals(isLanguageSupported("tesseract", "ben"), true);
  assertEquals(isLanguageSupported("tesseract", "chi_sim"), true);

  // Paddle supports CJK + Latin
  assertEquals(isLanguageSupported("paddle", "chi_sim"), true);
  assertEquals(isLanguageSupported("paddle", "eng"), true);
  assertEquals(isLanguageSupported("paddle", "hin"), false);

  // TrOCR is English-only candidate
  assertEquals(isLanguageSupported("trocr", "eng"), true);
  assertEquals(isLanguageSupported("trocr", "auto"), true);
  assertEquals(isLanguageSupported("trocr", "hin"), false);
  assertEquals(isLanguageSupported("trocr", "chi_sim"), false);
});

Deno.test("ocrHandwriting: pinned candidate model and size disclosure", () => {
  assertEquals(TROCR_MODEL_ID, "Xenova/trocr-small-handwritten");
  assert(TROCR_ESTIMATED_DOWNLOAD_MB >= 100);
});
