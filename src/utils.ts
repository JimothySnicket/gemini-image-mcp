import { createHash } from "crypto";
import { appendFileSync, existsSync, mkdirSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import { homedir } from "os";
import { basename, extname, join, resolve } from "path";

// --- Logging ---

type LogLevel = "debug" | "info" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  error: 2,
};

let currentLevel: LogLevel =
  (process.env.LOG_LEVEL as LogLevel) ?? "info";

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

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

function defaultOutputDir(): string {
  if (process.env.OUTPUT_DIR) return resolve(process.env.OUTPUT_DIR);
  return join(homedir(), "gemini-images");
}

export function resolveOutputDir(perRequest?: string, defaultDir?: string): string {
  if (perRequest) return resolve(perRequest);
  if (defaultDir) return resolve(defaultDir);
  // Fallback for backwards compat during transition
  if (process.env.OUTPUT_DIR) return resolve(process.env.OUTPUT_DIR);
  return join(homedir(), "gemini-images");
}

/** Ensure a resolved path is under the allowed base directory. Prevents path traversal. */
function validatePathUnder(candidate: string, base: string): void {
  const resolvedCandidate = resolve(candidate);
  const resolvedBase = resolve(base);
  if (!resolvedCandidate.startsWith(resolvedBase + "/") &&
      !resolvedCandidate.startsWith(resolvedBase + "\\") &&
      resolvedCandidate !== resolvedBase) {
    throw new Error(
      `Path traversal blocked: "${candidate}" resolves outside the output directory.`,
    );
  }
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

function resolveFilename(
  dir: string,
  requestedName: string,
  mimeType: string,
): string {
  const ext = MIME_TO_EXT[mimeType] ?? ".png";
  // Strip any extension the user may have included
  const base = basename(requestedName, extname(requestedName));
  const target = join(dir, `${base}${ext}`);

  if (!existsSync(target)) return `${base}${ext}`;

  // Find next available version
  let version = 2;
  while (existsSync(join(dir, `${base}-v${version}${ext}`))) {
    version++;
  }
  return `${base}-v${version}${ext}`;
}

export interface SaveImageOptions {
  base64Data: string;
  outputDir: string;
  mimeType: string;
  filename?: string;
  subfolder?: string;
}

export async function saveImage(
  opts: SaveImageOptions,
): Promise<string> {
  let dir = opts.outputDir;
  if (opts.subfolder) {
    dir = join(dir, opts.subfolder);
    validatePathUnder(dir, opts.outputDir);
  }
  await mkdir(dir, { recursive: true });

  const filename = opts.filename
    ? resolveFilename(dir, opts.filename, opts.mimeType)
    : generateFilename(opts.mimeType);

  const filepath = join(dir, filename);
  const buffer = Buffer.from(opts.base64Data, "base64");
  await writeFile(filepath, buffer);
  log.info(`Image saved: ${filepath} (${buffer.length} bytes)`);
  return filepath;
}
