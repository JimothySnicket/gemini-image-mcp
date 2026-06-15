import { describe, test, expect } from "bun:test";
import { isUsableImageModel, buildGenerateConfig } from "./generate.js";

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

  test("useSearchGrounding attaches the googleSearch tool", () => {
    const c = buildGenerateConfig({ useSearchGrounding: true }, { needsTextMode: false });
    expect(c.tools).toEqual([{ googleSearch: {} }]);
  });

  test("no grounding => no tools key", () => {
    expect(buildGenerateConfig({ useSearchGrounding: false }, { needsTextMode: false }).tools).toBeUndefined();
    expect(buildGenerateConfig({}, { needsTextMode: false }).tools).toBeUndefined();
  });

  test("aspectRatio and resolution map into imageConfig (resolution -> imageSize)", () => {
    const c = buildGenerateConfig({ aspectRatio: "4:5", resolution: "512" }, { needsTextMode: false });
    expect(c.imageConfig).toEqual({ aspectRatio: "4:5", imageSize: "512" });
  });

  test("seed passes through", () => {
    expect(buildGenerateConfig({ seed: 42 }, { needsTextMode: false }).seed).toBe(42);
  });
});
