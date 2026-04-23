import { describe, test, expect } from "bun:test";
import { validateGrounding, GROUNDING_SUPPORTED_MODELS } from "./generate.js";

// Tests for grounding model validation. No real API calls are made — validateGrounding
// is a pure synchronous function that throws or returns based on model + flag alone.

describe("validateGrounding", () => {
  test("rejects useSearchGrounding:true on gemini-2.5-flash-image with documented message", () => {
    expect(() => validateGrounding("gemini-2.5-flash-image", true)).toThrow(
      /useSearchGrounding is only supported on/,
    );
    expect(() => validateGrounding("gemini-2.5-flash-image", true)).toThrow(
      /gemini-3\.1-flash-image-preview/,
    );
    expect(() => validateGrounding("gemini-2.5-flash-image", true)).toThrow(
      /You requested gemini-2\.5-flash-image/,
    );
  });

  test("rejects useSearchGrounding:true on gemini-3-pro-image-preview", () => {
    expect(() => validateGrounding("gemini-3-pro-image-preview", true)).toThrow(
      /useSearchGrounding is only supported on/,
    );
    expect(() => validateGrounding("gemini-3-pro-image-preview", true)).toThrow(
      /You requested gemini-3-pro-image-preview/,
    );
  });

  test("accepts useSearchGrounding:true on gemini-3.1-flash-image-preview (supported model)", () => {
    expect(() => validateGrounding("gemini-3.1-flash-image-preview", true)).not.toThrow();
  });

  test("accepts useSearchGrounding:false on any model", () => {
    expect(() => validateGrounding("gemini-2.5-flash-image", false)).not.toThrow();
    expect(() => validateGrounding("gemini-3-pro-image-preview", false)).not.toThrow();
    expect(() => validateGrounding("gemini-3.1-flash-image-preview", false)).not.toThrow();
  });

  test("accepts useSearchGrounding:undefined on any model", () => {
    expect(() => validateGrounding("gemini-2.5-flash-image", undefined)).not.toThrow();
    expect(() => validateGrounding("gemini-3-pro-image-preview", undefined)).not.toThrow();
    expect(() => validateGrounding("gemini-3.1-flash-image-preview", undefined)).not.toThrow();
  });

  test("GROUNDING_SUPPORTED_MODELS contains gemini-3.1-flash-image-preview", () => {
    expect(GROUNDING_SUPPORTED_MODELS).toContain("gemini-3.1-flash-image-preview");
  });
});
