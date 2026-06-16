/**
 * Pricing drift check — a maintenance helper, NOT part of the build or CI.
 *
 * Gemini publishes image pricing only as a human-readable docs page; there is no
 * pricing API (the model resource and SDK expose token counts, never rates). This
 * script fetches that page and prints it next to our static table so a human can
 * confirm the rates are still current and bump PRICING_VERIFIED_DATE. It does NOT
 * try to auto-parse exact numbers — the page format is prose and would give false
 * alarms. It surfaces the data for a human diff and flags the one high-signal case
 * it can detect reliably: a model ID in our table that no longer appears anywhere
 * on the page (a strong hint it was renamed or deprecated).
 *
 * Run after a build (it reads the compiled table):  npm run build && npm run check:pricing
 * Requires network access.
 */
import { PRICING, PRICING_VERIFIED_DATE } from "../dist/pricing.js";

const PRICING_URL = "https://ai.google.dev/gemini-api/docs/pricing.md.txt";

let page;
try {
  const res = await fetch(PRICING_URL);
  if (!res.ok) {
    console.error(`Failed to fetch pricing page: ${res.status} ${res.statusText}`);
    process.exit(2);
  }
  page = await res.text();
} catch (err) {
  console.error(`Failed to fetch pricing page: ${err?.message ?? err}`);
  process.exit(2);
}

console.log(`Pricing page : ${PRICING_URL}`);
console.log(`Our verified : ${PRICING_VERIFIED_DATE}`);
console.log(`Models in our table: ${Object.keys(PRICING).length}\n`);

console.log("=== OUR TABLE (src/pricing.ts), USD per 1M tokens ===");
for (const [model, p] of Object.entries(PRICING)) {
  console.log(
    `  ${model}\n    input $${p.inputPerMillion} | image-out $${p.imageOutputPerMillion} | ` +
      `text-out $${p.textOutputPerMillion} | thinking $${p.thinkingPerMillion}`,
  );
}

console.log("\n=== PAGE: lines mentioning image pricing ($ on an image line) ===");
for (const line of page.split("\n")) {
  if (/image/i.test(line) && /\$/.test(line)) console.log("  " + line.trim());
}

// The one check we can make reliably: does each model ID still appear on the page?
// (The page uses display names too, so absence of the ID is a hint, not proof.)
console.log("\n=== Model ID presence on page (heuristic) ===");
let missing = 0;
for (const model of Object.keys(PRICING)) {
  const present = page.includes(model);
  console.log(`  ${present ? "present" : "ABSENT "}  ${model}`);
  if (!present) missing++;
}

console.log(
  "\nVerify the per-1M-token rates above by hand against the page. If they still match,\n" +
    "bump PRICING_VERIFIED_DATE in src/pricing.ts. If a model is ABSENT, check whether it\n" +
    "was renamed or deprecated.",
);
if (missing > 0) {
  console.log(`\nNote: ${missing} model ID(s) not found verbatim on the page (may just be display-name only).`);
}
