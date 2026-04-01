#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";
import { generateImage } from "./generate.js";
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

  log.info(`  Model: ${defaultModel}`);
  log.info(`  Output: ${outputDir}`);
  log.info(`  Log level: ${logLevel}`);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info("Server running on stdio");
}

main().catch((err) => {
  log.error("Fatal:", err);
  process.exit(1);
});
