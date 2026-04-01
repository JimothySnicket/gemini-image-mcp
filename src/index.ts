#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";
import { discoverModels, generateImage, getAvailableModels } from "./generate.js";
import { processImage } from "./process.js";
import { log } from "./utils.js";

const server = new McpServer({
  name: "gemini-image-mcp",
  version: "0.1.0",
});

server.registerTool(
  "generate_image",
  {
    title: "Generate Image",
    description:
      "Generate or edit images using Google Gemini. " +
      "Provide just a prompt for text-to-image generation. " +
      "Add image file paths to edit or use reference images (up to 14 on gemini-3-pro). " +
      "Returns the saved file path, model used, token counts, and estimated cost.",
    inputSchema: {
      prompt: z
        .string()
        .describe(
          "Text description of the image to generate, or editing instruction when images are provided",
        ),
      images: z
        .optional(z.array(z.string()))
        .describe(
          "File paths to input/reference images for editing. Omit for text-to-image generation",
        ),
      model: z
        .optional(z.string())
        .describe(
          "Gemini model ID. Defaults to gemini-2.5-flash-image. " +
            "Options: gemini-2.5-flash-image, gemini-3-pro-image-preview, gemini-3.1-flash-image-preview",
        ),
      aspectRatio: z
        .optional(
          z.enum(["1:1", "16:9", "9:16", "3:2", "2:3", "4:3", "3:4", "21:9"]),
        )
        .describe("Image aspect ratio. Defaults to 1:1"),
      resolution: z
        .optional(z.enum(["1K", "2K", "4K"]))
        .describe("Image resolution. Defaults to 1K. 4K only available on gemini-3-pro"),
      outputDir: z
        .optional(z.string())
        .describe(
          "Directory to save the image. Defaults to OUTPUT_DIR env var or ~/gemini-images",
        ),
      filename: z
        .optional(z.string())
        .describe(
          "Base name for the saved file (e.g. 'hero-banner'). Extension added automatically. " +
            "Duplicates get a version suffix (hero-banner-v2). Omit for auto-generated name.",
        ),
      subfolder: z
        .optional(z.string())
        .describe(
          "Subfolder within the output directory (e.g. 'landing-page'). Created automatically.",
        ),
      sessionId: z
        .optional(z.string())
        .describe(
          "Continue a multi-turn editing session. Pass the sessionId from a previous response " +
            "to refine the image iteratively. The server preserves conversation history.",
        ),
      seed: z
        .optional(z.number().int())
        .describe("Seed for reproducible generation. Same seed + prompt + model = same image."),
      useSearchGrounding: z
        .optional(z.boolean())
        .describe(
          "Enable Google Search grounding for real-world accuracy. " +
            "Available on gemini-3.1-flash-image-preview.",
        ),
    },
  },
  async (args) => {
    try {
      const result = await generateImage({
        prompt: args.prompt,
        images: args.images,
        model: args.model,
        aspectRatio: args.aspectRatio,
        resolution: args.resolution,
        outputDir: args.outputDir,
        filename: args.filename,
        subfolder: args.subfolder,
        sessionId: args.sessionId,
        seed: args.seed,
        useSearchGrounding: args.useSearchGrounding,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error("generate_image failed:", message);
      if (err instanceof Error && err.stack) {
        log.debug("Stack trace:", err.stack);
      }
      return {
        content: [{ type: "text" as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  },
);

server.registerTool(
  "process_image",
  {
    title: "Process Image",
    description:
      "Process an existing image locally using sharp. Crop, resize, remove background, " +
      "convert format, or trim whitespace. Free, fast, no API calls. " +
      "For AI-powered editing (style changes, complex background removal), use generate_image with the image as input instead.",
    inputSchema: {
      imagePath: z.string().describe("Path to the image file to process"),
      crop: z
        .optional(
          z.object({
            width: z.optional(z.number().int()).describe("Crop width in pixels"),
            height: z.optional(z.number().int()).describe("Crop height in pixels"),
            left: z.optional(z.number().int()).describe("Crop X offset (default 0)"),
            top: z.optional(z.number().int()).describe("Crop Y offset (default 0)"),
            aspectRatio: z.optional(z.string()).describe(
              "Crop to aspect ratio (e.g. '16:9', '1:1'). Calculates dimensions automatically.",
            ),
            strategy: z.optional(z.enum(["center", "attention", "entropy"])).describe(
              "Crop strategy when using aspectRatio. 'center' crops from center (default). " +
                "'attention' finds the most visually interesting region. 'entropy' finds the most detailed region.",
            ),
          }),
        )
        .describe("Crop image. Use width+height for pixel-exact, or aspectRatio for ratio-based. Strategy controls where to crop from."),
      resize: z
        .optional(
          z.object({
            width: z.optional(z.number().int()).describe("Target width (maintains aspect if height omitted)"),
            height: z.optional(z.number().int()).describe("Target height (maintains aspect if width omitted)"),
          }),
        )
        .describe("Resize image. Maintains aspect ratio if only width or height given."),
      removeBackground: z
        .optional(
          z.object({
            threshold: z.optional(z.number().int().min(0).max(255)).describe(
              "Brightness threshold (0-255). Pixels above this become transparent. Default 240.",
            ),
          }),
        )
        .describe("Remove near-white background (threshold-based). For complex backgrounds, use generate_image with AI editing."),
      trim: z
        .optional(z.boolean())
        .describe("Auto-trim whitespace borders"),
      format: z
        .optional(z.enum(["png", "jpeg", "webp"]))
        .describe("Convert to format. Defaults to original format."),
      quality: z
        .optional(z.number().int().min(1).max(100))
        .describe("Output quality for JPEG/WebP (1-100). Default 90."),
      outputDir: z
        .optional(z.string())
        .describe("Directory to save. Defaults to OUTPUT_DIR env var or ~/gemini-images"),
      filename: z
        .optional(z.string())
        .describe("Base name for saved file. Auto-versioned if duplicate."),
      subfolder: z
        .optional(z.string())
        .describe("Subfolder within output directory"),
    },
  },
  async (args) => {
    try {
      const result = await processImage({
        imagePath: args.imagePath,
        crop: args.crop,
        resize: args.resize,
        removeBackground: args.removeBackground,
        trim: args.trim,
        format: args.format,
        quality: args.quality,
        outputDir: args.outputDir,
        filename: args.filename,
        subfolder: args.subfolder,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error("process_image failed:", message);
      return {
        content: [{ type: "text" as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  },
);

async function main() {
  log.info("Gemini Image MCP server starting");
  log.info(`  Node: ${process.version}`);
  log.info(`  PID: ${process.pid}`);
  log.info(`  CWD: ${process.cwd()}`);
  log.info(`  GEMINI_API_KEY: ${process.env.GEMINI_API_KEY ? "set (" + process.env.GEMINI_API_KEY.length + " chars)" : "NOT SET"}`);

  if (!process.env.GEMINI_API_KEY) {
    log.error(
      "GEMINI_API_KEY environment variable is not set. " +
        "Get a key at https://aistudio.google.com/apikey",
    );
    process.exit(1);
  }

  const defaultModel = process.env.DEFAULT_MODEL ?? "gemini-2.5-flash-image";
  const outputDir = process.env.OUTPUT_DIR ?? "~/gemini-images";
  const logLevel = process.env.LOG_LEVEL ?? "info";

  const maxReqHour = Number(process.env.MAX_REQUESTS_PER_HOUR) || 0;
  const maxCostHour = Number(process.env.MAX_COST_PER_HOUR) || 0;

  log.info(`  Model: ${defaultModel}`);
  log.info(`  Output: ${outputDir}`);
  log.info(`  Log level: ${logLevel}`);
  if (maxReqHour > 0 || maxCostHour > 0) {
    log.info(`  Rate limits: ${maxReqHour > 0 ? maxReqHour + " req/hr" : "unlimited"}, ${maxCostHour > 0 ? "$" + maxCostHour + "/hr" : "unlimited cost"}`);
  } else {
    log.info("  Rate limits: none configured. Set MAX_REQUESTS_PER_HOUR / MAX_COST_PER_HOUR to limit.");
  }

  // Discover available image models (also validates the API key)
  try {
    const models = await discoverModels();
    log.info(`  Available image models (${models.length}): ${models.join(", ")}`);
    if (models.length === 0) {
      log.error("No image-capable models found for this API key.");
    } else if (!models.includes(defaultModel)) {
      log.error(
        `Default model "${defaultModel}" not found in available models. ` +
          `Available: ${models.join(", ")}`,
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`Model discovery failed: ${msg}`);
    log.info("Server will start anyway — model errors will surface on first request.");
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info("Server running on stdio");
}

main().catch((err) => {
  log.error("Fatal:", err);
  process.exit(1);
});
