import sharp from "sharp";
import { log } from "./utils.js";

// Shared background-removal engine used by both generate_image and process_image.
//
// Three modes:
//   - "auto"      → AI semantic matte (BiRefNet via transformers.js). Works on ANY
//                   subject/colour, needs no special prompt. Lazy-loaded; the model
//                   downloads once on first use, then runs locally (pure-WASM capable,
//                   no native binary required).
//   - "chroma"    → HSV green-screen key (the original sharp pipeline). Zero-dep, instant.
//   - "threshold" → near-white removal (line art / logos). Zero-dep, instant.

export type RemoveBgMode = "auto" | "chroma" | "threshold";

export interface RemoveBgOptions {
  mode?: RemoveBgMode;
  /** Chroma-key target hex, e.g. "#00FF00" (chroma mode). */
  color?: string;
  /** Chroma hue tolerance 0-255 (chroma mode). */
  tolerance?: number;
  /** White brightness cutoff 0-255 (threshold mode). */
  threshold?: number;
}

export const DEFAULT_CHROMA_COLOR = "#00FF00";
export const DEFAULT_TOLERANCE = 80;
export const DEFAULT_THRESHOLD = 240;

// BiRefNet lite — MIT-licensed, transformers.js-compatible semantic matting model.
export const MATTE_MODEL_ID = "onnx-community/BiRefNet_lite-ONNX";

// --- Chroma-key helpers (moved verbatim from process.ts; behaviour unchanged) ---

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return [h, s, max];
}

function hueDist(h1: number, h2: number): number {
  const d = Math.abs(h1 - h2);
  return Math.min(d, 360 - d);
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Chroma-key (when `color` is set) or white-threshold removal on a raw RGBA pixel
 * buffer, in place, followed by a 5-pass inward edge feather. Returns an operation
 * label. Lifted verbatim from the original inline processImage implementation so
 * the chroma/threshold output is byte-for-byte identical.
 */
export function keyBackgroundPixels(
  pixels: Buffer,
  width: number,
  height: number,
  opts: { color?: string; tolerance?: number; threshold?: number },
): string {
  let operation: string;
  const color = opts.color;
  const tolerance = opts.tolerance ?? DEFAULT_TOLERANCE;

  if (color) {
    // HSV-based chroma key with smoothstep feather and spill suppression
    const hex = color.replace("#", "");
    const targetR = parseInt(hex.slice(0, 2), 16);
    const targetG = parseInt(hex.slice(2, 4), 16);
    const targetB = parseInt(hex.slice(4, 6), 16);
    const [targetH] = rgbToHsv(targetR, targetG, targetB);

    // Tolerance maps to hue degrees — wide feather for anti-aliased edges
    const hueHard = tolerance * 0.6;
    const hueSoft = tolerance * 1.4;
    const minSat = 0.12;
    const minVal = 0.08;

    // Pass 1: Alpha keying in HSV space
    for (let i = 0; i < pixels.length; i += 4) {
      const [h, s, v] = rgbToHsv(pixels[i], pixels[i + 1], pixels[i + 2]);
      if (s < minSat || v < minVal) continue; // skip grey/dark pixels

      const hd = hueDist(h, targetH);
      if (hd <= hueHard) {
        pixels[i + 3] = 0;
      } else if (hd <= hueSoft) {
        const alpha = smoothstep(hueHard, hueSoft, hd);
        pixels[i + 3] = Math.min(pixels[i + 3], Math.round(alpha * 255));
      }
    }

    // Pass 2: Spill suppression — remove green fringe on surviving pixels
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] === 0) continue;
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      const spillLimit = (r + b) / 2;
      if (g > spillLimit) {
        const alpha01 = pixels[i + 3] / 255;
        const strength = 1 - alpha01;
        const corrected = spillLimit + (g - spillLimit) * (1 - Math.max(strength, 0.5));
        pixels[i + 1] = Math.round(Math.min(255, corrected));
      }
    }

    operation = `chroma-key(${color},tolerance:${tolerance})`;
  } else {
    // Threshold: remove near-white pixels
    const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      if (r >= threshold && g >= threshold && b >= threshold) {
        pixels[i + 3] = 0;
      }
    }
    operation = `remove-bg(threshold:${threshold})`;
  }

  // Edge softening: 5 passes of 3x3 neighbourhood alpha averaging (inward only).
  // Creates a smooth anti-aliased edge gradient without expanding outward.
  for (let pass = 0; pass < 5; pass++) {
    const alphaSnapshot = new Uint8Array(width * height);
    for (let i = 0; i < alphaSnapshot.length; i++) alphaSnapshot[i] = pixels[i * 4 + 3];

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const a = alphaSnapshot[idx];
        if (a === 0) continue;

        let sum = 0, count = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              sum += alphaSnapshot[ny * width + nx];
              count++;
            }
          }
        }
        pixels[idx * 4 + 3] = Math.min(a, Math.round(sum / count));
      }
    }
  }

  return operation;
}

