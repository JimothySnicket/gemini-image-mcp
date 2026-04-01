import { GoogleGenAI, type Content, type Part } from "@google/genai";
import { readFile } from "fs/promises";
import { extname } from "path";
import { calculateUsage, type UsageReport } from "./pricing.js";
import {
  appendManifest,
  checkRateLimit,
  getSessionStats,
  recordGeneration,
  type SessionStats,
} from "./tracker.js";
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
  filename?: string;
  subfolder?: string;
  sessionId?: string;
  seed?: number;
  useSearchGrounding?: boolean;
}

export interface GenerateImageResult {
  imagePath: string;
  mimeType: string;
  model: string;
  sessionId?: string;
  sessionTurn?: number;
  usage: UsageReport;
  session: SessionStats;
}

// Known image-capable model name fragments (Gemini native only)
const IMAGE_MODEL_PATTERNS = ["image", "img"];
// Imagen uses a different API (generateImages) and is deprecated June 2026
const EXCLUDED_PREFIXES = ["imagen"];

let cachedAvailableModels: string[] | null = null;

// --- Multi-turn session management ---

interface ConversationSession {
  history: Content[];
  model: string;
  lastAccessed: number;
}

const sessions = new Map<string, ConversationSession>();
const SESSION_TIMEOUT = Number(process.env.SESSION_TIMEOUT_MS) || 30 * 60 * 1000;

function cleanupSessions(): void {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastAccessed > SESSION_TIMEOUT) {
      log.info(`Session ${id} expired after ${SESSION_TIMEOUT / 1000}s inactivity`);
      sessions.delete(id);
    }
  }
}

function generateSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

export async function discoverModels(): Promise<string[]> {
  const ai = getClient();
  const imageModels: string[] = [];

  try {
    const pager = await ai.models.list({ config: { pageSize: 100 } });
    for await (const model of pager) {
      const name = model.name?.replace("models/", "") ?? "";
      const isImageCapable = IMAGE_MODEL_PATTERNS.some((p) => name.includes(p));
      const isExcluded = EXCLUDED_PREFIXES.some((p) => name.startsWith(p));
      if (isImageCapable && !isExcluded) {
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

  // Check rate limits before doing anything
  checkRateLimit();

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

  // Clean up expired sessions periodically
  cleanupSessions();

  const ai = getClient();

  // Build content parts for this turn
  const userParts: Part[] = [];

  // Add input images first if provided (for editing)
  if (params.images?.length) {
    log.info(`Loading ${params.images.length} input image(s)`);
    for (const imagePath of params.images) {
      const inlineDataPart = await readImageAsInlineData(imagePath);
      userParts.push(inlineDataPart);
    }
  }

  // Add the text prompt
  userParts.push({ text: params.prompt });

  // Build contents — from session history or fresh
  let sessionId = params.sessionId;
  let sessionTurn = 1;
  let contents: Content[];

  if (sessionId && sessions.has(sessionId)) {
    const session = sessions.get(sessionId)!;
    if (session.model !== model) {
      throw new Error(
        `Session "${sessionId}" uses model "${session.model}" but you requested "${model}". ` +
          "Use the same model for all turns in a session, or start a new session.",
      );
    }
    contents = [...session.history, { role: "user", parts: userParts }];
    sessionTurn = Math.floor(contents.length / 2) + 1;
    log.info(`Continuing session ${sessionId}, turn ${sessionTurn}`);
  } else {
    contents = [{ role: "user", parts: userParts }];
    // Generate a session ID if editing (images provided) even if not explicitly requested
    if (!sessionId) {
      sessionId = generateSessionId();
    }
  }

  // Build config
  const imageConfig: Record<string, string> = {};
  if (params.aspectRatio) imageConfig.aspectRatio = params.aspectRatio;
  if (params.resolution) imageConfig.imageSize = params.resolution;

  // Use IMAGE-only for single-shot (prevents text-only responses).
  // Use TEXT+IMAGE for sessions (needed to preserve thoughtSignature in history).
  const isSession = !!(sessionId && sessions.has(sessionId));
  const generateConfig: Record<string, unknown> = {
    responseModalities: isSession ? ["TEXT", "IMAGE"] : ["IMAGE"],
    abortSignal: undefined as unknown,
  };
  if (Object.keys(imageConfig).length > 0) generateConfig.imageConfig = imageConfig;
  if (params.seed !== undefined) generateConfig.seed = params.seed;
  if (params.useSearchGrounding) {
    generateConfig.tools = [{ googleSearch: {} }];
  }

  const startTime = Date.now();

  // Call Gemini API with timeout
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  generateConfig.abortSignal = controller.signal;

  let response;
  try {
    response = await ai.models.generateContent({
      model,
      contents,
      config: generateConfig,
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

  // Store conversation history for multi-turn (preserve full response parts including thoughtSignature)
  const responseParts = response.candidates?.[0]?.content?.parts ?? [];
  if (sessionId) {
    sessions.set(sessionId, {
      history: [...contents, { role: "model", parts: responseParts }],
      model,
      lastAccessed: Date.now(),
    });
  }
  log.info(`API response received in ${elapsed}ms`);

  // Extract image from response
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
  const imagePath = await saveImage({
    base64Data: imageData,
    outputDir,
    mimeType: imageMimeType,
    filename: params.filename,
    subfolder: params.subfolder,
  });

  // Calculate usage
  const usage = calculateUsage(model, response.usageMetadata);
  log.info(
    `Complete: ${imagePath} | ${usage.totalTokens} tokens | ${usage.estimatedCost} | ${elapsed}ms`,
  );
  log.debug("Usage details:", JSON.stringify(usage, null, 2));

  // Record to manifest and session tracker
  recordGeneration(usage);
  appendManifest({
    timestamp: new Date().toISOString(),
    filename: imagePath.split(/[/\\]/).pop() ?? "",
    path: imagePath,
    prompt: params.prompt,
    model,
    aspectRatio: params.aspectRatio,
    resolution: params.resolution,
    subfolder: params.subfolder,
    inputImages: params.images?.length ?? 0,
    usage,
  });

  return {
    imagePath,
    mimeType: imageMimeType,
    model,
    sessionId,
    sessionTurn,
    usage,
    session: getSessionStats(),
  };
}
