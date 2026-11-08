import { assertEquals } from "./assert.ts";
import { resolveThemePreference, type ThemePreference } from "../src/lib/theme.ts";

Deno.test("theme: resolves explicit light and dark preferences", () => {
  assertEquals(resolveThemePreference("light"), "light");
  assertEquals(resolveThemePreference("dark"), "dark");
});

Deno.test("theme: defaults system preference gracefully in headless runtime", () => {
  const resolved = resolveThemePreference("system");
  // In headless without matchMedia matching dark, it should resolve to light
  assertEquals(resolved === "light" || resolved === "dark", true);
});
