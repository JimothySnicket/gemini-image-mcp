import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  stripJsoncComments,
  deepMerge,
  loadConfig,
  DEFAULTS,
  type GeminiImageConfig,
} from "./config.js";

// ── Task 1: stripJsoncComments ──────────────────────────────────────

describe("stripJsoncComments", () => {
  test("removes single-line comments", () => {
    const input = `{
  // this is a comment
  "key": "value"
}`;
    const result = JSON.parse(stripJsoncComments(input));
    expect(result).toEqual({ key: "value" });
  });

  test("removes block comments", () => {
    const input = `{
  /* block comment */
  "key": "value"
}`;
    const result = JSON.parse(stripJsoncComments(input));
    expect(result).toEqual({ key: "value" });
  });

  test("removes multi-line block comments", () => {
    const input = `{
  /*
   * multi-line
   * block comment
   */
  "key": "value"
}`;
    const result = JSON.parse(stripJsoncComments(input));
    expect(result).toEqual({ key: "value" });
  });

  test("preserves URLs inside quoted strings", () => {
    const input = `{
  "url": "https://example.com/path",
  "another": "value"
}`;
    const result = JSON.parse(stripJsoncComments(input));
    expect(result).toEqual({
      url: "https://example.com/path",
      another: "value",
    });
  });

  test("preserves // inside quoted strings", () => {
    const input = `{
  "comment": "not // a comment",
  "key": "value"
}`;
    const result = JSON.parse(stripJsoncComments(input));
    expect(result).toEqual({
      comment: "not // a comment",
      key: "value",
    });
  });

  test("handles escaped quotes inside strings", () => {
    const input = `{
  "msg": "he said \\"hello\\"",
  "key": "value"
}`;
    const result = JSON.parse(stripJsoncComments(input));
    expect(result).toEqual({
      msg: 'he said "hello"',
      key: "value",
    });
  });

  test("handles empty input", () => {
    expect(stripJsoncComments("")).toBe("");
  });

  test("handles input with no comments", () => {
    const input = `{"key": "value"}`;
    expect(stripJsoncComments(input)).toBe(input);
  });

  test("removes trailing commas are not its job (just comments)", () => {
    // stripJsoncComments only strips comments; trailing commas are separate
    const input = `{
  "a": 1, // comment
  "b": 2
}`;
    const stripped = stripJsoncComments(input);
    const result = JSON.parse(stripped);
    expect(result).toEqual({ a: 1, b: 2 });
  });
});

// ── Task 1: deepMerge ───────────────────────────────────────────────

describe("deepMerge", () => {
  test("flat merge", () => {
    const target = { a: 1, b: 2 };
    const source = { b: 3, c: 4 };
    expect(deepMerge(target, source)).toEqual({ a: 1, b: 3, c: 4 });
  });

  test("deep nested merge", () => {
    const target = { outer: { a: 1, inner: { x: 10 } } };
    const source = { outer: { b: 2, inner: { y: 20 } } };
    expect(deepMerge(target, source)).toEqual({
      outer: { a: 1, b: 2, inner: { x: 10, y: 20 } },
    });
  });

  test("scalar override", () => {
    const target = { a: { nested: "old" } };
    const source = { a: "scalar" };
    expect(deepMerge(target, source)).toEqual({ a: "scalar" });
  });

  test("prototype pollution guard — __proto__", () => {
    const target = { a: 1 };
    const source = JSON.parse('{"__proto__": {"polluted": true}}');
    const result = deepMerge(target, source);
    expect(result).toEqual({ a: 1 });
    // Ensure prototype was not polluted
    expect(({} as any).polluted).toBeUndefined();
  });

  test("prototype pollution guard — constructor", () => {
    const target = { a: 1 };
    const source = { constructor: { polluted: true } } as any;
    const result = deepMerge(target, source);
    expect(result).toEqual({ a: 1 });
  });

  test("prototype pollution guard — prototype", () => {
    const target = { a: 1 };
    const source = { prototype: { polluted: true } } as any;
    const result = deepMerge(target, source);
    expect(result).toEqual({ a: 1 });
  });

  test("array replacement (not merged)", () => {
    const target = { tags: ["a", "b"] };
    const source = { tags: ["c"] };
    expect(deepMerge(target, source)).toEqual({ tags: ["c"] });
  });
});

// ── Task 2: loadConfig ──────────────────────────────────────────────

