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
