#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";
import { discoverModels, generateImage, getAvailableModels } from "./generate.js";
import { processImage } from "./process.js";
import { loadConfig, initConfig } from "./config.js";
import { log, setLogLevel } from "./utils.js";

const server = new McpServer(
  {
    name: "gemini-image-mcp",
    version: "0.2.0",
  },
  {
    instructions:
      "Gemini image generation and local image processing. Two tools: generate_image (AI-powered, costs money) " +
      "and process_image (local via sharp, free). " +
      "Configuration can be set via a JSON config file — run `npx @jimothy-snicket/gemini-image-mcp --init` to create " +
      "~/.gemini-image-mcp.json with commented defaults. A local .gemini-image-mcp.json in the project directory " +
      "can override global settings. Priority: per-request params > env vars > local config > global config > defaults. " +
      "Config supports per-tool defaults (e.g. default aspect ratio, resolution, or always removing backgrounds) " +
      "so users don't have to specify them every time.",
  },
);

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
        .optional(z.array(z.string()).max(14))
        .describe(
          "File paths to input/reference images for editing (max 14). Omit for text-to-image generation",
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
        .describe("Image aspect ratio. Defaults to config value or 1:1"),
      resolution: z
        .optional(z.enum(["1K", "2K", "4K"]))
        .describe("Image resolution. Defaults to config value or 1K. 2K/4K only on gemini-3-pro and gemini-3.1-flash. gemini-2.5-flash is 1K only."),
      outputDir: z
        .optional(z.string())
        .describe(
          "Directory to save the image. Defaults to config file outputDir, OUTPUT_DIR env var, or ~/gemini-images",
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
      const config = loadConfig();
      const result = await generateImage({
        prompt: args.prompt,
        images: args.images,
        model: args.model,
        aspectRatio: args.aspectRatio ?? config.defaults.generate.aspectRatio,
        resolution: args.resolution ?? config.defaults.generate.resolution,
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
              "Brightness threshold (0-255). Pixels above this become transparent. Default 240. Ignored if color is set.",
            ),
            color: z.optional(z.string()).describe(
              "Hex color to remove (e.g. '#00FF00' for green screen). " +
              "Use #00FF00 for AI-generated green screens — works better than matching the exact background shade.",
            ),
            tolerance: z.optional(z.number().int().min(0).max(255)).describe(
              "Color match tolerance (0-255). How different a pixel can be from the target color and still be removed. Default 80.",
            ),
          }),
        )
        .describe("Remove background. Use threshold for white backgrounds, or color for chroma key (green screen)."),
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
        .describe("Directory to save. Defaults to config file outputDir, OUTPUT_DIR env var, or ~/gemini-images"),
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
      const config = loadConfig();
      const result = await processImage({
        imagePath: args.imagePath,
        crop: args.crop,
        resize: args.resize,
        removeBackground: args.removeBackground ?? config.defaults.process.removeBackground,
        trim: args.trim ?? config.defaults.process.trim,
        format: (args.format ?? config.defaults.process.format) as "png" | "jpeg" | "webp" | undefined,
        quality: args.quality ?? config.defaults.process.quality,
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
  // Handle --init before anything else (CLI mode, not MCP mode)
  if (process.argv.includes("--init")) {
    const local = process.argv.includes("--local");
    const force = process.argv.includes("--force");
    const { homedir } = await import("os");
    const { join } = await import("path");
    const targetPath = local
      ? join(process.cwd(), ".gemini-image-mcp.json")
      : join(homedir(), ".gemini-image-mcp.json");

    try {
      initConfig({ targetPath, force });
      console.log(`\nConfig file created: ${targetPath}\n`);
      console.log("Edit this file to set your defaults. All fields are optional —");
      console.log("anything you don't set will use the built-in default.\n");
      console.log("Environment variables always override config file values.\n");
      if (!local) {
        console.log("For project-specific overrides, also run:");
        console.log("  npx @jimothy-snicket/gemini-image-mcp --init --local\n");
      }
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
    process.exit(0);
  }

  // Load config and update log level
  const config = loadConfig();
  setLogLevel(config.logLevel as "debug" | "info" | "error");

  log.info("Gemini Image MCP server starting");
  log.info(`  Node: ${process.version}`);
  log.info(`  PID: ${process.pid}`);
  log.info(`  CWD: ${process.cwd()}`);
  log.info(`  GEMINI_API_KEY: ${process.env.GEMINI_API_KEY ? "set" : "NOT SET"}`);

  if (!process.env.GEMINI_API_KEY) {
    log.error(
      "GEMINI_API_KEY environment variable is not set. " +
        "Get a key at https://aistudio.google.com/apikey",
    );
    process.exit(1);
  }

  log.info(`  Model: ${config.defaultModel}`);
  log.info(`  Output: ${config.outputDir}`);
  log.info(`  Log level: ${config.logLevel}`);
  if (config.maxRequestsPerHour > 0 || config.maxCostPerHour > 0) {
    log.info(`  Rate limits: ${config.maxRequestsPerHour > 0 ? config.maxRequestsPerHour + " req/hr" : "unlimited"}, ${config.maxCostPerHour > 0 ? "$" + config.maxCostPerHour + "/hr" : "unlimited cost"}`);
  } else {
    log.info("  Rate limits: none configured. Set maxRequestsPerHour / maxCostPerHour in config or env.");
  }

  // Discover available image models (also validates the API key)
  try {
    const models = await discoverModels();
    log.info(`  Available image models (${models.length}): ${models.join(", ")}`);
    if (models.length === 0) {
      log.error("No image-capable models found for this API key.");
    } else if (!models.includes(config.defaultModel)) {
      log.error(
        `Default model "${config.defaultModel}" not found in available models. ` +
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