describe("loadConfig", () => {
  let tmpDir: string;
  let globalDir: string;
  let localDir: string;
  let globalPath: string;
  let localPath: string;
  const savedEnv: Record<string, string | undefined> = {};

  // Env vars that loadConfig reads
  const ENV_KEYS = [
    "OUTPUT_DIR",
    "DEFAULT_MODEL",
    "LOG_LEVEL",
    "REQUEST_TIMEOUT_MS",
    "SESSION_TIMEOUT_MS",
    "MAX_REQUESTS_PER_HOUR",
    "MAX_COST_PER_HOUR",
  ];

  beforeEach(() => {
    // Create isolated temp dirs
    tmpDir = join(tmpdir(), `config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    globalDir = join(tmpDir, "global");
    localDir = join(tmpDir, "local");
    mkdirSync(globalDir, { recursive: true });
    mkdirSync(localDir, { recursive: true });
    globalPath = join(globalDir, "config.jsonc");
    localPath = join(localDir, "config.jsonc");

    // Save and clear env vars
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    // Restore env vars
    for (const key of ENV_KEYS) {
      if (savedEnv[key] !== undefined) {
        process.env[key] = savedEnv[key];
      } else {
        delete process.env[key];
      }
    }

    // Clean up temp dirs
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // best effort cleanup
    }
  });

  test("returns defaults when no files exist", () => {
    const config = loadConfig({ globalPath, localPath });
    expect(config.defaultModel).toBe(DEFAULTS.defaultModel);
    expect(config.logLevel).toBe(DEFAULTS.logLevel);
    expect(config.requestTimeout).toBe(DEFAULTS.requestTimeout);
    expect(config.sessionTimeout).toBe(DEFAULTS.sessionTimeout);
    expect(config.maxRequestsPerHour).toBe(DEFAULTS.maxRequestsPerHour);
    expect(config.maxCostPerHour).toBe(DEFAULTS.maxCostPerHour);
    expect(config.defaults).toEqual(DEFAULTS.defaults);
  });

  test("loads global config", () => {
    writeFileSync(globalPath, JSON.stringify({ defaultModel: "gemini-3-pro-image-preview" }));
    const config = loadConfig({ globalPath, localPath });
    expect(config.defaultModel).toBe("gemini-3-pro-image-preview");
  });

  test("local overrides global", () => {
    writeFileSync(globalPath, JSON.stringify({ defaultModel: "global-model", logLevel: "debug" }));
    writeFileSync(localPath, JSON.stringify({ defaultModel: "local-model" }));
    const config = loadConfig({ globalPath, localPath });
    expect(config.defaultModel).toBe("local-model");
    expect(config.logLevel).toBe("debug"); // from global, not overridden
  });

  test("env vars override config files", () => {
    writeFileSync(globalPath, JSON.stringify({ defaultModel: "file-model" }));
    process.env.DEFAULT_MODEL = "env-model";
    process.env.OUTPUT_DIR = "/tmp/env-output";
    process.env.LOG_LEVEL = "debug";
    process.env.REQUEST_TIMEOUT_MS = "30000";
    process.env.SESSION_TIMEOUT_MS = "900000";
    process.env.MAX_REQUESTS_PER_HOUR = "100";
    process.env.MAX_COST_PER_HOUR = "5.50";

    const config = loadConfig({ globalPath, localPath });
    expect(config.defaultModel).toBe("env-model");
    expect(config.outputDir).toBe("/tmp/env-output");
    expect(config.logLevel).toBe("debug");
    expect(config.requestTimeout).toBe(30000);
    expect(config.sessionTimeout).toBe(900000);
    expect(config.maxRequestsPerHour).toBe(100);
    expect(config.maxCostPerHour).toBe(5.50);
  });

  test("strips JSONC comments from config files", () => {
    const jsonc = `{
  // Use the pro model
  "defaultModel": "gemini-3-pro-image-preview"
  /* block comment */
}`;
    writeFileSync(globalPath, jsonc);
    const config = loadConfig({ globalPath, localPath });
    expect(config.defaultModel).toBe("gemini-3-pro-image-preview");
  });

  test("warns and strips API keys", () => {
    const configWithKey = {
      defaultModel: "gemini-2.5-flash-image",
      apiKey: "secret-key-123",
      geminiApiKey: "another-secret",
    };
    writeFileSync(globalPath, JSON.stringify(configWithKey));
    const config = loadConfig({ globalPath, localPath });
    expect((config as any).apiKey).toBeUndefined();
    expect((config as any).geminiApiKey).toBeUndefined();
    expect(config.defaultModel).toBe("gemini-2.5-flash-image");
  });

  test("warns and drops unknown keys", () => {
    const configWithUnknown = {
      defaultModel: "gemini-2.5-flash-image",
      unknownSetting: "should be dropped",
      anotherUnknown: 42,
    };
    writeFileSync(globalPath, JSON.stringify(configWithUnknown));
    const config = loadConfig({ globalPath, localPath });
    expect((config as any).unknownSetting).toBeUndefined();
    expect((config as any).anotherUnknown).toBeUndefined();
    expect(config.defaultModel).toBe("gemini-2.5-flash-image");
  });

  test("deep merges tool defaults", () => {
    writeFileSync(
      globalPath,
      JSON.stringify({
        defaults: {
          generate: { aspectRatio: "16:9" },
        },
      }),
    );
    writeFileSync(
      localPath,
      JSON.stringify({
        defaults: {
          generate: { resolution: "2K" },
          process: { quality: 85 },
        },
      }),
    );
    const config = loadConfig({ globalPath, localPath });
    expect(config.defaults.generate.aspectRatio).toBe("16:9");
    expect(config.defaults.generate.resolution).toBe("2K");
    expect(config.defaults.process.quality).toBe(85);
  });

  test("config object is frozen", () => {
    const config = loadConfig({ globalPath, localPath });
    expect(Object.isFrozen(config)).toBe(true);
    expect(() => {
      (config as any).defaultModel = "hacked";
    }).toThrow();
  });
});
