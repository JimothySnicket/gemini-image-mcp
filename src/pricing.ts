import { log } from "./utils.js";

interface ModelPricing {
  inputPerMillion: number;
  textOutputPerMillion: number;
  imageOutputPerMillion: number;
  thinkingPerMillion: number;
}

// Single source of truth for when the pricing table was last checked against
// Google AI Studio. Surfaced in every UsageReport so callers can assess staleness.
export const PRICING_VERIFIED_DATE = "2026-04-01";

const PRICING: Record<string, ModelPricing> = {
  "gemini-2.5-flash-image": {
    inputPerMillion: 0.3,
    textOutputPerMillion: 2.5,
    imageOutputPerMillion: 30.0,
    thinkingPerMillion: 2.5,
  },
  "gemini-3-pro-image-preview": {
    inputPerMillion: 2.0,
    textOutputPerMillion: 120.0,
    imageOutputPerMillion: 120.0,
    thinkingPerMillion: 120.0,
  },
  "gemini-3.1-flash-image-preview": {
    inputPerMillion: 0.5,
    textOutputPerMillion: 60.0,
    imageOutputPerMillion: 60.0,
    thinkingPerMillion: 60.0,
  },
};

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

  const pricing = PRICING[model];
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
