import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  initTracker,
  checkRateLimit,
  recordGeneration,
  getSessionStats,
  __resetTracker,
  __windowSize,
} from "./tracker.js";
import { __resetConfigCache } from "./config.js";

// ── Helpers ─────────────────────────────────────────────────────────

const ONE_HOUR_MS = 60 * 60 * 1000;

function makeEntry(offsetMs: number, cost = "$0.0390") {
  return JSON.stringify({
    timestamp: new Date(Date.now() - offsetMs).toISOString(),
    filename: "img.png",
    path: "/tmp/img.png",
    prompt: "test",
    model: "gemini-2.5-flash-image",
    inputImages: 0,
    usage: {
      promptTokens: 5,
      outputTokens: 1290,
      imageTokens: 1290,
      thinkingTokens: 0,
      totalTokens: 1295,
      estimatedCost: cost,
      pricingVerifiedDate: "2026-04-01",
    },
  });
}

function writeManifest(dir: string, lines: string[]): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "generations.jsonl"), lines.join("\n") + "\n");
}

// ── Env save/restore ─────────────────────────────────────────────────

const ENV_KEYS = ["OUTPUT_DIR", "MAX_REQUESTS_PER_HOUR", "MAX_COST_PER_HOUR", "LOG_LEVEL"];
const savedEnv: Record<string, string | undefined> = {};

// ── describe: initTracker ────────────────────────────────────────────

