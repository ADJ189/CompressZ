import { assert, assertEquals } from "./assert.ts";

Deno.test("hallmark & anti-slop rules: CSS floor compliance", async () => {
  const css = await Deno.readTextFile("src/style.css");

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
  const pkgStr = await Deno.readTextFile("package.json");
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
  const tsconfigStr = await Deno.readTextFile("tsconfig.json");
  assert(!tsconfigStr.includes("react-jsx"), "tsconfig.json must not specify react-jsx");
});

Deno.test("anti-slop & architecture: no TSX files in src/components", async () => {
  for await (const entry of Deno.readDir("src/components")) {
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
