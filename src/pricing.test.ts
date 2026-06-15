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

describe("calculateUsage — GA model IDs price at the verified rates", () => {
  // makeMetadata() = 5 prompt tokens + 1290 image tokens, 0 text/thinking.
  // Pin exact dollar figures so a wrong rate (e.g. a copy-paste of the flash rate
  // onto the pro entry) fails the test instead of passing a generic $-shape match.
  test("gemini-2.5-flash-image: $0.30/M in + $30/M image => $0.0387", () => {
    expect(calculateUsage("gemini-2.5-flash-image", makeMetadata()).estimatedCost).toBe("$0.0387");
  });

  test("gemini-3-pro-image: $2.00/M in + $120/M image => $0.1548", () => {
    expect(calculateUsage("gemini-3-pro-image", makeMetadata()).estimatedCost).toBe("$0.1548");
  });

  test("gemini-3.1-flash-image: $0.50/M in + $60/M image => $0.0774", () => {
    expect(calculateUsage("gemini-3.1-flash-image", makeMetadata()).estimatedCost).toBe("$0.0774");
  });

  test("GA and -preview aliases price identically during the cutover", () => {
    expect(calculateUsage("gemini-3.1-flash-image", makeMetadata()).estimatedCost).toBe(
      calculateUsage("gemini-3.1-flash-image-preview", makeMetadata()).estimatedCost,
    );
    expect(calculateUsage("gemini-3-pro-image", makeMetadata()).estimatedCost).toBe(
      calculateUsage("gemini-3-pro-image-preview", makeMetadata()).estimatedCost,
    );
  });
});

describe("calculateUsage — malformed pricing overrides never produce $NaN", () => {
  // A NaN cost serializes to "$NaN", which parses to 0 cents and would silently
  // defeat the maxCostPerHour cap. Malformed overrides must fall back, not crash.
  const meta = makeMetadata();
  const badCases: Record<string, unknown> = {
    "string rate": { m: { inputPerMillion: "x", textOutputPerMillion: 1, imageOutputPerMillion: 1, thinkingPerMillion: 1 } },
    "negative rate": { m: { inputPerMillion: -1, textOutputPerMillion: 1, imageOutputPerMillion: 1, thinkingPerMillion: 1 } },
    "NaN rate": { m: { inputPerMillion: NaN, textOutputPerMillion: 1, imageOutputPerMillion: 1, thinkingPerMillion: 1 } },
    "missing field": { m: { inputPerMillion: 1 } },
    "non-object value": { m: "nope" },
  };

  for (const [label, overrides] of Object.entries(badCases)) {
    test(`${label}: unknown model falls back to "unknown", never $NaN`, () => {
      const result = calculateUsage("m", meta, overrides as never);
      expect(result.estimatedCost).not.toContain("NaN");
      expect(result.estimatedCost).toMatch(/^unknown/);
    });
  }

  test("a malformed override for a KNOWN model falls back to built-in pricing", () => {
    const good = calculateUsage("gemini-2.5-flash-image", meta);
    const withBad = calculateUsage("gemini-2.5-flash-image", meta, {
      "gemini-2.5-flash-image": { inputPerMillion: NaN, textOutputPerMillion: 1, imageOutputPerMillion: 1, thinkingPerMillion: 1 },
    } as never);
    expect(withBad.estimatedCost).toBe(good.estimatedCost);
  });
});

describe("calculateUsage — pricing overrides", () => {
  const override = {
    "brand-new-model": {
      inputPerMillion: 1,
      textOutputPerMillion: 100,
      imageOutputPerMillion: 100,
      thinkingPerMillion: 100,
    },
  };

  test("an override supplies a cost for a model not in the built-in table", () => {
    const without = calculateUsage("brand-new-model", makeMetadata());
    expect(without.estimatedCost).toMatch(/^unknown/);

    const withOverride = calculateUsage("brand-new-model", makeMetadata(), override);
    expect(withOverride.estimatedCost).toMatch(/^\$\d+\.\d{4}$/);
  });

  test("an override takes precedence over the built-in table", () => {
    const builtin = calculateUsage("gemini-2.5-flash-image", makeMetadata());
    const overridden = calculateUsage("gemini-2.5-flash-image", makeMetadata(), {
      "gemini-2.5-flash-image": {
        inputPerMillion: 999,
        textOutputPerMillion: 999,
        imageOutputPerMillion: 999,
        thinkingPerMillion: 999,
      },
    });
    expect(overridden.estimatedCost).not.toBe(builtin.estimatedCost);
  });

  test("an empty/undefined override leaves built-in pricing intact", () => {
    const a = calculateUsage("gemini-2.5-flash-image", makeMetadata());
    const b = calculateUsage("gemini-2.5-flash-image", makeMetadata(), {});
    expect(a.estimatedCost).toBe(b.estimatedCost);
  });
});

describe("PRICING_VERIFIED_DATE constant", () => {
  test("is a date-shaped string (YYYY-MM-DD)", () => {
    expect(PRICING_VERIFIED_DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
