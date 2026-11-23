import { assert, assertEquals, assertRejects } from "./assert.ts";
import { planVideoSize, getVideoMeta } from "../src/lib/videoMeta.ts";
import { videoViaMediaRecorder } from "../src/lib/compressVideo.ts";

interface MockVideoEnv {
  revokedUrls: string[];
  setElementCreator: (fn: (tag: string) => any) => void;
  restore: () => void;
}

function setupMockVideoEnv(prefix = "mock-url"): MockVideoEnv {
  const revokedUrls: string[] = [];
  const origCreate = URL.createObjectURL;
  const origRevoke = URL.revokeObjectURL;
  const origDoc = (globalThis as any).document;
  const origNavDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const origMediaRecorder = (globalThis as any).MediaRecorder;

  let count = 0;
  URL.createObjectURL = (_b?: any) => `blob:${prefix}-${++count}`;
  URL.revokeObjectURL = (u: string) => { revokedUrls.push(u); };

  try {
    Object.defineProperty(globalThis, "navigator", {
      value: { userAgent: "Chrome" },
      configurable: true,
      writable: true,
    });
  } catch {
    /**/
  }
  (globalThis as any).MediaRecorder = { isTypeSupported: () => true };

  const setElementCreator = (fn: (tag: string) => any) => {
    (globalThis as any).document = { createElement: fn };
  };

  const restore = () => {
    URL.createObjectURL = origCreate;
    URL.revokeObjectURL = origRevoke;
    (globalThis as any).document = origDoc;
    if (origNavDescriptor) {
      Object.defineProperty(globalThis, "navigator", origNavDescriptor);
    }
    (globalThis as any).MediaRecorder = origMediaRecorder;
  };

  return { revokedUrls, setElementCreator, restore };
}

function createMockCanvas(onTrackStop?: () => void) {
  return {
    width: 0,
    height: 0,
    getContext: () => ({ drawImage: () => {} }),
    captureStream: () => ({
      getVideoTracks: () => [{ stop: () => onTrackStop?.() }],
      getTracks: () => [{ stop: () => onTrackStop?.() }],
    }),
  };
}

Deno.test("videoMeta: planVideoSize rounds odd dimensions down without upscaling", () => {
  const result = planVideoSize(641, 481);
  assertEquals(result.width, 640);
  assertEquals(result.height, 480);
  assertEquals(result.resized, true);
  assert(result.scale < 1);
});

Deno.test("videoMeta: planVideoSize keeps even dimensions untouched when no cap", () => {
  const result = planVideoSize(1920, 1080);
  assertEquals(result.width, 1920);
  assertEquals(result.height, 1080);
  assertEquals(result.resized, false);
  assertEquals(result.scale, 1);
});

Deno.test("videoMeta: planVideoSize never exceeds odd maxWidth cap", () => {
  const result = planVideoSize(1920, 1080, 1001);
  assert(result.width <= 1001);
  assertEquals(result.width % 2, 0);
  assertEquals(result.height % 2, 0);
  assertEquals(result.width, 1000);
});

Deno.test("videoMeta: getVideoMeta rejects on timeout with clear error and cleans up", async () => {
  const env = setupMockVideoEnv("mock-video-url");
  try {
    env.setElementCreator((tag: string) => {
      if (tag === "video") {
        return {
          preload: "",
          src: "",
          onloadedmetadata: null,
          onerror: null,
        };
      }
      return {};
    });

    const file = new File(["dummy video"], "test.mp4", { type: "video/mp4" });
    await assertRejects(
      () => getVideoMeta(file, 20),
      "Timed out reading video metadata"
    );
    assertEquals(env.revokedUrls.includes("blob:mock-video-url-1"), true);
  } finally {
    env.restore();
  }
});

Deno.test("compressVideo: videoViaMediaRecorder revokes blob URL when metadata loading fails", async () => {
  const env = setupMockVideoEnv("mock-url");
  try {
    let createdCount = 0;
    env.setElementCreator((tag: string) => {
      if (tag === "video") {
        createdCount++;
        const el: any = {
          preload: "",
          src: "",
          videoWidth: 640,
          videoHeight: 360,
          duration: 10,
          onloadedmetadata: null,
          onerror: null,
        };
        if (createdCount === 1) {
          // First call is for getVideoMeta: trigger onloadedmetadata
          setTimeout(() => el.onloadedmetadata?.(), 5);
        } else {
          // Second call is for fallback vid: trigger onerror
          setTimeout(() => el.onerror?.(), 5);
        }
        return el;
      }
      return {};
    });

    const file = new File(["dummy"], "test.mp4", { type: "video/mp4" });
    await assertRejects(
      () => videoViaMediaRecorder(file, {}),
      "Failed to load video in MediaRecorder fallback"
    );
    // URL 1 was from getVideoMeta (revoked on metadata load)
    // URL 2 was from videoViaMediaRecorder fallback (MUST be revoked on metadata error)
    assertEquals(env.revokedUrls.includes("blob:mock-url-2"), true);
  } finally {
    env.restore();
  }
});

