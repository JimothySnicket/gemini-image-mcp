/**
 * Smoke test: log file writes to the configured outputDir.
 * Acceptance criteria verification for Task 4 (log dir follows outputDir).
 *
 * Shape B (setLogDir) means we can test the behaviour directly without
 * fighting the loadConfig cache — just call setLogDir(tmpDir), write a log
 * entry, and assert the file appeared in the right place.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, existsSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir, homedir } from "os";
import { log, setLogDir } from "./utils.js";

describe("log directory follows outputDir", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(
      homedir(),
      `log-dir-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    // Reset to default so other tests aren't affected
    setLogDir(join(homedir(), "gemini-images"));
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // best effort
    }
  });

  test("log file is written to the directory set by setLogDir", () => {
    setLogDir(tmpDir);
    log.info("smoke test log entry");

    const expectedLogFile = join(tmpDir, "gemini-mcp.log");
    expect(existsSync(expectedLogFile)).toBe(true);

    const contents = readFileSync(expectedLogFile, "utf-8");
    expect(contents).toContain("smoke test log entry");
    expect(contents).toContain("[INFO]");
  });

  test("setLogDir rejects paths outside home directory and keeps default", () => {
    // Use a path that is genuinely outside the user's home directory.
    // On Windows, C:\Windows\Temp is always outside C:\Users\<name>.
    // On macOS/Linux, /tmp is outside /Users/<name> or /home/<name>.
    const outsideHome = process.platform === "win32"
      ? join("C:\\Windows", `outside-home-test-${Date.now()}`)
      : join("/tmp", `outside-home-test-${Date.now()}`);

    // Don't create the dir — setLogDir should reject before trying to write there.
    // After rejecting, log should still write to ~/gemini-images (or wherever
    // currentLogDir is), not to outsideHome.
    setLogDir(outsideHome);
    log.info("should not go to outside dir");
    expect(existsSync(join(outsideHome, "gemini-mcp.log"))).toBe(false);
  });

  test("log writes to new dir after setLogDir called with valid path", () => {
    const firstDir = join(homedir(), `log-first-${Date.now()}`);
    const secondDir = join(homedir(), `log-second-${Date.now()}`);
    mkdirSync(firstDir, { recursive: true });
    mkdirSync(secondDir, { recursive: true });
    try {
      setLogDir(firstDir);
      log.info("entry in first dir");
      expect(existsSync(join(firstDir, "gemini-mcp.log"))).toBe(true);

      setLogDir(secondDir);
      log.info("entry in second dir");
      expect(existsSync(join(secondDir, "gemini-mcp.log"))).toBe(true);

      // First dir log should not contain the second-dir message
      const firstContents = readFileSync(join(firstDir, "gemini-mcp.log"), "utf-8");
      expect(firstContents).not.toContain("entry in second dir");
    } finally {
      try { rmSync(firstDir, { recursive: true, force: true }); } catch { /* best effort */ }
      try { rmSync(secondDir, { recursive: true, force: true }); } catch { /* best effort */ }
    }
  });
});
