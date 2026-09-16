import { GoogleGenAI, type Content, type File as GenaiFile, type Part } from "@google/genai";
import { readFile, stat } from "fs/promises";
import { extname } from "path";
import { loadConfig, type GroundingMode, type ThinkingLevel } from "./config.js";
import { calculateUsage, type UsageReport } from "./pricing.js";
import {
  appendManifest,
  checkRateLimit,
  getSessionStats,
  recordGeneration,
  type SessionStats,
} from "./tracker.js";
import { log, resolveOutputDir, saveImage } from "./utils.js";
import {
  applyOptionalBackgroundRemoval,
  buildPromptText,
  type RemoveBgOptions,
} from "./background.js";

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
};

// Video formats the Files API accepts for video-to-image input (3.1-flash family).
const VIDEO_MIME_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mpeg": "video/mpeg",
  ".mpg": "video/mpeg",
  ".mov": "video/quicktime",
  ".avi": "video/x-msvideo",
  ".webm": "video/webm",
  ".wmv": "video/x-ms-wmv",
  ".flv": "video/x-flv",
  ".3gp": "video/3gpp",
  ".3gpp": "video/3gpp",
};

export interface GenerateImageParams {
  prompt: string;
  images?: string[];
  videos?: string[];
  model?: string;
  aspectRatio?: string;
  resolution?: string;
  outputDir?: string;
  filename?: string;
  subfolder?: string;
  sessionId?: string;
  seed?: number;
  /** Search grounding mode. "web" = Google Search; "web+image" adds image results (3.1-flash only). */
  grounding?: GroundingMode;
  /** Thinking depth (3.1-flash family). Default MINIMAL keeps cost/latency down; HIGH for text/diagram-heavy renders. */
  thinkingLevel?: ThinkingLevel;
  removeBackground?: RemoveBgOptions;
}

export interface GroundingInfo {
  chunks: { uri?: string; title?: string }[];
  searchQueries: string[];
  searchEntryPointHtml?: string;
}

export interface GenerateImageResult {
  imagePath: string;
  mimeType: string;
  model: string;
  sessionId?: string;
  sessionTurn?: number;
  usage: UsageReport;
  session: SessionStats;
  backgroundRemoved?: boolean;
  operations?: string[];
  warning?: string;
  grounding?: GroundingInfo;
}

// Bare-name fragments that mark a model as image-capable. The API exposes no
// "image output" capability flag, so we match on the model name.
const IMAGE_MODEL_PATTERNS = ["image", "img"];

export interface DiscoverableModel {
  name?: string;
  supportedActions?: string[];
  supportedGenerationMethods?: string[];
}

/**
 * Decide whether a discovered model is usable by this server: its name must look
 * image-capable AND it must support the `generateContent` action we call. This
 * defers "what counts as a usable image model" to the live API instead of a
 * hardcoded allowlist — Imagen models (which expose only `predict`) drop out
 * naturally, with no model-name special-casing. If the API reports no actions
 * for a model we include it (safe direction: list it and let per-request
 * validation or the API reject, rather than hiding a model on missing metadata).
 * Exported for unit testing.
 */
export function isUsableImageModel(model: DiscoverableModel): boolean {
  const name = (model.name ?? "").replace("models/", "");
  const looksImage = IMAGE_MODEL_PATTERNS.some((p) => name.includes(p));
  if (!looksImage) return false;
  const actions = model.supportedActions ?? model.supportedGenerationMethods ?? [];
  return actions.length === 0 || actions.includes("generateContent");
}

/**
 * Assemble the `config` object for ai.models.generateContent from request params.
 * Pure and exported for unit testing — no live-client dependency.
 * - responseModalities: IMAGE-only for single-shot text-to-image (prevents text-only
 *   responses); TEXT+IMAGE when editing with inputs or continuing a session
 *   (the model must read the instruction and preserve thoughtSignature history).
 * - aspectRatio/resolution map into imageConfig (omitted entirely when empty).
 * - grounding: "web" attaches the googleSearch tool; "web+image" adds image-search
 *   results via searchTypes (3.1-flash only; the API rejects it elsewhere). The
 *   deprecated useSearchGrounding boolean maps to "web" when grounding is unset.
 * - thinkingLevel maps into thinkingConfig (3.1-flash family; API validates).
 */
