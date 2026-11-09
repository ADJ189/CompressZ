import { assert, assertEquals } from "./assert.ts";
import {
  naturalCompare,
  naturalOrder,
  isNaturallySorted,
  recommendFor,
} from "../src/lib/recommendations.ts";
import { defaultSettings } from "../src/lib/settings.ts";

const settings = defaultSettings();

Deno.test("natural filename ordering: compares digit runs numerically", () => {
  assert(naturalCompare("page2.png", "page10.png") < 0);
  assert(naturalCompare("page10.png", "page2.png") > 0);
  assertEquals(naturalCompare("page7.png", "page7.jpg"), 0);
});

Deno.test("natural filename ordering: case-insensitive & zero-padding aware", () => {
  assert(naturalCompare("Page 2.PNG", "page 10.jpg") < 0);
  assert(naturalCompare("scan007.png", "scan7.png") > 0);
});

Deno.test("natural filename ordering: naturalOrder returns stable indices", () => {
  const messy = ["p10.jpg", "p2.jpg", "p1.jpg"];
  assertEquals(naturalOrder(messy), [2, 1, 0]);
  assertEquals(isNaturallySorted(messy), false);
  assertEquals(isNaturallySorted(["p1.jpg", "p2.jpg", "p10.jpg"]), true);
  assertEquals(naturalOrder(["b.jpg", "a.jpg", "a.jpg"]), [1, 2, 0]);
});

Deno.test("recommendation rules: suggests natural reorder for 3+ numbered files", () => {
  const recs = recommendFor(
    {
      scope: "images",
      files: [
        { name: "p10.jpg", size: 1000, type: "image/jpeg" },
        { name: "p2.jpg", size: 1000, type: "image/jpeg" },
        { name: "p1.jpg", size: 1000, type: "image/jpeg" },
      ],
    },
    settings,
  );
  const order = recs.find((r) => r.id === "order/natural");
  assertEquals(order?.action, { type: "reorder", order: [2, 1, 0] });
  assertEquals(order?.reversible, true);
});

Deno.test("recommendation rules: suggests WebP for photo inputs targeting PNG", () => {
  const recs = recommendFor(
    {
      scope: "images",
      files: [{ name: "photo.jpeg", size: 900, type: "image/jpeg" }],
      imageFormat: "image/png",
      imageQuality: 92,
    },
    settings,
  );
  assert(recs.some((r) => r.id === "images/photo-to-png"));
  const match = recs.find((r) => r.id === "images/photo-to-png");
  assertEquals(match?.action, {
    type: "image-format",
    format: "image/webp",
    quality: 90,
  });
});

Deno.test("recommendation rules: suggests quality 82 only when quality is 96+", () => {
  const high = recommendFor(
    {
      scope: "images",
      files: [{ name: "graphic.png", size: 900, type: "image/png" }],
      imageFormat: "image/webp",
      imageQuality: 98,
    },
    settings,
  );
  assert(high.some((r) => r.id === "images/quality-high"));

  const normal = recommendFor(
    {
      scope: "images",
      files: [{ name: "graphic.png", size: 900, type: "image/png" }],
      imageFormat: "image/webp",
      imageQuality: 85,
    },
    settings,
  );
  assertEquals(normal.some((r) => r.id === "images/quality-high"), false);
});
