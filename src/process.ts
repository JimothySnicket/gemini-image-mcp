import sharp from "sharp";
import { existsSync } from "fs";
import { extname } from "path";
import { log, resolveOutputDir, saveImage } from "./utils.js";

export interface ProcessImageParams {
  imagePath: string;
  crop?: { width: number; height: number; left?: number; top?: number };
  resize?: { width?: number; height?: number };
  removeBackground?: { threshold?: number };
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
    const threshold = params.removeBackground.threshold ?? 240;
    // Get raw pixel data with alpha channel
    const { data, info } = await pipeline
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    // Make near-white pixels transparent
    const pixels = Buffer.from(data);
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      if (r >= threshold && g >= threshold && b >= threshold) {
        pixels[i + 3] = 0;
      }
    }

    // Rebuild pipeline from modified pixels
    pipeline = sharp(pixels, {
      raw: { width: info.width, height: info.height, channels: 4 },
    });
    operations.push(`remove-bg(threshold:${threshold})`);
  }

  if (params.crop) {
    pipeline = pipeline.extract({
      left: params.crop.left ?? 0,
      top: params.crop.top ?? 0,
      width: params.crop.width,
      height: params.crop.height,
    });
    operations.push(`crop(${params.crop.width}x${params.crop.height})`);
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
