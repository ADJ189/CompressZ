#!/usr/bin/env node
/**
 * scripts/test.mjs — Unified test runner for CompressZ.
 *
 * Runs all unit and compliance tests under Node.js / npm (canonical for CI and GitHub)
 * as well as Deno (for local offline development).
 *
 * Zero external runtime dependencies: uses TypeScript (already in devDependencies)
 * and Node's built-in APIs.
 */
import { readdir, readFile, mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT_DIR = fileURLToPath(new URL("..", import.meta.url));
const TEST_DIR = join(ROOT_DIR, "test");

// If running directly inside Deno CLI, delegate to native `deno test`
if (typeof Deno !== "undefined" && !process.env.FORCE_NODE_RUNNER) {
  const cmd = new Deno.Command(Deno.execPath(), {
    args: ["test", "--allow-read", "--unstable-sloppy-imports", TEST_DIR],
    cwd: ROOT_DIR,
    stdout: "inherit",
    stderr: "inherit",
  });
  const { code } = await cmd.output();
  if (code !== 0) {
    if (typeof process !== "undefined" && process.exit) {
      process.exit(code);
    } else {
      Deno.exit(code);
    }
  }
  if (typeof process !== "undefined" && process.exit) {
    process.exit(0);
  } else {
    Deno.exit(0);
  }
}

// Running under Node.js:
// 1. Polyfill Deno runtime namespace used by unit tests
const testQueue = [];

const denoShim = {
  test: (nameOrFn, fn) => {
    let name = "anonymous test";
    let testFn = fn;
    if (typeof nameOrFn === "string") {
      name = nameOrFn;
    } else if (typeof nameOrFn === "function") {
      testFn = nameOrFn;
      name = nameOrFn.name || "anonymous test";
    } else if (typeof nameOrFn === "object" && nameOrFn !== null) {
      name = nameOrFn.name || "anonymous test";
      testFn = nameOrFn.fn || fn;
    }
    testQueue.push({ name, fn: testFn });
  },
  readTextFile: async (filePath) => {
    let full = filePath instanceof URL ? fileURLToPath(filePath) : resolve(ROOT_DIR, filePath);
    if (full.includes(".test-dist")) {
      full = full.replace(/[/\\]\.test-dist([/\\])?/, "$1");
    }
    return await readFile(full, "utf-8");
  },
  readDir: async function* (dirPath) {
    let full = dirPath instanceof URL ? fileURLToPath(dirPath) : resolve(ROOT_DIR, dirPath);
    if (full.includes(".test-dist")) {
      full = full.replace(/[/\\]\.test-dist([/\\])?/, "$1");
    }
    const entries = await readdir(full, { withFileTypes: true });
    for (const entry of entries) {
      yield {
        name: entry.name,
        isFile: entry.isFile(),
        isDirectory: entry.isDirectory(),
        isSymlink: entry.isSymbolicLink(),
      };
    }
  },
};

if (typeof globalThis.Deno === "undefined") {
  globalThis.Deno = denoShim;
} else if (process.env.FORCE_NODE_RUNNER) {
  try {
    Object.defineProperty(globalThis, "Deno", {
      value: {
        ...globalThis.Deno,
        test: denoShim.test,
        readTextFile: denoShim.readTextFile,
        readDir: denoShim.readDir,
      },
      configurable: true,
      writable: true,
    });
  } catch {
    try {
      Deno.test = denoShim.test;
      Deno.readTextFile = denoShim.readTextFile;
      Deno.readDir = denoShim.readDir;
    } catch {
      // ignore
    }
  }
}

// 2. Transpile TS modules using the installed typescript package
const ts = await import("../node_modules/typescript/lib/typescript.js").then(
  (m) => m.default || m,
);

const CACHE_DIR = join(ROOT_DIR, ".test-dist");
await rm(CACHE_DIR, { recursive: true, force: true });
await mkdir(CACHE_DIR, { recursive: true });

function fixImports(code) {
  // Fix extensionless relative imports: from './foo' -> from './foo.js'
  // and from './foo.ts' -> from './foo.js'
  return code.replace(
    /\bfrom\s+(['"])(\.\.?\/[^'"]+)\1/g,
    (_match, quote, relPath) => {
      let target = relPath;
      if (target.endsWith(".ts")) {
        target = target.slice(0, -3) + ".js";
      } else if (!target.endsWith(".js") && !target.endsWith(".json")) {
        target = target + ".js";
      }
      return `from ${quote}${target}${quote}`;
    },
  );
}

async function transpileFile(srcPath, outPath) {
  const content = await readFile(srcPath, "utf-8");
  const transpiled = ts.transpileModule(content, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ESNext,
      isolatedModules: true,
      esModuleInterop: true,
    },
  });
  const fixed = fixImports(transpiled.outputText);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, fixed, "utf-8");
}

try {
  // Transpile src/lib
  const srcLibDir = join(ROOT_DIR, "src", "lib");
  const libEntries = await readdir(srcLibDir);
  for (const entry of libEntries) {
    if (entry.endsWith(".ts")) {
      await transpileFile(
        join(srcLibDir, entry),
        join(CACHE_DIR, "src", "lib", entry.replace(/\.ts$/, ".js")),
      );
    }
  }

  // Transpile test files
  const testEntries = await readdir(TEST_DIR);
  const testSuites = [];
  for (const entry of testEntries) {
    if (entry.endsWith(".ts")) {
      const outPath = join(CACHE_DIR, "test", entry.replace(/\.ts$/, ".js"));
      await transpileFile(join(TEST_DIR, entry), outPath);
      if (entry.endsWith(".test.ts")) {
        testSuites.push({ name: entry, outPath });
      }
    }
  }

  testSuites.sort((a, b) => a.name.localeCompare(b.name));

  console.log(`\nRunning ${testSuites.length} test suites with Node test runner...\n`);

  let passed = 0;
  let failed = 0;
  const startTime = Date.now();

  for (const suite of testSuites) {
    const fileUrl = pathToFileURL(suite.outPath).href;
    await import(fileUrl);
    const suiteTests = testQueue.splice(0, testQueue.length);

    console.log(`Suite: test/${suite.name} (${suiteTests.length} tests)`);
    for (const t of suiteTests) {
      try {
        await t.fn();
        console.log(`  ✓ ${t.name}`);
        passed++;
      } catch (err) {
        console.error(`  ✗ ${t.name}`);
        console.error(`    ${err.stack || err.message}`);
        failed++;
      }
    }
  }

  const duration = Date.now() - startTime;
  console.log(`\nTest results: ${passed} passed, ${failed} failed (${duration}ms).\n`);

  if (failed > 0) {
    process.exit(1);
  }
} finally {
  await rm(CACHE_DIR, { recursive: true, force: true });
}
