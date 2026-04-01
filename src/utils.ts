import { createHash } from "crypto";
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

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

export const log = {
  debug: (...args: unknown[]) => {
    if (shouldLog("debug")) console.error("[DEBUG]", ...args);
  },
  info: (...args: unknown[]) => {
    if (shouldLog("info")) console.error("[INFO]", ...args);
  },
  error: (...args: unknown[]) => {
    if (shouldLog("error")) console.error("[ERROR]", ...args);
  },
};

// --- File Utilities ---

export function resolveOutputDir(perRequest?: string): string {
  if (perRequest) return resolve(perRequest);
  if (process.env.OUTPUT_DIR) return resolve(process.env.OUTPUT_DIR);
  return join(homedir(), "gemini-images");
}

export function generateFilename(): string {
  const timestamp = Date.now();
  const hash = createHash("md5")
    .update(`${timestamp}-${Math.random()}`)
    .digest("hex")
    .slice(0, 6);
  return `gemini-${timestamp}-${hash}.png`;
}

export async function saveImage(
  base64Data: string,
  outputDir: string,
): Promise<string> {
  await mkdir(outputDir, { recursive: true });
  const filename = generateFilename();
  const filepath = join(outputDir, filename);
  const buffer = Buffer.from(base64Data, "base64");
  await writeFile(filepath, buffer);
  log.info(`Image saved: ${filepath} (${buffer.length} bytes)`);
  return filepath;
}
