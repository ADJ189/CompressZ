/**
 * securityHtml.test.ts — URL policies used before untrusted HTML reaches the
 * live DOM (see `sanitizeHtmlForRender` in `src/lib/convertOffice.ts`).
 *
 * The DOM-walking part of the sanitiser needs a real `DOMParser`, so it is
 * exercised end-to-end in the browser (and by the Playwright suite); the
 * policy predicates it relies on are pure and pinned here.
 */
import { assert } from "./assert.ts";
import {
  isSafeImageSource,
  isSafeLinkTarget,
} from "../src/lib/convertOffice.ts";

Deno.test("html sanitizer: link targets allow only web, mail and relative URLs", () => {
  const allowed = [
    "https://example.test/a?b=1",
    "http://example.test",
    "mailto:a@b.test",
    "/docs/privacy",
    "#section",
  ];
  const blocked = [
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "data:text/html,<b>",
    "vbscript:msgbox(1)",
    "//evil.test/x",
    "///evil.test/x",
    "file:///C:/Windows",
    "",
  ];

  for (const url of allowed) {
    assert(isSafeLinkTarget(url), `Expected link target to be allowed: ${url}`);
  }
  for (const url of blocked) {
    assert(!isSafeLinkTarget(url), `Expected link target to be blocked: ${url}`);
  }
});

Deno.test("html sanitizer: only inline data images are allowed to render", () => {
  const png =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";
  assert(isSafeImageSource(png), "Inline PNG data URL must be allowed");
  assert(
    isSafeImageSource("data:image/jpeg;base64,/9j/4AAQSkZJRg=="),
    "Inline JPEG data URL must be allowed",
  );

  const blocked = [
    "https://tracker.test/pixel.png",
    "http://tracker.test/pixel.png",
    "//tracker.test/pixel.png",
    "data:text/html;base64,PHNjcmlwdD4=",
    "javascript:alert(1)",
    "",
  ];
  for (const src of blocked) {
    assert(!isSafeImageSource(src), `Expected image source to be blocked: ${src}`);
  }
});
