/**
 * securityCsp.test.ts — the two copies of the Content-Security-Policy must not
 * drift apart.
 *
 * `public/_headers` is what Cloudflare Pages serves in production;
 * `vite.config.ts` re-declares the same policy for the dev (Report-Only) and
 * preview (enforcing) servers. A divergence here means the policy being
 * tested locally is not the policy that ships, which is worse than no test.
 */
import { assert, assertEquals } from "./assert.ts";

const HEADERS_URL = new URL("../public/_headers", import.meta.url);
const VITE_URL = new URL("../vite.config.ts", import.meta.url);

/** Collapse the whitespace a multi-line header directive may contain. */
function normalise(policy: string): string {
  return policy
    .replace(/\\\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s*;\s*/g, "; ")
    .replace(/;\s*$/, "")
    .trim();
}

Deno.test("security: CSP in public/_headers matches vite.config.ts", async () => {
  const headers = await Deno.readTextFile(HEADERS_URL);
  const vite = await Deno.readTextFile(VITE_URL);

  const fromHeaders = headers.match(/Content-Security-Policy:(.+)/)?.[1];
  assert(fromHeaders, "public/_headers must declare a Content-Security-Policy");

  // vite.config.ts keeps the policy as a `[...].join("; ")` array.
  const arrayMatch = vite.match(/const CSP = \[([\s\S]*?)\]\.join\("; "\)/);
  assert(arrayMatch, "vite.config.ts must keep the CSP in a `const CSP = [...]` array");

  const directives = [...arrayMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert(directives.length > 5, "CSP array looks empty");

  assertEquals(
    normalise(fromHeaders),
    normalise(directives.join("; ")),
    "CSP differs between public/_headers and vite.config.ts — update both",
  );
});

Deno.test("security: CSP locks down the dangerous directives", async () => {
  const headers = await Deno.readTextFile(HEADERS_URL);
  const csp = headers.match(/Content-Security-Policy:(.+)/)?.[1] ?? "";

  for (const directive of [
    "default-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ]) {
    assert(csp.includes(directive), `CSP is missing \`${directive}\``);
  }

  assert(
    !/script-src[^;]*'unsafe-inline'/.test(csp),
    "script-src must not allow 'unsafe-inline'",
  );
  assert(
    !/script-src[^;]*\*/.test(csp),
    "script-src must not allow a wildcard origin",
  );

  assert(
    headers.includes("Strict-Transport-Security:"),
    "public/_headers must send HSTS",
  );
  assert(
    headers.includes("Cross-Origin-Resource-Policy: same-origin"),
    "public/_headers must send a CORP header",
  );
});
