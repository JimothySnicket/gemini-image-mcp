import { describe, test, expect, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { GoogleGenAI } from "@google/genai";
import { isUsableImageModel, buildGenerateConfig, withUploadedVideos, extractGroundingInfo } from "./generate.js";

// Tests for the model-discovery filter. isUsableImageModel is a pure function over
// the shape the live API returns ({ name, supportedActions }), so no API calls are
// made. It replaces the old hardcoded grounding allowlist + imagen exclusion with a
// capability check: an image-named model that supports generateContent is usable.

describe("isUsableImageModel", () => {
  test("accepts a GA image model that supports generateContent", () => {
    expect(
      isUsableImageModel({
        name: "models/gemini-3.1-flash-image",
        supportedActions: ["generateContent", "countTokens", "batchGenerateContent"],
      }),
    ).toBe(true);
    expect(
      isUsableImageModel({
        name: "models/gemini-3-pro-image",
        supportedActions: ["generateContent"],
      }),
    ).toBe(true);
  });

  test("accepts the legacy/preview image IDs", () => {
    expect(
      isUsableImageModel({
        name: "models/gemini-2.5-flash-image",
        supportedActions: ["generateContent"],
      }),
    ).toBe(true);
    expect(
      isUsableImageModel({
        name: "models/gemini-3.1-flash-image-preview",
        supportedActions: ["generateContent"],
      }),
    ).toBe(true);
  });

  test("excludes Imagen models (image-named but only support 'predict')", () => {
    expect(
      isUsableImageModel({
        name: "models/imagen-4.0-generate-001",
        supportedActions: ["predict"],
      }),
    ).toBe(false);
  });

  test("excludes non-image models even if they support generateContent", () => {
    expect(
      isUsableImageModel({
        name: "models/gemini-2.5-flash",
        supportedActions: ["generateContent", "countTokens"],
      }),
    ).toBe(false);
  });

  test("handles bare names without the 'models/' prefix", () => {
    expect(
      isUsableImageModel({ name: "gemini-3.1-flash-image", supportedActions: ["generateContent"] }),
    ).toBe(true);
  });

  test("falls back to supportedGenerationMethods when supportedActions is absent", () => {
    expect(
      isUsableImageModel({
        name: "models/gemini-2.5-flash-image",
        supportedGenerationMethods: ["generateContent"],
      }),
    ).toBe(true);
  });

  test("includes an image model with no action metadata (safe direction)", () => {
    // Missing capability data should not hide a plausibly-valid image model; the
    // per-request validation and the API itself remain the backstop.
    expect(isUsableImageModel({ name: "models/some-future-image" })).toBe(true);
  });

  test("excludes a model with no usable name", () => {
    expect(isUsableImageModel({})).toBe(false);
    expect(isUsableImageModel({ name: "" })).toBe(false);
  });
});

describe("buildGenerateConfig", () => {
  test("single-shot text-to-image uses IMAGE-only modality, no tools/imageConfig", () => {
    const c = buildGenerateConfig({}, { needsTextMode: false });
    expect(c.responseModalities).toEqual(["IMAGE"]);
    expect(c.tools).toBeUndefined();
    expect(c.imageConfig).toBeUndefined();
  });

  test("editing/session uses TEXT+IMAGE modality", () => {
    const c = buildGenerateConfig({}, { needsTextMode: true });
    expect(c.responseModalities).toEqual(["TEXT", "IMAGE"]);
  });

  test("grounding 'web' attaches the plain googleSearch tool", () => {
    const c = buildGenerateConfig({ grounding: "web" }, { needsTextMode: false });
    expect(c.tools).toEqual([{ googleSearch: {} }]);
  });

  test("grounding 'web+image' enables image + web search types", () => {
    const c = buildGenerateConfig({ grounding: "web+image" }, { needsTextMode: false });
    expect(c.tools).toEqual([{ googleSearch: { searchTypes: { imageSearch: {}, webSearch: {} } } }]);
  });

  test("thinkingLevel maps into thinkingConfig; absent means no thinkingConfig key", () => {
    expect(
      buildGenerateConfig({ thinkingLevel: "HIGH" }, { needsTextMode: false }).thinkingConfig,
    ).toEqual({ thinkingLevel: "HIGH" });
    expect(
      buildGenerateConfig({}, { needsTextMode: false }).thinkingConfig,
    ).toBeUndefined();
  });

  test("aspectRatio and resolution map into imageConfig (resolution -> imageSize)", () => {
    const c = buildGenerateConfig({ aspectRatio: "4:5", resolution: "512" }, { needsTextMode: false });
    expect(c.imageConfig).toEqual({ aspectRatio: "4:5", imageSize: "512" });
  });

  test("seed passes through", () => {
    expect(buildGenerateConfig({ seed: 42 }, { needsTextMode: false }).seed).toBe(42);
  });
});

// ── withUploadedVideos: upload lifecycle + cleanup ordering ──────────
// Offline coverage for the review findings: every successful upload must be
// deleted (awaited) on EVERY outcome, and a FAILED file must delete itself
// before the error propagates. The stub client records deletes as they happen.

describe("withUploadedVideos", () => {
  const dir = join(tmpdir(), `gim-vid-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  const clipA = join(dir, "a.mp4");
  const clipB = join(dir, "b.mp4");
  writeFileSync(clipA, Buffer.from("fake-video-a"));
  writeFileSync(clipB, Buffer.from("fake-video-b"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  function makeStub(getBehavior?: (name: string) => object) {
    const deleted: string[] = [];
    let uploads = 0;
    const ai = {
      files: {
        upload: async () => {
          uploads++;
          return { name: `files/v${uploads}`, state: "PROCESSING", uri: `gs://v${uploads}`, mimeType: "video/mp4" };
        },
        get: async ({ name }: { name: string }) =>
          getBehavior?.(name) ?? { name, state: "ACTIVE", uri: name.replace("files/", "gs://"), mimeType: "video/mp4" },
        delete: async ({ name }: { name: string }) => {
          deleted.push(name);
        },
      },
    } as unknown as GoogleGenAI;
    return { ai, deleted };
  }

  test("success: fn gets the ACTIVE files and every upload is deleted before resolve", async () => {
    const { ai, deleted } = makeStub();
    let filesSeen = 0;
    await withUploadedVideos(ai, [clipA, clipB], async (files) => {
      filesSeen = files.length;
      // deletes must NOT have happened yet — files are still in use
      expect(deleted).toEqual([]);
    });
    expect(filesSeen).toBe(2);
    expect(deleted.sort()).toEqual(["files/v1", "files/v2"]);
  });

  test("a FAILED video deletes itself with the API's reason, and the successful upload is still cleaned up", async () => {
    const { ai, deleted } = makeStub((name) =>
      name === "files/v2"
        ? { name, state: "FAILED", error: { message: "codec not supported" } }
        : { name, state: "ACTIVE", uri: name.replace("files/", "gs://"), mimeType: "video/mp4" },
    );
    let message = "";
    try {
      await withUploadedVideos(ai, [clipA, clipB], async () => {});
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toContain("codec not supported");
    expect(deleted.sort()).toEqual(["files/v1", "files/v2"]);
  }, 15000);

  test("fn throwing still deletes every upload, awaited", async () => {
    const { ai, deleted } = makeStub();
    await expect(
      withUploadedVideos(ai, [clipA], async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(deleted).toEqual(["files/v1"]);
  });

  test("validation failure before any upload leaves nothing to delete", async () => {
    const { ai, deleted } = makeStub();
    await expect(withUploadedVideos(ai, [join(dir, "nope.txt")], async () => {})).rejects.toThrow(
      "Unsupported video format",
    );
    expect(deleted).toEqual([]);
  });

  test("no paths is a pass-through", async () => {
    const { ai, deleted } = makeStub();
    const result = await withUploadedVideos(ai, [], async (files) => files.length);
    expect(result).toBe(0);
    expect(deleted).toEqual([]);
  });
});

// ── extractGroundingInfo: web + image chunk variants ─────────────────

describe("extractGroundingInfo", () => {
  test("maps BOTH web and image-search chunk variants", () => {
    const info = extractGroundingInfo({
      groundingChunks: [
        { web: { uri: "https://a.example", title: "A" } },
        { image: { sourceUri: "https://img.example/page", title: "Img page" } },
      ],
      webSearchQueries: ["q1"],
      searchEntryPoint: { renderedContent: "<style>x</style>" },
    });
    expect(info?.chunks).toEqual([
      { uri: "https://a.example", title: "A" },
      { uri: "https://img.example/page", title: "Img page" },
    ]);
    expect(info?.searchQueries).toEqual(["q1"]);
    expect(info?.searchEntryPointHtml).toBe("<style>x</style>");
  });

  test("chunks without a usable URI are dropped; empty metadata yields undefined", () => {
    expect(extractGroundingInfo({ groundingChunks: [{}, { web: {} }] })).toBeUndefined();
    expect(extractGroundingInfo(undefined)).toBeUndefined();
  });
});