export function buildGenerateConfig(
  params: Pick<
    GenerateImageParams,
    "aspectRatio" | "resolution" | "seed" | "grounding" | "thinkingLevel"
  >,
  opts: { needsTextMode: boolean },
): Record<string, unknown> {
  const imageConfig: Record<string, string> = {};
  if (params.aspectRatio) imageConfig.aspectRatio = params.aspectRatio;
  if (params.resolution) imageConfig.imageSize = params.resolution;

  const generateConfig: Record<string, unknown> = {
    responseModalities: opts.needsTextMode ? ["TEXT", "IMAGE"] : ["IMAGE"],
  };
  if (Object.keys(imageConfig).length > 0) generateConfig.imageConfig = imageConfig;
  if (params.seed !== undefined) generateConfig.seed = params.seed;

  if (params.grounding === "web+image") {
    generateConfig.tools = [{ googleSearch: { searchTypes: { imageSearch: {}, webSearch: {} } } }];
  } else if (params.grounding === "web") {
    generateConfig.tools = [{ googleSearch: {} }];
  }

  if (params.thinkingLevel) {
    generateConfig.thinkingConfig = { thinkingLevel: params.thinkingLevel };
  }
  return generateConfig;
}

let cachedAvailableModels: string[] | null = null;

// --- Multi-turn session management ---

interface ConversationSession {
  history: Content[];
  model: string;
  lastAccessed: number;
}

const sessions = new Map<string, ConversationSession>();
const MAX_SESSION_TURNS = 10;

function getSessionTimeout(): number {
  return loadConfig().sessionTimeout;
}

