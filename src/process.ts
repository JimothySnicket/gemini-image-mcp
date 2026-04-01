import sharp from "sharp";
import { existsSync } from "fs";
import { log, resolveOutputDir, saveImage } from "./utils.js";

// --- Chroma key helpers ---

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

export interface ProcessImageParams {
  imagePath: string;
  crop?: {
    width?: number;
    height?: number;
    left?: number;
    top?: number;
    aspectRatio?: string;
    strategy?: "center" | "attention" | "entropy";
  };
  resize?: { width?: number; height?: number };
  removeBackground?: { threshold?: number; color?: string; tolerance?: number };
  trim?: boolean;
  format?: "png" | "jpeg" | "webp";
  quality?: number;
  outputDir?: string;
  filename?: string;
  subfolder?: string;
}

export interface ProcessImageResult {
  imagePath: string;
  mimeType: string;
  width: number;
  height: number;
  format: string;
  operations: string[];
}

const FORMAT_TO_MIME: Record<string, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export async function processImage(
  params: ProcessImageParams,
): Promise<ProcessImageResult> {
  if (!existsSync(params.imagePath)) {
    throw new Error(`Image not found: ${params.imagePath}`);
  }

  const operations: string[] = [];
  let pipeline = sharp(params.imagePath);

  // Get original metadata for defaults
  const metadata = await sharp(params.imagePath).metadata();
  log.info(`Processing: ${params.imagePath} (${metadata.width}x${metadata.height} ${metadata.format})`);

  // Apply operations in order: trim → removeBackground → crop → resize → format

  if (params.trim) {
    pipeline = pipeline.trim();
    operations.push("trim");
  }

  if (params.removeBackground) {
    // Get raw pixel data with alpha channel
    const { data, info } = await pipeline
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const pixels = Buffer.from(data);
    const color = params.removeBackground.color;
    const tolerance = params.removeBackground.tolerance ?? 50;

    if (color) {
      // HSV-based chroma key with smoothstep feather and spill suppression
      const hex = color.replace("#", "");
      const targetR = parseInt(hex.slice(0, 2), 16);
      const targetG = parseInt(hex.slice(2, 4), 16);
      const targetB = parseInt(hex.slice(4, 6), 16);
      const [targetH] = rgbToHsv(targetR, targetG, targetB);

      // Tolerance maps to hue degrees
      const hueHard = tolerance * 0.7;
      const hueSoft = tolerance * 1.1;
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

      operations.push(`chroma-key(${color},tolerance:${tolerance})`);
    } else {
      // Threshold: remove near-white pixels
      const threshold = params.removeBackground.threshold ?? 240;
      for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i];
        const g = pixels[i + 1];
        const b = pixels[i + 2];
        if (r >= threshold && g >= threshold && b >= threshold) {
          pixels[i + 3] = 0;
        }
      }
      operations.push(`remove-bg(threshold:${threshold})`);
    }

    // Rebuild as PNG, then smooth alpha channel to anti-alias edges
    const keyedPng = await sharp(pixels, {
      raw: { width: info.width, height: info.height, channels: 4 },
    }).png().toBuffer();

    // Extract alpha, blur it for smooth edges, recombine with RGB
    const rgbBuf = await sharp(keyedPng).removeAlpha().png().toBuffer();
    const alphaBuf = await sharp(keyedPng).extractChannel(3).blur(1.2).png().toBuffer();

    pipeline = sharp(rgbBuf).joinChannel(alphaBuf);
  }

  if (params.crop) {
    const imgW = metadata.width ?? 0;
    const imgH = metadata.height ?? 0;

    if (params.crop.aspectRatio) {
      // Parse aspect ratio string like "16:9"
      const [aw, ah] = params.crop.aspectRatio.split(":").map(Number);
      if (!aw || !ah) throw new Error(`Invalid aspect ratio: ${params.crop.aspectRatio}`);

      const strategy = params.crop.strategy ?? "center";

      if (strategy === "attention" || strategy === "entropy") {
        // Smart crop: let sharp find the interesting region
        const fit = strategy === "attention" ? sharp.strategy.attention : sharp.strategy.entropy;
        // Calculate target dimensions that fit within the image at the desired ratio
        const targetW = Math.min(imgW, Math.round(imgH * (aw / ah)));
        const targetH = Math.min(imgH, Math.round(imgW * (ah / aw)));
        pipeline = pipeline.resize({
          width: targetW,
          height: targetH,
          fit: "cover",
          position: fit,
        });
        operations.push(`crop(${params.crop.aspectRatio},${strategy})`);
      } else {
        // Center crop to aspect ratio
        let cropW: number;
        let cropH: number;
        if (imgW / imgH > aw / ah) {
          cropH = imgH;
          cropW = Math.round(imgH * (aw / ah));
        } else {
          cropW = imgW;
          cropH = Math.round(imgW * (ah / aw));
        }
        const left = Math.round((imgW - cropW) / 2);
        const top = Math.round((imgH - cropH) / 2);
        pipeline = pipeline.extract({ left, top, width: cropW, height: cropH });
        operations.push(`crop(${params.crop.aspectRatio},center,${cropW}x${cropH})`);
      }
    } else if (params.crop.width && params.crop.height) {
      // Pixel-exact crop
      pipeline = pipeline.extract({
        left: params.crop.left ?? 0,
        top: params.crop.top ?? 0,
        width: params.crop.width,
        height: params.crop.height,
      });
      operations.push(`crop(${params.crop.width}x${params.crop.height})`);
    } else {
      throw new Error("Crop requires either aspectRatio or both width and height.");
    }
  }

  if (params.resize) {
    pipeline = pipeline.resize({
      width: params.resize.width,
      height: params.resize.height,
      fit: "inside",
      withoutEnlargement: true,
    });
    const w = params.resize.width ?? "auto";
    const h = params.resize.height ?? "auto";
    operations.push(`resize(${w}x${h})`);
  }

  // Determine output format
  const outputFormat = params.format ?? (metadata.format as "png" | "jpeg" | "webp") ?? "png";
  const mimeType = FORMAT_TO_MIME[outputFormat] ?? "image/png";

  if (outputFormat === "jpeg") {
    pipeline = pipeline.jpeg({ quality: params.quality ?? 90 });
  } else if (outputFormat === "webp") {
    pipeline = pipeline.webp({ quality: params.quality ?? 90 });
  } else {
    pipeline = pipeline.png();
  }

  if (params.format) {
    operations.push(`convert(${outputFormat})`);
  }

  // Output to buffer
  const outputBuffer = await pipeline.toBuffer();
  const outputMetadata = await sharp(outputBuffer).metadata();

  // Save
  const outputDir = resolveOutputDir(params.outputDir);
  const base64 = outputBuffer.toString("base64");
  const imagePath = await saveImage({
    base64Data: base64,
    outputDir,
    mimeType,
    filename: params.filename,
    subfolder: params.subfolder,
  });

  log.info(`Processed: ${imagePath} (${outputMetadata.width}x${outputMetadata.height} ${outputFormat}) [${operations.join(", ")}]`);

  return {
    imagePath,
    mimeType,
    width: outputMetadata.width ?? 0,
    height: outputMetadata.height ?? 0,
    format: outputFormat,
    operations,
  };
}
