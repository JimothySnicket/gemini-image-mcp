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

// In-memory session tracking (lifetime of the process)
let sessionGenerations = 0;
let sessionCostCents = 0;

// In-memory rolling 1h window of recent generations. Seeded once from disk at
// startup by initTracker(), then updated on every recordGeneration().
// checkRateLimit and countRecentGenerations read from this — never from disk.
// The manifest file remains the durable record; this is a hot-path cache.
interface WindowEntry {
  timestamp: number;
  costCents: number;
}

let recentWindow: WindowEntry[] = [];
let seeded = false;

const ONE_HOUR_MS = 60 * 60 * 1000;

function getManifestPath(): string {
  const config = loadConfig();
  const dir = resolveOutputDir(undefined, config.outputDir);
  return join(dir, "generations.jsonl");
}

function parseCost(cost: string): number {
  const match = cost.match(/\$?([\d.]+)/);
  return match ? Math.round(parseFloat(match[1]) * 100) : 0;
}

/** Drop window entries older than the 1h cutoff. Called lazily on read. */
function pruneWindow(now: number): void {
  const cutoff = now - ONE_HOUR_MS;
  // Entries are appended in chronological order, so the oldest are at the front.
  // Most of the time pruning is a no-op; when it isn't, a single slice is fine.
  let drop = 0;
  while (drop < recentWindow.length && recentWindow[drop].timestamp < cutoff) {
    drop++;
  }
  if (drop > 0) {
    recentWindow = recentWindow.slice(drop);
  }
}

/**
 * Seed the in-memory rolling window from the manifest file. Called once at
 * startup before the server connects to its transport. Idempotent: a second
 * call is a no-op.
 *
 * Graceful on missing manifest (empty window). If parsing the manifest fails
 * the window is left empty — the safe failure direction is an undercount
 * (users get more budget, not less), per the design constraint.
 */
export function initTracker(): void {
  if (seeded) return;
  seeded = true;

  const manifestPath = getManifestPath();
  if (!existsSync(manifestPath)) {
    log.debug(`[tracker] No manifest at ${manifestPath} — starting with empty window`);
    return;
  }

  const cutoff = Date.now() - ONE_HOUR_MS;
  const seededEntries: WindowEntry[] = [];

  try {
    const lines = readFileSync(manifestPath, "utf-8").split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as ManifestEntry;
        const ts = Date.parse(entry.timestamp);
        if (!Number.isFinite(ts)) continue;
        if (ts >= cutoff) {
          seededEntries.push({
            timestamp: ts,
            costCents: parseCost(entry.usage.estimatedCost),
          });
        }
      } catch {
        // Skip malformed lines
      }
    }
  } catch (err) {
    log.error(
      "[tracker] Failed to read manifest for seeding:",
      err instanceof Error ? err.message : String(err),
    );
    return;
  }

  // Sort ascending so pruneWindow's "oldest at the front" invariant holds.
  seededEntries.sort((a, b) => a.timestamp - b.timestamp);
  recentWindow = seededEntries;
  log.debug(
    `[tracker] Seeded rolling window with ${seededEntries.length} entries from ${manifestPath}`,
  );
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
  pruneWindow(Date.now());
  let count = 0;
  let costCents = 0;
  for (const entry of recentWindow) {
    count++;
    costCents += entry.costCents;
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
  const costCents = parseCost(usage.estimatedCost);
  sessionCostCents += costCents;
  // Mirror the disk append into the in-memory rolling window. Uses Date.now()
  // rather than re-parsing ISO strings — the two will agree within milliseconds
  // since appendManifest is called by the same caller in the same tick.
  recentWindow.push({ timestamp: Date.now(), costCents });
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

// ── Test-only helpers ───────────────────────────────────────────────
// Exported for the smoke script in the builder verification report and for
// any future integration tests. Not part of the public API.

/** Reset the rolling window and seeded flag. Test-only. */
export function __resetTracker(): void {
  recentWindow = [];
  seeded = false;
  sessionGenerations = 0;
  sessionCostCents = 0;
}

/** Read current rolling-window size. Test-only. */
export function __windowSize(): number {
  pruneWindow(Date.now());
  return recentWindow.length;
}
