import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join, resolve, dirname } from "path";
import { log } from "./utils.js";

// ── Types ───────────────────────────────────────────────────────────

export interface GenerateDefaults {
  aspectRatio?: string;
  resolution?: string;
  model?: string;
  seed?: number;
  useSearchGrounding?: boolean;
}

export interface ProcessDefaults {
  format?: string;
  quality?: number;
}

export interface GeminiImageConfig {
  outputDir: string;
  defaultModel: string;
  logLevel: string;
  requestTimeout: number;
  sessionTimeout: number;
  maxRequestsPerHour: number;
  maxCostPerHour: number;
  defaults: {
    generate: GenerateDefaults;
    process: ProcessDefaults;
  };
}

// ── JSONC Comment Stripping ─────────────────────────────────────────

/**
 * Strip single-line (//) and block comments from JSONC input.
 * String-aware: preserves // and /* inside quoted strings.
 * Handles escaped quotes within strings.
 */
export function stripJsoncComments(input: string): string {
  if (!input) return input;

  let result = "";
  let i = 0;
  const len = input.length;

  while (i < len) {
    const ch = input[i];

    // Start of a string
    if (ch === '"') {
      // Copy the opening quote and everything until the closing quote
      result += ch;
      i++;
      while (i < len) {
        const sch = input[i];
        if (sch === "\\") {
          // Escaped character — copy both the backslash and the next char
          result += sch;
          i++;
          if (i < len) {
            result += input[i];
            i++;
          }
          continue;
        }
        if (sch === '"') {
          // Closing quote
          result += sch;
          i++;
          break;
        }
        result += sch;
        i++;
      }
      continue;
    }

    // Single-line comment
    if (ch === "/" && i + 1 < len && input[i + 1] === "/") {
      // Skip until end of line
      i += 2;
      while (i < len && input[i] !== "\n") {
        i++;
      }
      continue;
    }

    // Block comment
    if (ch === "/" && i + 1 < len && input[i + 1] === "*") {
      i += 2;
      while (i < len) {
        if (input[i] === "*" && i + 1 < len && input[i + 1] === "/") {
          i += 2;
          break;
        }
        i++;
      }
      continue;
    }

    // Normal character
    result += ch;
    i++;
  }

  return result;
}

// ── Deep Merge ──────────────────────────────────────────────────────

const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/**
 * Recursively merge source into target.
 * - Arrays are replaced, not concatenated.
 * - Skips __proto__, constructor, prototype keys (prototype pollution guard).
 * - Returns a new object (target is not mutated).
 */
export function deepMerge<T extends Record<string, unknown>>(
  target: T,
  source: Record<string, unknown>,
): T {
  const result = { ...target };

  for (const key of Object.keys(source)) {
    if (UNSAFE_KEYS.has(key)) continue;

    const sourceVal = source[key];
    const targetVal = (result as Record<string, unknown>)[key];

    if (isPlainObject(sourceVal) && isPlainObject(targetVal)) {
      (result as Record<string, unknown>)[key] = deepMerge(
        targetVal as Record<string, unknown>,
        sourceVal as Record<string, unknown>,
      );
    } else {
      (result as Record<string, unknown>)[key] = sourceVal;
    }
  }

  return result;
}

// ── Defaults ────────────────────────────────────────────────────────

export const DEFAULTS: GeminiImageConfig = {
  outputDir: "~/gemini-images",
  defaultModel: "gemini-2.5-flash-image",
  logLevel: "info",
  requestTimeout: 60000,
  sessionTimeout: 1800000,
  maxRequestsPerHour: 0,
  maxCostPerHour: 0,
  defaults: {
    generate: {},
    process: {},
  },
};

/** All keys that are valid at the top level of a config file. */
const KNOWN_KEYS = new Set<string>(Object.keys(DEFAULTS));

// ── Validation ──────────────────────────────────────────────────────

const API_KEY_PATTERN = /api.?key/i;

/**
 * Validate and clean a raw parsed config object.
 * - Strips any key matching /api.?key/i (with a warning).
 * - Warns on unknown top-level keys and drops them.
 * - Skips prototype pollution keys.
 */
function validateAndClean(
  raw: Record<string, unknown>,
  source: string,
): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};

  for (const key of Object.keys(raw)) {
    if (UNSAFE_KEYS.has(key)) continue;

    if (API_KEY_PATTERN.test(key)) {
      log.info(
        `[config] WARNING: "${key}" found in ${source} — API keys must not be in config files. Stripped.`,
      );
      continue;
    }

    if (!KNOWN_KEYS.has(key)) {
      log.info(
        `[config] WARNING: unknown key "${key}" in ${source} — ignored.`,
      );
      continue;
    }

    cleaned[key] = raw[key];
  }

  return cleaned;
}

// ── Config Loading ──────────────────────────────────────────────────

function readJsoncFile(filePath: string): Record<string, unknown> | null {
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, "utf-8");
    const stripped = stripJsoncComments(raw);
    return JSON.parse(stripped) as Record<string, unknown>;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`[config] Failed to parse ${filePath}: ${msg}`);
    return null;
  }
}

