import sharp from "sharp";
import { existsSync, statSync } from "fs";
import { log, resolveOutputDir, saveImage } from "./utils.js";
import { loadConfig } from "./config.js";
import {
  keyBackgroundPixels,
  matteToPng,
  resolveMode,
  type RemoveBgOptions,
  MATTE_MODEL_ID,
  DEFAULT_CHROMA_COLOR,
} from "./background.js";

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
  removeBackground?: RemoveBgOptions;
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

  // Cap input size (mirrors generate_image's 50MB guard). "auto" matte in particular
  // decodes the whole image into memory; this bounds a looping agent's footprint.
  const MAX_IMAGE_SIZE = 50 * 1024 * 1024;
  const inputSize = statSync(params.imagePath).size;
  if (inputSize > MAX_IMAGE_SIZE) {
    throw new Error(`Image file is ${Math.round(inputSize / 1024 / 1024)}MB, max is 50MB.`);
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
    const rb = params.removeBackground;
    // process_image keeps its legacy default (threshold) when no mode/hints given.
    const mode = resolveMode(rb, "threshold");
    if (mode === "auto") {
      // AI semantic matte: break the pipeline to a PNG buffer, matte it, resume.
      const interim = await pipeline.png().toBuffer();
      const matted = await matteToPng(interim);
      pipeline = sharp(matted);
      operations.push(`matte(${MATTE_MODEL_ID})`);
    } else {
      // Chroma-key / threshold: key raw RGBA pixels in place (no encode round-trip).
      const { data, info } = await pipeline
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const pixels = Buffer.from(data);
      const color = mode === "chroma" ? rb.color ?? DEFAULT_CHROMA_COLOR : undefined;
      const operation = keyBackgroundPixels(pixels, info.width, info.height, {
        color,
        tolerance: rb.tolerance,
        threshold: rb.threshold,
      });
      operations.push(operation);
      pipeline = sharp(pixels, {
        raw: { width: info.width, height: info.height, channels: 4 },
      });
    }
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
    const bothDims = !!(params.resize.width && params.resize.height);
    pipeline = pipeline.resize({
      width: params.resize.width,
      height: params.resize.height,
      fit: bothDims ? "cover" : "inside",
      withoutEnlargement: !bothDims,
    });
    const w = params.resize.width ?? "auto";
    const h = params.resize.height ?? "auto";
    operations.push(`resize(${w}x${h})`);
  }

  // Determine output format. If we removed the background, force an alpha-capable
  // format (PNG) unless the caller explicitly chose one — otherwise a JPEG input would
  // re-encode to JPEG and silently flatten the transparency we just computed.
  const outputFormat =
    params.format ??
    (params.removeBackground ? "png" : (metadata.format as "png" | "jpeg" | "webp")) ??
    "png";
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
  const config = loadConfig();
  const outputDir = resolveOutputDir(params.outputDir, config.outputDir);
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