describe("initTracker", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `tracker-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
    }
    process.env.LOG_LEVEL = "error";
    process.env.MAX_REQUESTS_PER_HOUR = "0";
    process.env.MAX_COST_PER_HOUR = "0";
    __resetTracker();
    __resetConfigCache();
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] !== undefined) {
        process.env[key] = savedEnv[key];
      } else {
        delete process.env[key];
      }
    }
    __resetTracker();
    __resetConfigCache();
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // best effort
    }
  });

  test("empty window when manifest is missing", () => {
    // tmpDir exists but has no generations.jsonl
    mkdirSync(tmpDir, { recursive: true });
    process.env.OUTPUT_DIR = tmpDir;
    initTracker();
    expect(__windowSize()).toBe(0);
  });

  test("seeds only entries within the last hour; older entries are filtered", () => {
    writeManifest(tmpDir, [
      makeEntry(2 * ONE_HOUR_MS),  // 2h old — outside window
      makeEntry(30 * 60 * 1000),  // 30min old — inside window
      makeEntry(5 * 60 * 1000),   // 5min old — inside window
    ]);
    process.env.OUTPUT_DIR = tmpDir;
    initTracker();
    expect(__windowSize()).toBe(2);
  });

  test("boundary: entry clearly older than 1h is excluded", () => {
    // Entry is 500ms outside the window — reliably excluded even with timing jitter.
    // Validates the critical design invariant: entries older than 1h never appear.
    writeManifest(tmpDir, [
      makeEntry(ONE_HOUR_MS + 500), // 500ms past boundary — always excluded
    ]);
    process.env.OUTPUT_DIR = tmpDir;
    initTracker();
    expect(__windowSize()).toBe(0);
  });

  test("boundary: entry clearly inside the window is included", () => {
    // Entry is 500ms inside the window — reliably included even with timing jitter.
    writeManifest(tmpDir, [
      makeEntry(ONE_HOUR_MS - 500), // 500ms inside window — always included
    ]);
    process.env.OUTPUT_DIR = tmpDir;
    initTracker();
    expect(__windowSize()).toBe(1);
  });

  test("idempotent — calling initTracker twice does not double-count", () => {
    writeManifest(tmpDir, [
      makeEntry(30 * 60 * 1000),
      makeEntry(5 * 60 * 1000),
    ]);
    process.env.OUTPUT_DIR = tmpDir;
    initTracker();
    initTracker(); // second call must be a no-op
    expect(__windowSize()).toBe(2);
  });

  test("checkRateLimit throws with documented message when maxRequestsPerHour is exceeded", () => {
    writeManifest(tmpDir, [
      makeEntry(30 * 60 * 1000),
      makeEntry(5 * 60 * 1000),
    ]);
    process.env.OUTPUT_DIR = tmpDir;
    process.env.MAX_REQUESTS_PER_HOUR = "1";
    initTracker();

    expect(() => checkRateLimit()).toThrow(/Rate limit reached/);
    expect(() => checkRateLimit()).toThrow(/MAX_REQUESTS_PER_HOUR/);
  });

  test("checkRateLimit passes when under the limit", () => {
    writeManifest(tmpDir, [
      makeEntry(30 * 60 * 1000),
    ]);
    process.env.OUTPUT_DIR = tmpDir;
    process.env.MAX_REQUESTS_PER_HOUR = "5";
    initTracker();

    expect(() => checkRateLimit()).not.toThrow();
  });

  test("recordGeneration appends to the in-memory window and __windowSize reflects it", () => {
    mkdirSync(tmpDir, { recursive: true });
    process.env.OUTPUT_DIR = tmpDir;
    initTracker();
    expect(__windowSize()).toBe(0);

    recordGeneration({
      promptTokens: 5,
      outputTokens: 1290,
      imageTokens: 1290,
      thinkingTokens: 0,
      totalTokens: 1295,
      estimatedCost: "$0.0390",
      pricingVerifiedDate: "2026-04-01",
    });

    expect(__windowSize()).toBe(1);
  });

  test("getSessionStats().generationsThisHour matches window size", () => {
    writeManifest(tmpDir, [
      makeEntry(30 * 60 * 1000),
      makeEntry(5 * 60 * 1000),
    ]);
    process.env.OUTPUT_DIR = tmpDir;
    initTracker();

    const stats = getSessionStats();
    expect(stats.generationsThisHour).toBe(__windowSize());
    expect(stats.generationsThisHour).toBe(2);
  });
});

// ── describe: window pruning ──────────────────────────────────────────

describe("window pruning", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `tracker-prune-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
    }
    process.env.LOG_LEVEL = "error";
    process.env.MAX_REQUESTS_PER_HOUR = "0";
    process.env.MAX_COST_PER_HOUR = "0";
    __resetTracker();
    __resetConfigCache();
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] !== undefined) {
        process.env[key] = savedEnv[key];
      } else {
        delete process.env[key];
      }
    }
    __resetTracker();
    __resetConfigCache();
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // best effort
    }
  });

  test("entries older than 1h are pruned and not counted by getSessionStats", () => {
    // Seed with 2 recent entries and manually push a stale entry directly into
    // the in-memory window by injecting via recordGeneration then back-dating via
    // the manifest approach.
    //
    // Simpler approach: seed 1 recent + 1 old-by-timestamp via manifest. Then
    // advance the "now" anchor by pushing an old entry and checking pruning.
    //
    // Since we can't mock Date.now(), we write the old entry with a timestamp
    // that is genuinely > 1h ago and let the prune logic handle it at read time.
    writeManifest(tmpDir, [
      makeEntry(2 * ONE_HOUR_MS),  // old — must be pruned on read
      makeEntry(10 * 60 * 1000),  // recent — must survive
    ]);
    process.env.OUTPUT_DIR = tmpDir;
    initTracker();

    // Only the recent entry should survive pruning (old entry was filtered at seed time).
    expect(__windowSize()).toBe(1);
    expect(getSessionStats().generationsThisHour).toBe(1);
  });

  test("all-stale manifest leaves empty window after initTracker", () => {
    writeManifest(tmpDir, [
      makeEntry(2 * ONE_HOUR_MS),
      makeEntry(90 * 60 * 1000),
    ]);
    process.env.OUTPUT_DIR = tmpDir;
    initTracker();

    expect(__windowSize()).toBe(0);
    expect(getSessionStats().generationsThisHour).toBe(0);
  });
});
