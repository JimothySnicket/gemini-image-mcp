import { log } from "./utils.js";

export interface ModelPricing {
  inputPerMillion: number;
  textOutputPerMillion: number;
  imageOutputPerMillion: number;
  thinkingPerMillion: number;
}

// Single source of truth for when the pricing table was last checked against the
// official Gemini API pricing page. Surfaced in every UsageReport so callers can
// assess staleness. (There is no pricing API — these rates are maintained by hand;
// run `npm run check:pricing` to re-verify against the live docs.)
export const PRICING_VERIFIED_DATE = "2026-06-15";

// Per-1M-token rates (USD). The estimated cost is computed from the live token
// counts the API returns, so per-image cost auto-adjusts with resolution; only
// these rates are static. Unknown models fall back to "unknown" (see below) or a
// caller-supplied pricingOverrides entry, so a brand-new model still works.
export const PRICING: Record<string, ModelPricing> = {
  "gemini-2.5-flash-image": {
    inputPerMillion: 0.3,
    textOutputPerMillion: 2.5,
    imageOutputPerMillion: 30.0,
    thinkingPerMillion: 2.5,
  },
  // GA since ~2026-05-28. The `-preview` aliases below retire 2026-06-25; both are
  // kept during the cutover so in-flight callers keep getting accurate costs.
  "gemini-3-pro-image": {
    inputPerMillion: 2.0,
    textOutputPerMillion: 120.0,
    imageOutputPerMillion: 120.0,
    thinkingPerMillion: 120.0,
  },
  "gemini-3-pro-image-preview": {
    inputPerMillion: 2.0,
    textOutputPerMillion: 120.0,
    imageOutputPerMillion: 120.0,
    thinkingPerMillion: 120.0,
  },
  "gemini-3.1-flash-image": {
    inputPerMillion: 0.5,
    textOutputPerMillion: 60.0,
    imageOutputPerMillion: 60.0,
    thinkingPerMillion: 60.0,
  },
  "gemini-3.1-flash-image-preview": {
    inputPerMillion: 0.5,
    textOutputPerMillion: 60.0,
    imageOutputPerMillion: 60.0,
    thinkingPerMillion: 60.0,
  },
};

function isValidPricing(p: ModelPricing | undefined): p is ModelPricing {
  return (
    !!p &&
    typeof p === "object" &&
    [p.inputPerMillion, p.textOutputPerMillion, p.imageOutputPerMillion, p.thinkingPerMillion].every(
      (n) => typeof n === "number" && Number.isFinite(n) && n >= 0,
    )
  );
}

/**
 * Resolve pricing for a model: a caller override wins, but a malformed override
 * (non-numeric / negative / missing rate) is ignored with a warning and we fall
 * back to the built-in table. A malformed rate would compute a NaN cost that
 * serializes to "$NaN" and parses to 0 cents — silently defeating the
 * maxCostPerHour cap — so we never let one through.
 */
function resolvePricing(
  model: string,
  overrides?: Record<string, ModelPricing>,
): ModelPricing | undefined {
  const override = overrides?.[model];
  if (override !== undefined && !isValidPricing(override)) {
    log.error(
      `Ignoring invalid pricingOverrides entry for "${model}" — each rate must be a finite number >= 0. ` +
        "Falling back to built-in pricing.",
    );
  }
  if (isValidPricing(override)) return override;
  return PRICING[model];
}

export interface UsageReport {
  promptTokens: number;
  outputTokens: number;
  imageTokens: number;
  thinkingTokens: number;
  totalTokens: number;
  estimatedCost: string;
  pricingVerifiedDate: string;
}

interface ModalityTokenCount {
  modality?: string;
  tokenCount?: number;
}

interface UsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  candidatesTokensDetails?: ModalityTokenCount[];
  thoughtsTokenCount?: number;
  totalTokenCount?: number;
}

export function calculateUsage(
  model: string,
  metadata: UsageMetadata | undefined,
  overrides?: Record<string, ModelPricing>,
): UsageReport {
  const prompt = metadata?.promptTokenCount ?? 0;
  const output = metadata?.candidatesTokenCount ?? 0;
  const thinking = metadata?.thoughtsTokenCount ?? 0;
  const total = metadata?.totalTokenCount ?? 0;

  let imageTokens = 0;
  let textTokens = 0;
  for (const detail of metadata?.candidatesTokensDetails ?? []) {
    if (detail.modality === "IMAGE") imageTokens += detail.tokenCount ?? 0;
    if (detail.modality === "TEXT") textTokens += detail.tokenCount ?? 0;
  }

  const pricing = resolvePricing(model, overrides);
  let estimatedCost = "unknown (model not in pricing table)";

  if (pricing) {
    const cost =
      (prompt / 1_000_000) * pricing.inputPerMillion +
      (textTokens / 1_000_000) * pricing.textOutputPerMillion +
      (imageTokens / 1_000_000) * pricing.imageOutputPerMillion +
      (thinking / 1_000_000) * pricing.thinkingPerMillion;
    estimatedCost = `$${cost.toFixed(4)}`;
  } else {
    log.error(
      `No pricing entry for model "${model}". Cost cannot be estimated. ` +
        "Please report this at https://github.com/JimothySnicket/gemini-image-mcp/issues",
    );
  }

  return {
    promptTokens: prompt,
    outputTokens: output,
    imageTokens,
    thinkingTokens: thinking,
    totalTokens: total,
    estimatedCost,
    pricingVerifiedDate: PRICING_VERIFIED_DATE,
  };
}
