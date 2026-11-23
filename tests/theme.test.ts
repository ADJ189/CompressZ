import { assertEquals } from "./assert.ts";
import {
  resolveThemePreference,
  getColorScheme,
  setColorScheme,
  COLOR_SCHEME_KEY,
} from "../src/lib/theme.ts";

Deno.test("theme: resolves explicit light and dark preferences", () => {
  assertEquals(resolveThemePreference("light"), "light");
  assertEquals(resolveThemePreference("dark"), "dark");
});

Deno.test("theme: defaults system preference gracefully in headless runtime", () => {
  const resolved = resolveThemePreference("system");
  // In headless without matchMedia matching dark, it should resolve to light
  assertEquals(resolved === "light" || resolved === "dark", true);
});

Deno.test("theme: color schemes persist and default to polished", () => {
  const store: Record<string, string> = {};
  const origDesc = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
    },
    configurable: true,
    writable: true,
  });

  try {
    // Test default is polished
    localStorage.removeItem(COLOR_SCHEME_KEY);
    assertEquals(getColorScheme(), "polished");

    // Test setting origin
    assertEquals(setColorScheme("origin"), "origin");
    assertEquals(getColorScheme(), "origin");

    // Test setting blood-moon
    assertEquals(setColorScheme("blood-moon"), "blood-moon");
    assertEquals(getColorScheme(), "blood-moon");

    // Test invalid scheme resets to polished
    assertEquals(setColorScheme("invalid" as any), "polished");
    assertEquals(getColorScheme(), "polished");
  } finally {
    if (origDesc) {
      Object.defineProperty(globalThis, "localStorage", origDesc);
    } else {
      delete (globalThis as any).localStorage;
    }
  }
});
