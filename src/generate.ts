import { GoogleGenAI } from "@google/genai";
import { readFile } from "fs/promises";
import { extname } from "path";
import { calculateUsage, type UsageReport } from "./pricing.js";
import { log, resolveOutputDir, saveImage } from "./utils.js";

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
};

export interface GenerateImageParams {
  prompt: string;
  images?: string[];
  model?: string;
  aspectRatio?: string;
  resolution?: string;
  outputDir?: string;
}

export interface GenerateImageResult {
  imagePath: string;
  mimeType: string;
  model: string;
  usage: UsageReport;
}

// Known image-capable model name fragments
const IMAGE_MODEL_PATTERNS = ["image", "img"];

let cachedAvailableModels: string[] | null = null;

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY environment variable is not set. " +
        "Get a key at https://aistudio.google.com/apikey",
    );
  }
  return new GoogleGenAI({ apiKey });
}

export async function discoverModels(): Promise<string[]> {
  const ai = getClient();
  const imageModels: string[] = [];

  try {
    const pager = await ai.models.list({ config: { pageSize: 100 } });
    for await (const model of pager) {
      const name = model.name?.replace("models/", "") ?? "";
      const isImageCapable = IMAGE_MODEL_PATTERNS.some((p) => name.includes(p));
      if (isImageCapable) {
        imageModels.push(name);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to list models (is your API key valid?): ${msg}`);
  }

  cachedAvailableModels = imageModels;
  return imageModels;
}

export function getAvailableModels(): string[] | null {
  return cachedAvailableModels;
}

async function readImageAsInlineData(
  filepath: string,
): Promise<{ inlineData: { data: string; mimeType: string } }> {
  const ext = extname(filepath).toLowerCase();
  const mimeType = MIME_TYPES[ext];
  if (!mimeType) {
    throw new Error(
      `Unsupported image format "${ext}" for file: ${filepath}. ` +
        `Supported: ${Object.keys(MIME_TYPES).join(", ")}`,
    );
  }

  let buffer: Buffer;
  try {
    buffer = await readFile(filepath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to read image file "${filepath}": ${msg}`);
  }

  return {
    inlineData: {
      data: buffer.toString("base64"),
      mimeType,
    },
  };
}

export async function generateImage(
  params: GenerateImageParams,
): Promise<GenerateImageResult> {
  const model = params.model ?? process.env.DEFAULT_MODEL ?? "gemini-2.5-flash-image";
  const timeoutMs = Number(process.env.REQUEST_TIMEOUT_MS) || 60_000;

  // Validate model against discovered models if available
  const available = getAvailableModels();
  if (available && available.length > 0 && !available.includes(model)) {
    throw new Error(
      `Model "${model}" is not available. ` +
        `Image-capable models for your API key: ${available.join(", ")}`,
    );
  }

  log.info(`Generating image with model=${model}`);
  log.debug("Params:", JSON.stringify(params, null, 2));

  const ai = getClient();

  // Build content parts
  const parts: Array<{ text: string } | { inlineData: { data: string; mimeType: string } }> = [];

  // Add input images first if provided (for editing)
  if (params.images?.length) {
    log.info(`Loading ${params.images.length} input image(s)`);
    for (const imagePath of params.images) {
      const inlineDataPart = await readImageAsInlineData(imagePath);
      parts.push(inlineDataPart);
    }
  }

  // Add the text prompt
  parts.push({ text: params.prompt });

  // Build config
  const imageConfig: Record<string, string> = {};
  if (params.aspectRatio) imageConfig.aspectRatio = params.aspectRatio;
  if (params.resolution) imageConfig.imageSize = params.resolution;


  const startTime = Date.now();

  // Call Gemini API with timeout
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await ai.models.generateContent({
      model,
      contents: [{ role: "user", parts }],
      config: {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: Object.keys(imageConfig).length > 0 ? imageConfig : undefined,
        abortSignal: controller.signal,
      },
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(
        `Gemini API request timed out after ${timeoutMs}ms. ` +
          "Try a simpler prompt or increase REQUEST_TIMEOUT_MS.",
      );
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  const elapsed = Date.now() - startTime;
  log.info(`API response received in ${elapsed}ms`);

  // Extract image from response
  const responseParts = response.candidates?.[0]?.content?.parts ?? [];
  let imageData: string | undefined;
  let imageMimeType = "image/png";

  for (const part of responseParts) {
    if (part.inlineData?.data) {
      imageData = part.inlineData.data;
      imageMimeType = part.inlineData.mimeType ?? "image/png";
      break;
    }
  }

  if (!imageData) {
    // Log full response for debugging
    log.debug("No image in response. Full response:", JSON.stringify({
      candidates: response.candidates?.map((c) => ({
        finishReason: c.finishReason,
        safetyRatings: c.safetyRatings,
        contentParts: c.content?.parts?.map((p) => ({
          hasText: !!p.text,
          text: p.text?.slice(0, 200),
          hasInlineData: !!p.inlineData,
        })),
      })),
      promptFeedback: response.promptFeedback,
    }));

    // Check for prompt-level blocking
    const promptBlock = response.promptFeedback?.blockReason;
    if (promptBlock) {
      throw new Error(
        `Prompt blocked by safety filter: ${promptBlock}. Try adjusting your prompt.`,
      );
    }

    // Check for candidate-level safety filtering
    const candidate = response.candidates?.[0];
    const finishReason = candidate?.finishReason;
    if (finishReason === "SAFETY" || finishReason === "RECITATION") {
      const ratings = candidate?.safetyRatings
        ?.map((r) => `${r.category}: ${r.probability}`)
        .join(", ");
      throw new Error(
        `Image generation blocked by safety filter (${finishReason}). ` +
          `Ratings: ${ratings ?? "unknown"}. Try adjusting your prompt.`,
      );
    }

    // Check if model responded with text only (no error, just no image)
    const textParts = responseParts.filter((p) => p.text);
    if (textParts.length > 0) {
      const modelText = textParts.map((p) => p.text).join(" ").slice(0, 300);
      throw new Error(
        `Model responded with text instead of an image: "${modelText}". ` +
          "Try rephrasing your prompt to explicitly request image generation.",
      );
    }

    throw new Error(
      "No image was returned by the API and no clear reason was given. " +
        "Check ~/gemini-images/gemini-mcp.log with LOG_LEVEL=debug for details.",
    );
  }

  // Save image
  const outputDir = resolveOutputDir(params.outputDir);
  const imagePath = await saveImage(imageData, outputDir, imageMimeType);

  // Calculate usage
  const usage = calculateUsage(model, response.usageMetadata);
  log.info(
    `Complete: ${imagePath} | ${usage.totalTokens} tokens | ${usage.estimatedCost} | ${elapsed}ms`,
  );
  log.debug("Usage details:", JSON.stringify(usage, null, 2));

  return {
    imagePath,
    mimeType: imageMimeType,
    model,
    usage,
  };
}
