import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { calculateUsage, PRICING_VERIFIED_DATE } from "./pricing.js";

// ── Helpers ──────────────────────────────────────────────────────────

function makeMetadata(overrides: Record<string, unknown> = {}) {
  return {
    promptTokenCount: 5,
    candidatesTokenCount: 1290,
    candidatesTokensDetails: [
      { modality: "IMAGE", tokenCount: 1290 },
      { modality: "TEXT", tokenCount: 0 },
    ],
    thoughtsTokenCount: 0,
    totalTokenCount: 1295,
    ...overrides,
  };
}

// ── describe: calculateUsage ─────────────────────────────────────────

describe("calculateUsage — known model", () => {
  test("returns a dollar-formatted estimatedCost for gemini-2.5-flash-image", () => {
    const result = calculateUsage("gemini-2.5-flash-image", makeMetadata());
    expect(result.estimatedCost).toMatch(/^\$\d+\.\d{4}$/);
  });

  test("estimatedCost is non-zero for non-zero token counts", () => {
    const result = calculateUsage("gemini-2.5-flash-image", makeMetadata());
    const cost = parseFloat(result.estimatedCost.replace("$", ""));
    expect(cost).toBeGreaterThan(0);
  });

  test("token fields pass through from metadata", () => {
    const meta = makeMetadata({
      promptTokenCount: 10,
      candidatesTokenCount: 500,
      thoughtsTokenCount: 50,
      totalTokenCount: 560,
    });
    const result = calculateUsage("gemini-2.5-flash-image", meta);
    expect(result.promptTokens).toBe(10);
    expect(result.outputTokens).toBe(500);
    expect(result.thinkingTokens).toBe(50);
    expect(result.totalTokens).toBe(560);
  });

  test("pricingVerifiedDate equals PRICING_VERIFIED_DATE constant", () => {
    const result = calculateUsage("gemini-2.5-flash-image", makeMetadata());
    expect(result.pricingVerifiedDate).toBe(PRICING_VERIFIED_DATE);
  });

  test("gemini-3-pro-image-preview returns a valid cost", () => {
    const result = calculateUsage("gemini-3-pro-image-preview", makeMetadata());
    expect(result.estimatedCost).toMatch(/^\$\d+\.\d{4}$/);
    expect(result.pricingVerifiedDate).toBe(PRICING_VERIFIED_DATE);
  });

  test("gemini-3.1-flash-image-preview returns a valid cost", () => {
    const result = calculateUsage("gemini-3.1-flash-image-preview", makeMetadata());
    expect(result.estimatedCost).toMatch(/^\$\d+\.\d{4}$/);
    expect(result.pricingVerifiedDate).toBe(PRICING_VERIFIED_DATE);
  });
});

describe("calculateUsage — unknown model", () => {
  test("returns estimatedCost starting with 'unknown' for a model not in PRICING", () => {
    const result = calculateUsage("gemini-99-fake-model", makeMetadata());
    expect(result.estimatedCost).toMatch(/^unknown/);
  });

  test("still includes pricingVerifiedDate on unknown model path", () => {
    const result = calculateUsage("gemini-99-fake-model", makeMetadata());
    expect(result.pricingVerifiedDate).toBe(PRICING_VERIFIED_DATE);
  });

  test("token fields still pass through on unknown model path", () => {
    const meta = makeMetadata({ promptTokenCount: 7, totalTokenCount: 300 });
    const result = calculateUsage("gemini-99-fake-model", meta);
    expect(result.promptTokens).toBe(7);
    expect(result.totalTokens).toBe(300);
  });
});

describe("calculateUsage — missing metadata", () => {
  test("returns zero token counts when metadata is undefined", () => {
    const result = calculateUsage("gemini-2.5-flash-image", undefined);
    expect(result.promptTokens).toBe(0);
    expect(result.outputTokens).toBe(0);
    expect(result.imageTokens).toBe(0);
    expect(result.thinkingTokens).toBe(0);
    expect(result.totalTokens).toBe(0);
  });

  test("returns $0.0000 cost for known model with all-zero tokens", () => {
    const result = calculateUsage("gemini-2.5-flash-image", undefined);
    expect(result.estimatedCost).toBe("$0.0000");
  });

  test("still includes pricingVerifiedDate when metadata is undefined", () => {
    const result = calculateUsage("gemini-2.5-flash-image", undefined);
    expect(result.pricingVerifiedDate).toBe(PRICING_VERIFIED_DATE);
  });
});

describe("PRICING_VERIFIED_DATE constant", () => {
  test("is a date-shaped string (YYYY-MM-DD)", () => {
    expect(PRICING_VERIFIED_DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
