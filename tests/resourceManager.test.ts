import { assert, assertEquals } from "./assert.ts";
import {
  estimateJob,
  isAllocationFailure,
  WeightedSemaphore,
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

Deno.test("resourceManager: temporary capacity decrease does not permanently downgrade queued requests", async () => {
  const sem = new WeightedSemaphore(4);
  const release1 = await sem.acquire(4); // full capacity used
  assertEquals(sem.load, 4);

  // Queue a request for weight 2 while capacity is full
  let acquiredWeight2 = false;
  let release2: (() => void) | null = null;
  const p2 = sem.acquire(2).then((rel) => {
    acquiredWeight2 = true;
    release2 = rel;
  });

  // Temporarily shrink capacity to 1
  sem.setCapacity(1);

  // Restore capacity back to 4 before the job is admitted
  sem.setCapacity(4);

  // Release the first job
  release1();
  await p2;

  // The queued job must have acquired its original weight 2, not permanently downgraded to 1
  assertEquals(acquiredWeight2, true);
  assertEquals(sem.load, 2);

  // Clean up
  release2!();
  assertEquals(sem.load, 0);
});
