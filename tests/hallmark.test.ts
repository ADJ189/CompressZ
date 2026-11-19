import { assert, assertEquals } from "./assert.ts";

Deno.test("hallmark & anti-slop rules: CSS floor compliance", async () => {
  const css = await Deno.readTextFile(new URL("../src/style.css", import.meta.url));

  // Rule 4: overflow-x: clip on html and body
  assert(css.includes("overflow-x: clip"), "Must have overflow-x: clip");

  // Rule 6: focus-visible ring
  assert(css.includes(":focus-visible"), "Must have focus-visible styling");

  // Rule 7: prefers-reduced-motion fallback
  assert(
    css.includes("prefers-reduced-motion: reduce"),
    "Must have prefers-reduced-motion query",
  );

  // Rule 5: overflow-wrap on headings
  assert(
    css.includes("overflow-wrap: break-word"),
    "Headings must carry overflow-wrap: break-word",
  );

  // Rule 2: never transition: all
  assert(!css.includes("transition: all"), "Must never use transition: all");
});

Deno.test("anti-slop & architecture: React and animejs removal verified", async () => {
  const pkgStr = await Deno.readTextFile(new URL("../package.json", import.meta.url));
  const pkg = JSON.parse(pkgStr);

  const allDeps = {
    ...(pkg.dependencies || {}),
    ...(pkg.devDependencies || {}),
  };

  // React completely removed
  assertEquals(allDeps["react"], undefined);
  assertEquals(allDeps["react-dom"], undefined);
  assertEquals(allDeps["@types/react"], undefined);
  assertEquals(allDeps["@types/react-dom"], undefined);

  // animejs replaced with WAAPI / Svelte transitions
  assertEquals(allDeps["animejs"], undefined);

  // Svelte added
  assert(allDeps["svelte"] !== undefined, "Svelte must be present in dependencies");

  // tsconfig.json has no react-jsx
  const tsconfigStr = await Deno.readTextFile(new URL("../tsconfig.json", import.meta.url));
  assert(!tsconfigStr.includes("react-jsx"), "tsconfig.json must not specify react-jsx");
});

Deno.test("anti-slop & architecture: no TSX files in src/components", async () => {
  for await (const entry of Deno.readDir(new URL("../src/components", import.meta.url))) {
    assert(
      !entry.name.endsWith(".tsx"),
      `Found residual React TSX file: ${entry.name}`,
    );
    assert(
      entry.name.endsWith(".svelte") || entry.name.endsWith(".ts"),
      `Unexpected non-Svelte file in components: ${entry.name}`,
    );
  }
});

Deno.test("package standards: package.json has zero deno mentions in scripts & gitignore isolates local deno", async () => {
  const pkgStr = await Deno.readTextFile(new URL("../package.json", import.meta.url));
  const pkg = JSON.parse(pkgStr);

  for (const [scriptName, scriptCmd] of Object.entries(pkg.scripts || {})) {
    assert(
      !String(scriptCmd).includes("deno"),
      `package.json script "${scriptName}" must not call deno directly (found: "${scriptCmd}")`,
    );
  }

  const gitignoreStr = await Deno.readTextFile(new URL("../.gitignore", import.meta.url));
  assert(gitignoreStr.includes("deno.json"), ".gitignore must exclude deno.json to protect Cloudflare Pages & CI");
  assert(gitignoreStr.includes("deno.lock"), ".gitignore must exclude deno.lock to protect Cloudflare Pages & CI");

  const nodeVersionStr = await Deno.readTextFile(new URL("../.node-version", import.meta.url));
  assert(nodeVersionStr.trim().length > 0, ".node-version must exist to pin Node runtime for Cloudflare Pages");
});

Deno.test("ci standards: GitHub Actions workflows are resource-efficient and non-redundant", async () => {
  const ciYml = await Deno.readTextFile(new URL("../.github/workflows/ci.yml", import.meta.url));
  const e2eYml = await Deno.readTextFile(new URL("../.github/workflows/e2e.yml", import.meta.url));
  const lhYml = await Deno.readTextFile(new URL("../.github/workflows/lighthouse.yml", import.meta.url));

  // Concurrency cancel-in-progress to avoid burning runner minutes on outdated pushes
  assert(ciYml.includes("cancel-in-progress: true"), "ci.yml must cancel in-progress runs");
  assert(e2eYml.includes("cancel-in-progress: true"), "e2e.yml must cancel in-progress runs");
  assert(lhYml.includes("cancel-in-progress: true"), "lighthouse.yml must cancel in-progress runs");

  // Valid official action pins
  for (const [name, yml] of [["ci.yml", ciYml], ["e2e.yml", e2eYml], ["lighthouse.yml", lhYml]]) {
    assert(yml.includes("actions/checkout@v4"), `${name} must use actions/checkout@v4`);
    assert(yml.includes("actions/setup-node@v4"), `${name} must use actions/setup-node@v4`);
    assert(!yml.includes("@v7"), `${name} must not reference nonexistent @v7 actions`);
  }

  // Playwright matrix efficiency: scoped browser downloads rather than installing all 3 per job
  assert(
    e2eYml.includes("${{ matrix.browser }}"),
    "e2e.yml must only install the scoped browser required for each matrix project"
  );
  assert(
    e2eYml.includes("playwright-cache"),
    "e2e.yml must cache Playwright browsers across runs"
  );
});