// --- ML semantic matte (lazy-loaded; never touches server startup) ---

// Cached pipeline promise. transformers.js + the model are only imported/loaded
// the first time an "auto" removal is requested, so startup stays light.
let mattePipelinePromise: Promise<unknown> | null = null;

async function loadMattePipeline(): Promise<unknown> {
  if (!mattePipelinePromise) {
    mattePipelinePromise = (async () => {
      const { pipeline } = await import("@huggingface/transformers");
      log.info(
        `[background] loading matte model ${MATTE_MODEL_ID} — first use downloads it once (~one-time), then it is cached locally.`,
      );
      const p = await pipeline("background-removal", MATTE_MODEL_ID);
      log.info("[background] matte model ready");
      return p;
    })().catch((err) => {
      // Reset so a later request can retry (e.g. transient network failure).
      mattePipelinePromise = null;
      throw err;
    });
  }
  return mattePipelinePromise;
}

/**
 * AI semantic matte → returns an RGBA PNG buffer. Works on any subject/background.
 * Throws a clear, actionable error if the model can't be loaded (callers should
 * decide whether to fall back or surface it).
 */
export async function matteToPng(inputBuffer: Buffer): Promise<Buffer> {
  let segmenter: unknown;
  try {
    segmenter = await loadMattePipeline();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Could not load the background-removal model (${MATTE_MODEL_ID}): ${msg}. ` +
        `Use removeBackground { "mode": "chroma" } (green screen) or { "mode": "threshold" } (white) for a zero-dependency alternative.`,
    );
  }

  const { RawImage } = await import("@huggingface/transformers");
  const image = await RawImage.fromBlob(new Blob([new Uint8Array(inputBuffer)]));
  // The background-removal pipeline returns a single RawImage (RGBA) for a single input.
  const result = await (segmenter as (img: unknown) => Promise<unknown>)(image);
  const out = Array.isArray(result) ? result[0] : result;
  return (out as { toSharp(): sharp.Sharp }).toSharp().png().toBuffer();
}

/**
 * Unified entry point. Take an encoded image buffer (any format sharp can read),
 * return a transparent PNG buffer + an operation label.
 *   mode "auto"  → ML matte
 *   mode "chroma"/"threshold" → decode → key in place → re-encode PNG
 */
export async function removeBackgroundToPng(
  inputBuffer: Buffer,
  opts: RemoveBgOptions,
): Promise<{ buffer: Buffer; operation: string }> {
  const mode = resolveMode(opts);

  if (mode === "auto") {
    const buffer = await matteToPng(inputBuffer);
    return { buffer, operation: `matte(${MATTE_MODEL_ID})` };
  }

  const { data, info } = await sharp(inputBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixels = Buffer.from(data);
  const color = mode === "chroma" ? opts.color ?? DEFAULT_CHROMA_COLOR : undefined;
  const operation = keyBackgroundPixels(pixels, info.width, info.height, {
    color,
    tolerance: opts.tolerance,
    threshold: opts.threshold,
  });
  const buffer = await sharp(pixels, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toBuffer();
  return { buffer, operation };
}

/**
 * Resolve the effective mode. Precedence: explicit `mode` → a `color` hint implies
 * chroma → a `threshold` hint implies threshold → otherwise `fallback`.
 *
 * Callers supply the fallback so each tool keeps the right default:
 *   - generate_image passes the default "auto" (semantic matte is the headline).
 *   - process_image passes "threshold" to preserve its legacy behaviour
 *     (no hints → threshold; a bare `{}` does NOT trigger a model download).
 */
export function resolveMode(opts: RemoveBgOptions, fallback: RemoveBgMode = "auto"): RemoveBgMode {
  if (opts.mode) return opts.mode;
  if (opts.color) return "chroma";
  if (opts.threshold !== undefined) return "threshold";
  return fallback;
}

/**
 * The instruction appended to a generate_image prompt so the model produces a
 * background the chosen keyer can remove. "auto" (semantic matte) needs none.
 */
export function backgroundPromptSuffix(opts: RemoveBgOptions): string {
  const mode = resolveMode(opts);
  if (mode === "chroma") {
    const color = opts.color ?? DEFAULT_CHROMA_COLOR;
    return (
      ` Place the subject on a solid, uniform ${color} chroma-key background with even, ` +
      `flat lighting — no shadows cast on the background and no colour spill onto the subject.`
    );
  }
  if (mode === "threshold") {
    return " Place the subject on a solid pure-white (#FFFFFF) background with even lighting and no shadows.";
  }
  return ""; // auto: the matte handles any background
}
