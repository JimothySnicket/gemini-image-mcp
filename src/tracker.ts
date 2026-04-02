import { appendFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";
import { loadConfig } from "./config.js";
import type { UsageReport } from "./pricing.js";
import { log, resolveOutputDir } from "./utils.js";

export interface ManifestEntry {
  timestamp: string;
  filename: string;
  path: string;
  prompt: string;
  model: string;
  aspectRatio?: string;
  resolution?: string;
  subfolder?: string;
  inputImages: number;
  usage: UsageReport;
}

export interface SessionStats {
  generationsThisSession: number;
  totalCostThisSession: string;
  generationsThisHour: number;
  limit: {
    maxPerHour: number;
    maxCostPerHour: number;
    remainingThisHour: number;
  };
}

// In-memory session tracking
let sessionGenerations = 0;
let sessionCostCents = 0;

function getManifestPath(): string {
  const config = loadConfig();
  const dir = resolveOutputDir(undefined, config.outputDir);
  return join(dir, "generations.jsonl");
}

function parseCost(cost: string): number {
  const match = cost.match(/\$?([\d.]+)/);
  return match ? Math.round(parseFloat(match[1]) * 100) : 0;
}

export function appendManifest(entry: ManifestEntry): void {
  try {
    const config = loadConfig();
    const dir = resolveOutputDir(undefined, config.outputDir);
    mkdirSync(dir, { recursive: true });
    const line = JSON.stringify(entry) + "\n";
    appendFileSync(join(dir, "generations.jsonl"), line);
  } catch (err) {
    log.error("Failed to write manifest:", err instanceof Error ? err.message : String(err));
  }
}

function countRecentGenerations(): { count: number; costCents: number } {
  const manifestPath = getManifestPath();
  if (!existsSync(manifestPath)) return { count: 0, costCents: 0 };

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  let count = 0;
  let costCents = 0;

  try {
    const lines = readFileSync(manifestPath, "utf-8").split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as ManifestEntry;
        if (entry.timestamp >= oneHourAgo) {
          count++;
          costCents += parseCost(entry.usage.estimatedCost);
        }
      } catch {
        // Skip malformed lines
      }
    }
  } catch {
    // If we can't read the manifest, return zero
  }

  return { count, costCents };
}

export function checkRateLimit(): void {
  const config = loadConfig();
  const maxPerHour = config.maxRequestsPerHour;
  const maxCostPerHour = config.maxCostPerHour;

  if (maxPerHour === 0 && maxCostPerHour === 0) return;

  const recent = countRecentGenerations();

  if (maxPerHour > 0 && recent.count >= maxPerHour) {
    throw new Error(
      `Rate limit reached — ${recent.count}/${maxPerHour} generations used this hour. ` +
        "To change: set MAX_REQUESTS_PER_HOUR env var.",
    );
  }

  if (maxCostPerHour > 0 && recent.costCents >= maxCostPerHour * 100) {
    const spent = (recent.costCents / 100).toFixed(2);
    throw new Error(
      `Cost limit reached — $${spent}/$${maxCostPerHour.toFixed(2)} spent this hour. ` +
        "To change: set MAX_COST_PER_HOUR env var.",
    );
  }
}

export function recordGeneration(usage: UsageReport): void {
  sessionGenerations++;
  sessionCostCents += parseCost(usage.estimatedCost);
}

export function getSessionStats(): SessionStats {
  const config = loadConfig();
  const maxPerHour = config.maxRequestsPerHour;
  const maxCostPerHour = config.maxCostPerHour;
  const recent = countRecentGenerations();

  return {
    generationsThisSession: sessionGenerations,
    totalCostThisSession: `$${(sessionCostCents / 100).toFixed(4)}`,
    generationsThisHour: recent.count,
    limit: {
      maxPerHour,
      maxCostPerHour,
      remainingThisHour: maxPerHour > 0 ? Math.max(0, maxPerHour - recent.count) : -1,
    },
  };
}
