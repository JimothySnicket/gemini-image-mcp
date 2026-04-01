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
  personGeneration?: string;
  outputDir?: string;
}

export interface GenerateImageResult {
  imagePath: string;
  mimeType: string;
  model: string;
  usage: UsageReport;
}

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
  if (params.personGeneration) imageConfig.personGeneration = params.personGeneration;

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
    // Check for safety filtering
    const candidate = response.candidates?.[0];
    const finishReason = candidate?.finishReason;
    if (finishReason === "SAFETY") {
      const ratings = candidate?.safetyRatings
        ?.map((r) => `${r.category}: ${r.probability}`)
        .join(", ");
      throw new Error(
        `Image generation blocked by safety filter. Ratings: ${ratings ?? "unknown"}. ` +
          "Try adjusting your prompt.",
      );
    }
    throw new Error(
      "No image was returned by the API. The model may have responded with text only. " +
        "Ensure your prompt asks for image generation.",
    );
  }

  // Save image
  const outputDir = resolveOutputDir(params.outputDir);
  const imagePath = await saveImage(imageData, outputDir);

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
