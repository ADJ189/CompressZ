import { assert, assertEquals } from "./assert.ts";
import {
  estimateJob,
  isAllocationFailure,
} from "../src/lib/resourceManager.ts";

Deno.test("resourceManager: estimates weight properly for image jobs", () => {
  const job = estimateJob({
    kind: "image",
    label: "test.png",
    bytes: 2 * 1024 * 1024,
    pixels: 1920 * 1080,
  });
  assertEquals(job.workload, "light");
  assert(job.level !== undefined);
});

Deno.test("resourceManager: routes heavy jobs (video/ocr) to heavy workload", () => {
  const vidJob = estimateJob({
    kind: "video",
    label: "test.mp4",
    bytes: 50 * 1024 * 1024,
  });
  assertEquals(vidJob.workload, "heavy");

  const ocrJobMedium = estimateJob({
    kind: "ocr",
    label: "doc.pdf",
    pages: 5,
  });
  assertEquals(ocrJobMedium.workload, "medium");

  const ocrJobHeavy = estimateJob({
    kind: "ocr",
    label: "large-doc.pdf",
    pages: 30,
  });
  assertEquals(ocrJobHeavy.workload, "heavy");
});

Deno.test("resourceManager: allocation failure detection recognizes OOM and quota errors", () => {
  assertEquals(isAllocationFailure(new Error("Out of memory")), true);
  assertEquals(isAllocationFailure(new Error("Array buffer allocation failed")), true);
  assertEquals(isAllocationFailure(new RangeError("invalid array length")), true);
  assertEquals(isAllocationFailure(new Error("SyntaxError in code")), false);
});