function resolveTilde(p: string): string {
  if (p.startsWith("~/") || p === "~") {
    return join(homedir(), p.slice(1));
  }
  return p;
}

export interface LoadConfigOpts {
  globalPath?: string;
  localPath?: string;
}

/**
 * Load configuration from global then local JSONC files, apply env var
 * overrides, resolve ~ in outputDir, and return a frozen config object.
 *
 * Merge order (later wins):
 *   DEFAULTS → global config → local config → env vars
 */
export function loadConfig(opts?: LoadConfigOpts): GeminiImageConfig {
  const globalPath =
    opts?.globalPath ?? join(homedir(), ".config", "gemini-image-mcp", "config.jsonc");
  const localPath =
    opts?.localPath ?? join(process.cwd(), ".gemini-image-mcp.jsonc");

  let config: Record<string, unknown> = { ...DEFAULTS, defaults: { ...DEFAULTS.defaults } };

  // Load global config
  const globalRaw = readJsoncFile(globalPath);
  if (globalRaw) {
    const cleaned = validateAndClean(globalRaw, globalPath);
    config = deepMerge(config, cleaned);
    log.debug(`[config] Loaded global config from ${globalPath}`);
  }

  // Load local config (overrides global)
  const localRaw = readJsoncFile(localPath);
  if (localRaw) {
    const cleaned = validateAndClean(localRaw, localPath);
    config = deepMerge(config, cleaned);
    log.debug(`[config] Loaded local config from ${localPath}`);
  }

  // Env var overrides (highest priority)
  if (process.env.OUTPUT_DIR) {
    config.outputDir = process.env.OUTPUT_DIR;
  }
  if (process.env.DEFAULT_MODEL) {
    config.defaultModel = process.env.DEFAULT_MODEL;
  }
  if (process.env.LOG_LEVEL) {
    config.logLevel = process.env.LOG_LEVEL;
  }
  if (process.env.REQUEST_TIMEOUT_MS) {
    const val = Number(process.env.REQUEST_TIMEOUT_MS);
    if (!isNaN(val)) config.requestTimeout = val;
  }
  if (process.env.SESSION_TIMEOUT_MS) {
    const val = Number(process.env.SESSION_TIMEOUT_MS);
    if (!isNaN(val)) config.sessionTimeout = val;
  }
  if (process.env.MAX_REQUESTS_PER_HOUR) {
    const val = Number(process.env.MAX_REQUESTS_PER_HOUR);
    if (!isNaN(val)) config.maxRequestsPerHour = val;
  }
  if (process.env.MAX_COST_PER_HOUR) {
    const val = Number(process.env.MAX_COST_PER_HOUR);
    if (!isNaN(val)) config.maxCostPerHour = val;
  }

  // Resolve ~ in outputDir
  if (typeof config.outputDir === "string") {
    config.outputDir = resolveTilde(config.outputDir);
  }

  return Object.freeze(config as unknown as GeminiImageConfig);
}

// ── Config Template ─────────────────────────────────────────────────

export const CONFIG_TEMPLATE = `{
  // gemini-image-mcp configuration
  // Docs: https://github.com/JimothySnicket/gemini-image-mcp

  // Directory where generated/processed images are saved
  // Supports ~ for home directory
  "outputDir": "~/gemini-images",

  // Default Gemini model for image generation
  // Options: gemini-2.5-flash-image, gemini-3-pro-image-preview, gemini-3.1-flash-image-preview
  "defaultModel": "gemini-2.5-flash-image",

  // Log level: "debug", "info", or "error"
  "logLevel": "info",

  // Timeout for a single API request (ms)
  "requestTimeout": 60000,

  // Timeout for multi-turn editing sessions (ms)
  "sessionTimeout": 1800000,

  // Rate limiting (0 = unlimited)
  "maxRequestsPerHour": 0,
  "maxCostPerHour": 0,

  // Per-tool default parameters
  "defaults": {
    "generate": {
      // "aspectRatio": "1:1",
      // "resolution": "1K",
      // "model": "gemini-2.5-flash-image",
      // "seed": 42,
      // "useSearchGrounding": false
    },
    "process": {
      // "format": "png",
      // "quality": 90
    }
  }
}
`;

// ── --init Scaffolding ──────────────────────────────────────────────

export interface InitConfigOpts {
  targetPath: string;
  force?: boolean;
}

/**
 * Write the config template to targetPath.
 * Throws if the file already exists unless force is true.
 * Creates parent directories as needed.
 */
export function initConfig(opts: InitConfigOpts): void {
  const { targetPath, force } = opts;

  if (existsSync(targetPath) && !force) {
    throw new Error(
      `Config file already exists: ${targetPath}\nUse --force to overwrite.`,
    );
  }

  // Ensure parent directory exists
  const dir = dirname(targetPath);
  mkdirSync(dir, { recursive: true });

  writeFileSync(targetPath, CONFIG_TEMPLATE, "utf-8");
  log.info(`[config] Config file written to ${targetPath}`);
}
