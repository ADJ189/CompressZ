/**
 * privacy-parity.test.ts — Docs may not drift from the code.
 *
 * `AGENTS.md` requires that every storage key and every runtime CDN host is
 * documented in `PRIVACY.md` in the same change that introduces it. This test
 * enforces that mechanically so a stale privacy page fails CI instead of
 * shipping.
 *
 * Scope of the scan: `src/**\/*.{ts,svelte}` (includes the legacy `src/pages`
 * tree while it still exists).
 */
import { assert } from "./assert.ts";

const SRC_DIR = new URL("../src/", import.meta.url);
const PRIVACY_URL = new URL("../PRIVACY.md", import.meta.url);

interface SourceFile {
  path: string;
  text: string;
}

async function walk(dir: URL): Promise<URL[]> {
  const out: URL[] = [];
  for await (const entry of Deno.readDir(dir)) {
    const child = new URL(entry.name, dir);
    // Deno's DirEntry exposes these as boolean properties (not methods).
    if (entry.isDirectory) {
      out.push(...(await walk(new URL(`${entry.name}/`, dir))));
    } else if (/\.(ts|svelte)$/.test(entry.name)) {
      out.push(child);
    }
  }
  return out;
}

async function readSources(): Promise<SourceFile[]> {
  const files: SourceFile[] = [];
  for (const url of await walk(SRC_DIR)) {
    files.push({ path: url.pathname, text: await Deno.readTextFile(url) });
  }
  return files;
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

Deno.test("privacy parity: every storage key used by src is documented in PRIVACY.md", async () => {
  const sources = await readSources();
  const privacy = await Deno.readTextFile(PRIVACY_URL);

  // Keys are usually held in a `const SOMETHING_KEY = "cz-…"` so resolve those
  // first — `recents.ts` passes the value into a read/write helper.
  const keys = new Set<string>();

  // Storage keys reach `localStorage` in two shapes: as a literal, or through a
  // `const SOMETHING_KEY = "cz-…"` that is passed to a small read/write helper
  // (recents.ts). Cover both.
  for (const file of sources) {
    for (const match of file.text.matchAll(
      /\bconst\s+[A-Z0-9_]*KEY\s*=\s*["'`]([^"'`]+)["'`]/g,
    )) {
      if (/^(?:cz-|theme$)/.test(match[1])) keys.add(match[1]);
    }
    for (const match of file.text.matchAll(
      /\b(?:localStorage|sessionStorage)\.(?:getItem|setItem|removeItem)\(\s*([^,)]+)/g,
    )) {
      const arg = match[1].trim();
      const literal = arg.match(/^["'`]([^"'`]+)["'`]$/);
      if (literal) keys.add(literal[1]);
    }
  }

  // Guard against the scanner silently matching nothing (e.g. a refactor that
  // moves storage behind a wrapper): these keys are known to exist today.
  const expected = [
    "theme",
    "cz-settings-v2",
    "cz-settings-v1",
    "cz-recommendations-v1",
    "cz-recent-tools",
    "cz-favourite-tools",
    "cz-convert-profile",
    "cz-pdfsuite-profile",
  ];
  for (const key of expected) {
    assert(
      keys.has(key),
      `Scanner did not find storage key "${key}". Update the scanner if storage access was refactored.`,
    );
  }

  const undocumented = uniqueSorted(keys).filter(
    (key) => !privacy.includes(`\`${key}\``),
  );
  assert(
    undocumented.length === 0,
    `Undocumented localStorage keys — add them to PRIVACY.md §Local storage: ${undocumented.join(", ")}`,
  );
});

Deno.test("privacy parity: every CDN host used by src is documented in PRIVACY.md", async () => {
  const sources = await readSources();
  const privacy = await Deno.readTextFile(PRIVACY_URL);

  // Allowlist: project/self links and XML namespaces, not runtime asset hosts.
  const allowlist = new Set([
    "github.com",
    "compressz.pages.dev",
    "localhost",
    "127.0.0.1",
    "www.w3.org",
    "schemas.openxmlformats.org",
    "purl.org",
  ]);

  const hosts = new Set<string>();
  for (const file of sources) {
    for (const match of file.text.matchAll(/https:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)) {
      hosts.add(match[1].toLowerCase());
    }
  }

  assert(
    hosts.has("cdn.jsdelivr.net") && hosts.has("esm.sh"),
    `Scanner did not find the known CDN hosts (found: ${uniqueSorted(hosts).join(", ")}).`,
  );

  const undocumented = uniqueSorted(hosts).filter(
    (host) => !allowlist.has(host) && !privacy.toLowerCase().includes(host),
  );
  assert(
    undocumented.length === 0,
    `Undocumented CDN hosts — add them to PRIVACY.md §Third-party engines: ${undocumented.join(", ")}`,
  );
});

Deno.test("privacy parity: every lazily loaded CDN package is documented in PRIVACY.md", async () => {
  const sources = await readSources();
  const privacy = await Deno.readTextFile(PRIVACY_URL);
  const privacyLower = privacy.toLowerCase();

  // Package specifier → the name PRIVACY.md uses for that engine. Add an entry
  // here whenever a new engine is pulled from a CDN.
  const documentedAs: Record<string, string> = {
    "@ffmpeg/ffmpeg": "ffmpeg.wasm",
    "@ffmpeg/util": "ffmpeg.wasm",
    "@ffmpeg/core": "ffmpeg.wasm",
    "@expo-google-fonts/noto-sans": "noto sans",
    "@neslinesli93/qpdf-wasm": "qpdf",
    "@paddle-js-models/ocr": "paddleocr",
    "@pdf-lib/fontkit": "pdf-lib",
    "html2canvas": "html2canvas",
    "mammoth": "mammoth.js",
    "mediabunny": "mediabunny",
    "heic2any": "heic2any",
    "onnxruntime-web": "onnxruntime-web",
    "pdf-lib": "pdf-lib",
    "pdfjs-dist": "pdf.js",
    "tesseract.js": "tesseract.js",
    "tesseract.js-core": "tesseract.js",
  };

  const packages = new Set<string>();
  for (const file of sources) {
    for (const match of file.text.matchAll(
      /(?:cdn\.jsdelivr\.net\/npm|esm\.sh)\/((?:@[^/"'`\s]+\/)?[^/"'`@\s]+)/g,
    )) {
      packages.add(match[1]);
    }
  }

  assert(
    packages.size > 0,
    "Scanner did not find any CDN package URLs. Update the pattern if the loaders changed.",
  );

  const undocumented: string[] = [];
  for (const pkg of uniqueSorted(packages)) {
    const token = documentedAs[pkg] ?? pkg;
    if (!privacyLower.includes(token.toLowerCase())) undocumented.push(pkg);
  }

  assert(
    undocumented.length === 0,
    `Undocumented CDN packages — add them to PRIVACY.md §Third-party engines: ${undocumented.join(", ")}`,
  );
});
