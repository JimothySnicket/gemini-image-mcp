import { describe, test, expect } from "bun:test";
import sharp from "sharp";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { processImage } from "./process.js";

// Offline. Exercises the chroma/threshold pipeline through the REAL process_image
// caller (there was no process.test.ts before this feature) and guards the
// JPEG-input → PNG-output alpha coercion. The "auto" matte path is not tested here
// (it needs the model) — it is covered by live verification.

describe("processImage removeBackground", () => {
  test("removeBackground {} on a white JPEG yields a transparent PNG (legacy threshold + alpha coercion)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gim-proc-"));
    const input = join(dir, "white.jpg");
    await sharp({ create: { width: 16, height: 16, channels: 3, background: { r: 255, g: 255, b: 255 } } })
      .jpeg()
      .toFile(input);

    const res = await processImage({ imagePath: input, removeBackground: {}, outputDir: dir });

    // legacy default: no mode + no color => threshold (back-compat)
    expect(res.operations).toContain("remove-bg(threshold:240)");
    // coerced to PNG despite the JPEG input, so the alpha survives
    expect(res.format).toBe("png");
    const meta = await sharp(res.imagePath).metadata();
    expect(meta.format).toBe("png");
    expect(meta.hasAlpha).toBe(true);
  });

  test("chroma mode on a green PNG produces a transparent PNG", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gim-proc-"));
    const input = join(dir, "green.png");
    await sharp({ create: { width: 16, height: 16, channels: 3, background: { r: 0, g: 255, b: 0 } } })
      .png()
      .toFile(input);

    const res = await processImage({ imagePath: input, removeBackground: { mode: "chroma" }, outputDir: dir });
    expect(res.operations.some((o) => o.startsWith("chroma-key"))).toBe(true);
    const stats = await sharp(res.imagePath).stats();
    expect(stats.channels[stats.channels.length - 1].mean).toBeLessThanOrEqual(1);
  });

  test("an explicit format:'jpeg' with removeBackground is respected (caller's choice wins)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gim-proc-"));
    const input = join(dir, "green2.png");
    await sharp({ create: { width: 16, height: 16, channels: 3, background: { r: 0, g: 255, b: 0 } } })
      .png()
      .toFile(input);

    const res = await processImage({
      imagePath: input,
      removeBackground: { mode: "chroma" },
      format: "jpeg",
      outputDir: dir,
    });
    expect(res.format).toBe("jpeg"); // explicit format is not overridden
  });
});