function cleanupSessions(): void {
  const timeout = getSessionTimeout();
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastAccessed > timeout) {
      log.info(`Session ${id} expired after ${timeout / 1000}s inactivity`);
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
      if (isUsableImageModel(model)) {
        imageModels.push((model.name ?? "").replace("models/", ""));
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

/**
 * Shared extension/size validation for local input files (images, videos).
 * Returns the MIME type. Error messages are part of the tool contract — keep
 * the "Unsupported <kind> format" / "Failed to read <kind> file" shapes stable.
 */
async function validateLocalFile(
  filepath: string,
  mimeTypes: Record<string, string>,
  maxBytes: number,
  kind: "image" | "video",
): Promise<string> {
  const ext = extname(filepath).toLowerCase();
  const mimeType = mimeTypes[ext];
  if (!mimeType) {
    throw new Error(
      `Unsupported ${kind} format "${ext}" for file: ${filepath}. ` +
        `Supported: ${Object.keys(mimeTypes).join(", ")}`,
    );
  }
  let fileStat;
  try {
    fileStat = await stat(filepath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to read ${kind} file "${filepath}": ${msg}`);
  }
  if (fileStat.size > maxBytes) {
    throw new Error(
      `${kind === "image" ? "Image" : "Video"} file is ${Math.round(fileStat.size / 1024 / 1024)}MB, ` +
        `max is ${Math.round(maxBytes / 1024 / 1024)}MB.`,
    );
  }
  return mimeType;
}

async function readImageAsInlineData(
  filepath: string,
): Promise<{ inlineData: { data: string; mimeType: string } }> {
  const MAX_IMAGE_SIZE = 50 * 1024 * 1024; // 50MB
  const mimeType = await validateLocalFile(filepath, MIME_TYPES, MAX_IMAGE_SIZE, "image");

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

/**
 * Best-effort delete of an uploaded Files API object. Never throws — a failed
 * delete is quota leakage, not a request failure, so it's logged at debug.
 */
async function deleteUploadedFile(ai: GoogleGenAI, file: GenaiFile): Promise<void> {
  if (!file.name) return;
  try {
    await ai.files.delete({ name: file.name });
  } catch (err) {
    log.debug(`[video] failed to delete uploaded file ${file.name}:`, String(err));
  }
}

/**
 * Upload a local video to the Files API and wait for it to finish server-side
 * processing (uploads land in PROCESSING and only become usable when ACTIVE).
 * On FAILED/timeout the file is deleted BEFORE throwing — the upload exists in
 * the user's Files API storage from the moment files.upload resolves, and no
 * caller-side cleanup can know its name if we just throw.
 */
async function uploadVideoAndWait(ai: GoogleGenAI, filepath: string): Promise<GenaiFile> {
  const MAX_VIDEO_SIZE = 500 * 1024 * 1024; // keep well under the Files API 2GB cap
  const mimeType = await validateLocalFile(filepath, VIDEO_MIME_TYPES, MAX_VIDEO_SIZE, "video");

  const uploaded = await ai.files.upload({ file: filepath, config: { mimeType } });
  let file = uploaded;
  const deadline = Date.now() + 120_000;
  while (file.state !== "ACTIVE") {
    if (file.state === "FAILED") {
      await deleteUploadedFile(ai, uploaded);
      const reason = file.error?.message ? ` — ${file.error.message}` : "";
      throw new Error(
        `Video "${filepath}" failed processing on the Files API (state FAILED)${reason}.`,
      );
    }
    if (Date.now() > deadline) {
      await deleteUploadedFile(ai, uploaded);
      throw new Error(
        `Timed out (120s) waiting for video "${filepath}" to become ACTIVE on the Files API ` +
          `(last state: ${file.state ?? "unknown"}).`,
      );
    }
    await new Promise((r) => setTimeout(r, 2000));
    file = await ai.files.get({ name: uploaded.name! });
  }
  return file;
}

/**
 * Upload videos in parallel, hand the ACTIVE files to `fn`, then delete every
 * successful upload — awaited, on ANY outcome (a later upload failing, fn
 * throwing, or success). allSettled for the uploads means cleanup only runs
 * once every upload has resolved or deleted-itself-and-thrown, so no file can
 * slip past the finally. Exported for unit tests (takes the client as a param).
 */
export async function withUploadedVideos<T>(
  ai: GoogleGenAI,
  paths: string[],
  fn: (files: GenaiFile[]) => Promise<T>,
): Promise<T> {
  const uploaded: GenaiFile[] = [];
  try {
    const results = await Promise.allSettled(
      paths.map(async (p) => {
        const f = await uploadVideoAndWait(ai, p);
        uploaded.push(f);
        return f;
      }),
    );
    const rejection = results.find((r) => r.status === "rejected") as
      | PromiseRejectedResult
      | undefined;
    if (rejection) throw rejection.reason;
    const files = results.map((r) => (r as PromiseFulfilledResult<GenaiFile>).value);
    return await fn(files);
  } finally {
    await Promise.allSettled(uploaded.map((f) => deleteUploadedFile(ai, f)));
  }
}

const MAX_GROUNDING_ITEMS = 5;

interface GroundingMetadataLike {
  groundingChunks?: {
    web?: { uri?: string; title?: string };
    image?: { sourceUri?: string; title?: string };
  }[];
  webSearchQueries?: string[];
  searchEntryPoint?: { renderedContent?: string };
}

/**
 * Map a response's groundingMetadata to the provenance we surface to callers.
 * Reads BOTH chunk variants — web (uri/title) and image-search (sourceUri/title) —
 * so 'web+image' grounding doesn't silently drop its image sources. Pure and
 * exported for unit tests.
 */
export function extractGroundingInfo(meta: GroundingMetadataLike | undefined): GroundingInfo | undefined {
  if (!meta) return undefined;
  const chunks = (meta.groundingChunks ?? [])
    .map((c) => ({
      uri: c.web?.uri ?? c.image?.sourceUri,
      title: c.web?.title ?? c.image?.title,
    }))
    .filter((c) => c.uri)
    .slice(0, MAX_GROUNDING_ITEMS);
  const searchQueries = (meta.webSearchQueries ?? []).slice(0, MAX_GROUNDING_ITEMS);
  const searchEntryPointHtml = meta.searchEntryPoint?.renderedContent;
  if (!chunks.length && !searchQueries.length && !searchEntryPointHtml) return undefined;
  return { chunks, searchQueries, searchEntryPointHtml };
}

export async function generateImage(
  params: GenerateImageParams,
): Promise<GenerateImageResult> {
  const config = loadConfig();
  const model = params.model ?? config.defaultModel;
  const timeoutMs = config.requestTimeout;

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

  // Add input images first if provided (for editing) — read in parallel
  if (params.images?.length) {
    log.info(`Loading ${params.images.length} input image(s)`);
    const imageParts = await Promise.all(params.images.map(readImageAsInlineData));
    userParts.push(...imageParts);
  }

  // Video-to-image input (3.1-flash family): one-shot by design — sessions are
  // text+image only, so videos can't continue a session and (below) don't start one.
  const hasVideos = !!params.videos?.length;
  if (hasVideos && params.sessionId) {
    throw new Error(
      "videos cannot be combined with sessionId — start a fresh request for video-to-image.",
    );
  }

  // Add the text prompt. For chroma/threshold removal a background instruction is
  // appended so the model produces a keyable solid background; "auto" needs none.
  userParts.push({ text: buildPromptText(params.prompt, params.removeBackground) });

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
    if (sessionTurn > MAX_SESSION_TURNS) {
      throw new Error(
        `Session "${sessionId}" has reached the maximum of ${MAX_SESSION_TURNS} turns. ` +
          "Start a new session to continue.",
      );
    }
    log.info(`Continuing session ${sessionId}, turn ${sessionTurn}`);
  } else {
    contents = [{ role: "user", parts: userParts }];
    // Auto-create a session for multi-turn editing — but NOT for video turns: the
    // uploaded files are deleted after the call, so a stored session would replay
    // dead fileData URIs on the next turn and fail at the API.
    if (!sessionId && !hasVideos) {
      sessionId = generateSessionId();
    }
  }

  // Build config (extracted to buildGenerateConfig so the modality / imageConfig /
  // grounding wiring is unit-testable without the live client). abortSignal is
  // attached just before the call below.
  const isSession = !!(sessionId && sessions.has(sessionId));
  const hasInputImages = !!(params.images?.length);
  const generateConfig = buildGenerateConfig(params, {
    needsTextMode: isSession || hasInputImages || hasVideos,
  });

  const startTime = Date.now();

  // Upload any videos (parallel; withUploadedVideos deletes them awaited on any
  // outcome), then call the Gemini API with timeout. When there are no videos the
  // helper is a pass-through.
  let response;
  try {
    response = await withUploadedVideos(ai, params.videos ?? [], async (videoFiles) => {
      if (hasVideos) log.info(`Uploading ${videoFiles.length} input video(s)`);
      for (const file of videoFiles) {
        if (!file.uri || !file.mimeType) {
          throw new Error(
            `Video upload "${file.name ?? "unknown"}" became ACTIVE but returned no playable URI — ` +
              "cannot use it as input.",
          );
        }
        // Video parts go before the text prompt (which is userParts' last element).
        userParts.splice(userParts.length - 1, 0, {
          fileData: { fileUri: file.uri, mimeType: file.mimeType },
        });
        contents = [{ role: "user", parts: userParts }];
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      generateConfig.abortSignal = controller.signal;
      try {
        return await ai.models.generateContent({
          model,
          contents,
          config: generateConfig,
        });
      } finally {
        clearTimeout(timeout);
      }
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(
        `Gemini API request timed out after ${timeoutMs}ms. ` +
          "Try a simpler prompt or increase REQUEST_TIMEOUT_MS.",
      );
    }
    // Gemini API errors from @google/genai include the response body (status + JSON);
    // no API keys are present (the key travels as a request header, not in error messages).
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Gemini API error: ${msg}`);
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
        "Check gemini-mcp.log under your outputDir (default ~/gemini-images) with LOG_LEVEL=debug for details.",
    );
  }

  // Surface grounding provenance when search grounding was used. Google's ToS require
  // displaying the search suggestions entry point when grounding results are shown, so
  // searchEntryPointHtml (render-ready HTML) is passed through for the client to display.
  const grounding = extractGroundingInfo(response.candidates?.[0]?.groundingMetadata);

  // Optional one-call background removal → transparent PNG. Runs locally on the
  // generated image and NEVER discards a paid generation: applyOptionalBackgroundRemoval
  // falls back to the opaque image with a warning if removal throws.
  const removal = await applyOptionalBackgroundRemoval(imageData, imageMimeType, params.removeBackground);
  imageData = removal.imageData;
  imageMimeType = removal.mimeType;
  const operations = removal.operations;
  const backgroundRemoved = removal.backgroundRemoved;
  const warning = removal.warning;

  // Save image
  const outputDir = resolveOutputDir(params.outputDir, config.outputDir);
  const imagePath = await saveImage({
    base64Data: imageData,
    outputDir,
    mimeType: imageMimeType,
    filename: params.filename,
    subfolder: params.subfolder,
  });

  // Calculate usage (config pricing overrides take precedence over the built-in table)
  const usage = calculateUsage(model, response.usageMetadata, config.pricingOverrides);
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
    inputVideos: params.videos?.length ?? 0,
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
    backgroundRemoved: backgroundRemoved || undefined,
    operations: operations.length ? operations : undefined,
    warning,
    grounding,
  };
}
