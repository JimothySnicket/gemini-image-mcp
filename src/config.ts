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
