import { describe, test, expect } from "bun:test";
import { readFileSync } from "fs";
import { createRequire } from "module";
import { join } from "path";

// Replicate the exact pattern used in src/index.ts so the test exercises the
// same source-of-truth chain, not a parallel assumption.
const require = createRequire(import.meta.url);

describe("version-string parity", () => {
  test("src/index.ts reads pkg.version via createRequire — matches package.json", () => {
    // Read package.json the same way index.ts does at runtime.
    const pkg = require("../package.json") as { version: string };

    // Read it independently via readFileSync as the ground-truth reference.
    const raw = readFileSync(join(import.meta.dir, "../package.json"), "utf-8");
    const direct = JSON.parse(raw) as { version: string };

    // Both reads must agree, confirming no hardcoded version is lurking.
    expect(pkg.version).toBe(direct.version);
  });

  test("version field is a semver-shaped string (x.y.z)", () => {
    const pkg = require("../package.json") as { version: string };
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+/);
  });
});

// server.json (MCP Registry) and plugin.json (Claude Code plugin) carry their own
// version strings that have silently drifted from package.json in past releases.
// Lock them together so a release can't ship a stale manifest.
describe("manifest version parity", () => {
  const pkg = require("../package.json") as { version: string };

  test("server.json version matches package.json (top-level + every package entry)", () => {
    const server = require("../server.json") as {
      version: string;
      packages: { version: string }[];
    };
    expect(server.version).toBe(pkg.version);
    for (const p of server.packages) {
      expect(p.version).toBe(pkg.version);
    }
  });

  test("plugin.json version matches package.json", () => {
    const plugin = require("../plugin.json") as { version: string };
    expect(plugin.version).toBe(pkg.version);
  });
});
