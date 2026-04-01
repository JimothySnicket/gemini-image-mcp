import { createHash } from "crypto";
import { appendFileSync, mkdirSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import { homedir } from "os";
import { join, resolve } from "path";

// --- Logging ---

type LogLevel = "debug" | "info" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  error: 2,
};

const currentLevel: LogLevel =
  (process.env.LOG_LEVEL as LogLevel) ?? "info";

const LOG_DIR = join(homedir(), "gemini-images");
const LOG_FILE = join(LOG_DIR, "gemini-mcp.log");

function writeToLogFile(level: string, args: unknown[]) {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    const timestamp = new Date().toISOString();
    const message = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
    appendFileSync(LOG_FILE, `${timestamp} [${level}] ${message}\n`);
  } catch {
    // If we can't write to the log file, don't crash the server
  }
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

export const log = {
  debug: (...args: unknown[]) => {
    if (shouldLog("debug")) {
      console.error("[DEBUG]", ...args);
      writeToLogFile("DEBUG", args);
    }
  },
  info: (...args: unknown[]) => {
    if (shouldLog("info")) {
      console.error("[INFO]", ...args);
      writeToLogFile("INFO", args);
    }
  },
  error: (...args: unknown[]) => {
    if (shouldLog("error")) {
      console.error("[ERROR]", ...args);
      writeToLogFile("ERROR", args);
    }
  },
};

// --- File Utilities ---

export function resolveOutputDir(perRequest?: string): string {
  if (perRequest) return resolve(perRequest);
  if (process.env.OUTPUT_DIR) return resolve(process.env.OUTPUT_DIR);
  return join(homedir(), "gemini-images");
}

const MIME_TO_EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

export function generateFilename(mimeType: string): string {
  const timestamp = Date.now();
  const hash = createHash("md5")
    .update(`${timestamp}-${Math.random()}`)
    .digest("hex")
    .slice(0, 6);
  const ext = MIME_TO_EXT[mimeType] ?? ".png";
  return `gemini-${timestamp}-${hash}${ext}`;
}

export async function saveImage(
  base64Data: string,
  outputDir: string,
  mimeType: string,
): Promise<string> {
  await mkdir(outputDir, { recursive: true });
  const filename = generateFilename(mimeType);
  const filepath = join(outputDir, filename);
  const buffer = Buffer.from(base64Data, "base64");
  await writeFile(filepath, buffer);
  log.info(`Image saved: ${filepath} (${buffer.length} bytes)`);
  return filepath;
}
