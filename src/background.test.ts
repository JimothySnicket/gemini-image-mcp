import { describe, test, expect } from "bun:test";
import sharp from "sharp";
import {
  resolveMode,
  backgroundPromptSuffix,
  keyBackgroundPixels,
  removeBackgroundToPng,
  DEFAULT_CHROMA_COLOR,
} from "./background.js";

// All tests here are OFFLINE — none touch the ML matte ("auto") path, so no model
// download or network is required. The matte path is covered by live verification.

// --- helpers ---

function solidRgba(w: number, h: number, rgba: [number, number, number, number]): Buffer {
  const buf = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    buf[i * 4] = rgba[0];
    buf[i * 4 + 1] = rgba[1];
    buf[i * 4 + 2] = rgba[2];
    buf[i * 4 + 3] = rgba[3];
  }
  return buf;
}

function alphaValues(buf: Buffer): number[] {
  const out: number[] = [];
  for (let i = 3; i < buf.length; i += 4) out.push(buf[i]);
  return out;
}

function solidPng(w: number, h: number, bg: { r: number; g: number; b: number }): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 3, background: bg } })
    .png()
    .toBuffer();
}

// --- resolveMode ---

describe("resolveMode", () => {
  test("explicit mode always wins, even over hints", () => {
    expect(resolveMode({ mode: "auto" })).toBe("auto");
    expect(resolveMode({ mode: "chroma" })).toBe("chroma");
    expect(resolveMode({ mode: "threshold" })).toBe("threshold");
    expect(resolveMode({ mode: "auto", color: "#FFFFFF" })).toBe("auto");
    expect(resolveMode({ mode: "threshold", color: "#00FF00" })).toBe("threshold");
  });

  test("a color hint implies chroma when no mode is set", () => {
    expect(resolveMode({ color: "#00FF00" })).toBe("chroma");
    expect(resolveMode({ color: "#0000FF", tolerance: 60 })).toBe("chroma");
  });

  test("a threshold hint implies threshold when no mode/color is set", () => {
    expect(resolveMode({ threshold: 200 })).toBe("threshold");
  });

  test("a color hint outranks a threshold hint", () => {
    expect(resolveMode({ color: "#00FF00", threshold: 200 })).toBe("chroma");
  });

  test("falls back to 'auto' by default (generate_image semantics)", () => {
    expect(resolveMode({})).toBe("auto");
    expect(resolveMode({ tolerance: 80 })).toBe("auto");
  });

  test("respects a caller-supplied fallback (process_image legacy = threshold)", () => {
    expect(resolveMode({}, "threshold")).toBe("threshold");
    expect(resolveMode({ tolerance: 80 }, "threshold")).toBe("threshold");
    // hints still win over the fallback
    expect(resolveMode({ color: "#00FF00" }, "threshold")).toBe("chroma");
  });
});

// --- backgroundPromptSuffix ---

describe("backgroundPromptSuffix", () => {
  test("auto (and bare {}) inject nothing — the matte handles any background", () => {
    expect(backgroundPromptSuffix({ mode: "auto" })).toBe("");
    expect(backgroundPromptSuffix({})).toBe("");
  });

  test("chroma injects a green-screen instruction with the chosen colour", () => {
    const suffix = backgroundPromptSuffix({ mode: "chroma" });
    expect(suffix).toContain(DEFAULT_CHROMA_COLOR);
    expect(suffix.toLowerCase()).toContain("chroma-key background");
    expect(backgroundPromptSuffix({ mode: "chroma", color: "#0000FF" })).toContain("#0000FF");
  });

  test("threshold injects a white-background instruction", () => {
    const suffix = backgroundPromptSuffix({ mode: "threshold" });
    expect(suffix).toContain("#FFFFFF");
  });
});

// --- keyBackgroundPixels (raw RGBA, in place) ---

describe("keyBackgroundPixels", () => {
  test("chroma-key makes pure-green pixels transparent", () => {
    const px = solidRgba(8, 8, [0, 255, 0, 255]);
    const op = keyBackgroundPixels(px, 8, 8, { color: "#00FF00" });
    expect(op).toBe("chroma-key(#00FF00,tolerance:80)");
    expect(alphaValues(px).every((a) => a === 0)).toBe(true);
  });

  test("chroma-key leaves a non-key colour (red) fully opaque", () => {
    const px = solidRgba(8, 8, [255, 0, 0, 255]);
    keyBackgroundPixels(px, 8, 8, { color: "#00FF00" });
    expect(alphaValues(px).every((a) => a === 255)).toBe(true);
  });

  test("threshold removes near-white and keeps dark pixels", () => {
    const white = solidRgba(8, 8, [255, 255, 255, 255]);
    expect(keyBackgroundPixels(white, 8, 8, {})).toBe("remove-bg(threshold:240)");
    expect(alphaValues(white).every((a) => a === 0)).toBe(true);

    const black = solidRgba(8, 8, [0, 0, 0, 255]);
    keyBackgroundPixels(black, 8, 8, { threshold: 240 });
    expect(alphaValues(black).every((a) => a === 255)).toBe(true);
  });

  test("custom tolerance is reflected in the operation label", () => {
    const px = solidRgba(4, 4, [0, 255, 0, 255]);
    expect(keyBackgroundPixels(px, 4, 4, { color: "#00FF00", tolerance: 120 })).toBe(
      "chroma-key(#00FF00,tolerance:120)",
    );
  });
});

// --- removeBackgroundToPng (buffer in / transparent PNG out; chroma + threshold only) ---

describe("removeBackgroundToPng (chroma/threshold)", () => {
  test("chroma mode turns a solid-green image fully transparent", async () => {
    const green = await solidPng(16, 16, { r: 0, g: 255, b: 0 });
    const { buffer, operation } = await removeBackgroundToPng(green, { mode: "chroma" });
    expect(operation).toContain("chroma-key");
    const meta = await sharp(buffer).metadata();
    expect(meta.format).toBe("png");
    expect(meta.hasAlpha).toBe(true);
    const stats = await sharp(buffer).stats();
    expect(stats.channels[stats.channels.length - 1].mean).toBeLessThanOrEqual(1);
  });

  test("threshold mode turns a solid-white image fully transparent", async () => {
    const white = await solidPng(16, 16, { r: 255, g: 255, b: 255 });
    const { buffer, operation } = await removeBackgroundToPng(white, { mode: "threshold" });
    expect(operation).toContain("remove-bg");
    const stats = await sharp(buffer).stats();
    expect(stats.channels[stats.channels.length - 1].mean).toBeLessThanOrEqual(1);
  });

  test("a bare color hint (no mode) routes to chroma", async () => {
    const green = await solidPng(16, 16, { r: 0, g: 255, b: 0 });
    const { operation } = await removeBackgroundToPng(green, { color: "#00FF00" });
    expect(operation).toContain("chroma-key(#00FF00");
  });

  test("an explicit threshold hint (no mode) routes to threshold", async () => {
    const white = await solidPng(16, 16, { r: 255, g: 255, b: 255 });
    const { operation } = await removeBackgroundToPng(white, { threshold: 240 });
    expect(operation).toBe("remove-bg(threshold:240)");
  });
});