Deno.test("compressVideo: videoViaMediaRecorder revokes blob URL when metadata loading times out", async () => {
  const env = setupMockVideoEnv("mock-timeout-url");
  try {
    let createdCount = 0;
    env.setElementCreator((tag: string) => {
      if (tag === "video") {
        createdCount++;
        const el: any = {
          preload: "",
          src: "",
          videoWidth: 640,
          videoHeight: 360,
          duration: 10,
          onloadedmetadata: null,
          onerror: null,
        };
        if (createdCount === 1) {
          // First call is for getVideoMeta: trigger onloadedmetadata so initial read succeeds
          setTimeout(() => el.onloadedmetadata?.(), 5);
        }
        return el;
      }
      return {};
    });

    const file = new File(["dummy"], "test.mp4", { type: "video/mp4" });
    await assertRejects(
      () => videoViaMediaRecorder(file, {}, undefined, 20),
      "Timeout loading video metadata in MediaRecorder fallback",
    );
    // URL 2 was from videoViaMediaRecorder fallback (MUST be revoked on metadata timeout)
    assertEquals(env.revokedUrls.includes("blob:mock-timeout-url-2"), true);
  } finally {
    env.restore();
  }
});

Deno.test("compressVideo: videoViaMediaRecorder stops recorder and capture tracks when play() rejects", async () => {
  let recorderStopped = false;
  let trackStopped = false;
  const env = setupMockVideoEnv("mock-play-fail");

  try {
    class MockMediaRecorder {
      state = "inactive";
      ondataavailable: any = null;
      onstop: any = null;
      static isTypeSupported() { return true; }
      start() { this.state = "recording"; }
      stop() {
        this.state = "inactive";
        recorderStopped = true;
      }
    }
    (globalThis as any).MediaRecorder = MockMediaRecorder;

    env.setElementCreator((tag: string) => {
      if (tag === "video") {
        const el: any = {
          preload: "",
          src: "",
          videoWidth: 640,
          videoHeight: 360,
          duration: 10,
          onloadedmetadata: null,
          onerror: null,
          pause: () => {},
          play: () => Promise.reject(new Error("AutoplayNotAllowed")),
        };
        setTimeout(() => el.onloadedmetadata?.(), 5);
        return el;
      }
      if (tag === "canvas") {
        return createMockCanvas(() => { trackStopped = true; });
      }
      return {};
    });

    const file = new File(["dummy"], "test.mp4", { type: "video/mp4" });
    await assertRejects(
      () => videoViaMediaRecorder(file, {}),
      "MediaRecorder fallback could not start playback",
    );

    assertEquals(recorderStopped, true);
    assertEquals(trackStopped, true);
    assertEquals(env.revokedUrls.includes("blob:mock-play-fail-2"), true);
  } finally {
    env.restore();
  }
});

Deno.test("compressVideo: videoViaMediaRecorder rejects when MediaRecorder errors or becomes inactive after start() before playback ends", async () => {
  let trackStopped = false;
  const env = setupMockVideoEnv("mock-rec-fail");

  try {
    let activeRecorderInstance: any = null;
    (globalThis as any).MediaRecorder = class MockFailingRecorder {
      state = "recording";
      ondataavailable: ((e: any) => void) | null = null;
      onerror: ((e: any) => void) | null = null;
      onstop: (() => void) | null = null;

      constructor(_stream: any, _opts: any) {
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        activeRecorderInstance = this;
      }
      start(_timeslice?: number) {
        this.state = "recording";
      }
      stop() {
        this.state = "inactive";
        this.onstop?.();
      }
      static isTypeSupported() {
        return true;
      }
    };

    env.setElementCreator((tag: string) => {
      if (tag === "video") {
        let loadedMetaListener: (() => void) | null = null;
        return {
          src: "",
          preload: "",
          muted: true,
          playsInline: true,
          videoWidth: 640,
          videoHeight: 480,
          duration: 1.0,
          currentTime: 0,
          set onloadedmetadata(fn: () => void) {
            loadedMetaListener = fn;
            setTimeout(() => { if (loadedMetaListener) loadedMetaListener(); }, 5);
          },
          play: () => {
            // Simulate asynchronous error on MediaRecorder after start()
            setTimeout(() => {
              if (activeRecorderInstance) {
                activeRecorderInstance.state = "inactive";
                activeRecorderInstance.onerror?.({
                  type: "error",
                  error: new Error("Hardware encoder reset"),
                });
              }
            }, 10);
            return Promise.resolve();
          },
          pause: () => {},
          captureStream: () => ({
            getVideoTracks: () => [
              { stop: () => { trackStopped = true; } },
            ],
            getAudioTracks: () => [],
          }),
        };
      }
      if (tag === "canvas") {
        return createMockCanvas(() => { trackStopped = true; });
      }
      return {};
    });

    const file = new File(["dummy"], "test.mp4", { type: "video/mp4" });
    await assertRejects(
      () => videoViaMediaRecorder(file, {}),
      "Hardware encoder reset",
    );

    assertEquals(trackStopped, true);
    assertEquals(env.revokedUrls.includes("blob:mock-rec-fail-2"), true);
  } finally {
    env.restore();
  }
});
