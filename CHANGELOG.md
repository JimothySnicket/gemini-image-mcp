# Changelog

All notable changes to this project.

## [0.5.0] - 2026-06-16

### Added
- **One-call transparent assets** — `generate_image` accepts `removeBackground` to return a transparent PNG in a single call. Default `{ "mode": "auto" }` runs a local AI semantic matte (BiRefNet via `@huggingface/transformers`, MIT model, pinned revision) that works on any subject — including green/yellow and glass/reflective subjects that chroma key can't handle — at no extra API cost (the model downloads once on first use, then runs locally). `{ "mode": "chroma" }` (green screen) and `{ "mode": "threshold" }` (white, for line art) reuse the existing zero-dependency sharp pipeline. If background removal is requested but the matte model can't load, the original image is still saved with a warning (a paid generation is never discarded).
- `process_image` gains `removeBackground` `mode: "auto"` (AI matte) alongside chroma/threshold, so any existing image can be matted.
- Config: `defaults.generate.removeBackground` for per-project defaults (parity with `defaults.process.removeBackground`).

### Changed
- Background-removal logic factored into a shared `background.ts` module used by both tools (chroma/threshold output is unchanged).
- When `process_image` removes a background, the output now defaults to PNG (alpha-capable) instead of the input format, so a JPEG input no longer silently flattens the transparency.
- `removeBackground.color` is hex-validated on both tools.

### Notes
- `mode: "auto"` (AI matte) uses `@huggingface/transformers` (Apache-2.0), an **optional** peer dependency that is deliberately **not** bundled, so the default install stays light (~65 MB). On the first `auto` call the server **auto-installs** it (into a `.matte` vendor dir beside the package) plus the fp16 model (~109 MB) — a one-time pause, then it runs locally with no extra API cost. `generate`, `chroma`, and `threshold` need nothing extra. Set `GEMINI_IMAGE_AUTO_INSTALL=0` to disable auto-install; then (or if the install fails) `auto` keeps the original image and tells the user how to enable it. The matte uses the native onnxruntime CPU binding by default, with a WASM fallback for platforms without a prebuilt binary.

## [0.4.1] - 2026-06-15

### Fixed
- `useSearchGrounding` is no longer pre-rejected against a hardcoded allowlist — the server defers to the API, fixing false rejections on the GA models `gemini-3.1-flash-image` and `gemini-3-pro-image` (the allowlist still named only the `-preview` ID)
- Corrected the Imagen shutdown date in docs to August 17, 2026 (was "June 2026") and refreshed model references to the GA IDs; the `-preview` IDs retire 2026-06-25
- `gemini-3-pro-image` reference-image guidance corrected to ~11 (was "14")
- Corrected text/thinking output rates for the gemini-3.x image models — they were set equal to the image rate, over-costing text/thinking tokens 10–20× and risking premature `maxCostPerHour` trips. Now $12/M (3-pro) and $3/M (3.1-flash) for text/thinking, image output unchanged at $120/$60

### Added
- Pricing entries for the GA model IDs `gemini-3-pro-image` and `gemini-3.1-flash-image` (rates re-verified 2026-06-15 against the official pricing page); `-preview` aliases retained through the cutover
- `pricingOverrides` config key — supply or override per-token rates for models the built-in table doesn't know yet, no release required
- `512` resolution option (gemini-3.1-flash-image)
- `npm run check:pricing` maintenance script — surfaces the live pricing page next to the built-in table for a human re-verify
- Tests for the capability-based discovery filter, GA-model pricing, pricing overrides, and server.json/plugin.json version parity (79 tests, up from 67)

### Changed
- Model discovery filters by the `generateContent` capability instead of an "imagen" name exclusion — more robust to new models and naming changes
- `aspectRatio` is now a free string validated by the API (supports the full current set including 4:5, 5:4, and the ultrawide ratios) instead of a fixed enum
- Tool descriptions and the config template no longer enumerate stale `-preview` model IDs; they point at live discovery
- `plugin.json` version aligned to the package version (was stale at 0.2.0)

## [0.4.0] - 2026-04-23

### Fixed
- Server version string in MCP handshake now reads from package.json at runtime — single source of truth, no more stale 0.2.0 broadcast
- Removed dead `getAvailableModels` import from `index.ts` (function is internal to `generate.ts`)
- Log directory now follows the configured `outputDir` instead of hardcoding `~/gemini-images`
- `useSearchGrounding` now fails fast on unsupported models with a clear error naming the supported model
- Misleading "sanitize" comment in error wrapping removed — code now matches what it actually does
- Rolling rate-limit counter moved in-memory (seeded from disk at startup); no longer re-reads `generations.jsonl` on every request

### Added
- `pricingVerifiedDate` field in cost responses — surfaces how current the pricing data is; flags unknown models as unreliable

### Changed
- Triage Dependabot PRs: zod v4, `@types/node` 25, TypeScript 6 each assessed for merge or close

### Internal
- Regression tests covering: version-string parity, rolling counter O(1) behaviour, grounding model validation, pricing missing-model fallback, log-directory resolution

## [0.3.1] - 2026-04-02

### Added
- MCP server `instructions` field — clients now discover config file documentation on connect
- Per-model resolution limits documented in tool description (gemini-2.5-flash is 1K only, deprecates Oct 2026)

### Fixed
- Trailing comma bug in JSONC comment stripping (prevented parse when commented-out lines preceded closing braces)

## [0.3.0] - 2026-04-02

### Added
- Config file support: JSONC config files with `//` comments for persistent defaults
  - Global config: `~/.gemini-image-mcp.json`
  - Local config: `.gemini-image-mcp.json` in project directory
  - Priority chain: per-request params > env vars > local config > global config > defaults
- `--init` CLI command: generates a commented config file with all defaults documented inline
  - `--init --local` for project-specific config
  - `--force` to overwrite existing config
- Per-tool defaults in config: set default aspect ratio, resolution, background removal, trim, format, quality
- MCP server `instructions` field: clients now receive config file documentation on connect
- New module: `src/config.ts` — centralized config loading, JSONC parsing, validation, caching
- 32 tests for config module (stripJsoncComments, deepMerge, loadConfig, initConfig)

### Changed
- All modules now read settings from centralized config instead of `process.env` directly
- Parameter descriptions reference config file defaults alongside env vars
- Model table in README now includes resolution support per model
- `resolveOutputDir()` accepts explicit default directory parameter

### Security
- API keys rejected from config files with warning (config files get committed to repos)
- String-aware JSONC comment stripping (won't mangle URLs in quoted strings)
- Prototype pollution guard on config deep merge (`__proto__`, `constructor`, `prototype`)
- Unknown config keys warned and dropped (prevents unexpected data injection)

### Fixed
- Trailing commas left by JSONC comment removal now stripped (prevents parse failures when commented-out lines follow real values)

### Docs
- README: added config file section, `--init` instructions, per-model resolution support column
- Config template includes model pricing and resolution compatibility notes
- gemini-2.5-flash documented as 1K only (deprecates Oct 2026)

## [0.2.0] - 2026-04-01

### Added
- `process_image` tool: local image processing via sharp. Free, fast, no API calls.
  - Crop: pixel-exact, aspect ratio (center), or focal point (attention/entropy strategies)
  - Resize: width, height, or both with aspect ratio preservation
  - Background removal: threshold-based (white backgrounds) or chroma key (green screen / any solid colour)
  - Chroma key pipeline: HSV keying with smoothstep feather, spill suppression, 5-pass 3x3 edge anti-aliasing
  - Trim: auto-remove whitespace/transparent borders
  - Format conversion: PNG, JPEG, WebP with quality control
  - Operations chain in a single call (e.g. removeBackground + trim + resize for favicon pipeline)
- `filename` param: meaningful file names with auto-versioning (hero.png, hero-v2.png, hero-v3.png)
- `subfolder` param: organize output into subdirectories (e.g. `landing-page/hero.png`)
- `generations.jsonl` manifest: append-only log of every generation (prompt, params, model, cost, path)
- Session tracking: every response includes `session` object with running totals (generations, cost, hourly count)
- Rate limiting via `MAX_REQUESTS_PER_HOUR` and `MAX_COST_PER_HOUR` env vars. Clear error with remaining budget.
- Startup log warns if no rate limits configured
- Multi-turn editing sessions: `sessionId` param, server-managed conversation history with thoughtSignature preservation, 30min expiry
- Model mismatch detection: error if session uses a different model than the original
- `seed` param: integer seed for reproducible generation
- `useSearchGrounding` param: Google Search grounding for real-world accuracy (gemini-3.1-flash)
- New module: `src/tracker.ts` — manifest, rate limiting, session cost tracking
- Updated SKILL.md with multi-turn, output organization, cost/model guidance
- Updated README with rate limiting, new params, example response with session stats

### Changed
- Single-shot generation uses `responseModalities: ['IMAGE']` instead of `['TEXT', 'IMAGE']`. Eliminates all text-only failures. Sessions still use `['TEXT', 'IMAGE']` for thoughtSignature preservation.
- Prompt prefixing confirmed unnecessary and potentially harmful — removed from guidance
- Resize with both width+height now uses `fit: "cover"` for exact dimensions (was `fit: "inside"`, producing e.g. 188x192 instead of 192x192)
- Default chroma key tolerance bumped from 50 → 80 (Gemini generates desaturated greens that need wider range)
- Server version in MCP handshake now 0.2.0 (was 0.1.0)

## [0.1.0] - 2026-04-01

### Added
- Project initialised: TypeScript + Bun + `@google/genai` v1.47.0 + `@modelcontextprotocol/sdk` v1.29.0
- Single `generate_image` tool with parameter-driven routing (text-to-image or image editing based on inputs)
- Core generation logic (`src/generate.ts`) calling Gemini `generateContent` with correct `responseModalities` and `imageConfig` nesting
- Cost reporting: every response includes token counts (prompt, output, image, thinking) and estimated USD cost
- Pricing table (`src/pricing.ts`) for gemini-2.5-flash-image, gemini-3-pro-image-preview, gemini-3.1-flash-image-preview
- File logging to `~/gemini-images/gemini-mcp.log` alongside stderr logging
- Startup diagnostics: logs Node version, PID, CWD, API key status, default model, output dir
- Configurable via env vars: `GEMINI_API_KEY`, `OUTPUT_DIR`, `DEFAULT_MODEL`, `LOG_LEVEL`, `REQUEST_TIMEOUT_MS`
- API key validation at startup with clear error message
- Request timeout with abort controller (default 60s)
- Safety filter detection: returns `raiFilteredReason` when generation is blocked
- Input image support: reads files from disk, converts to base64, sends as inline content parts
- Supported input formats: PNG, JPEG, GIF, WebP, BMP
- Output images saved as PNG with `gemini-{timestamp}-{hash}.png` naming
- Output directory created automatically if it doesn't exist
- Auto model discovery at startup: finds image-capable models, validates API key
- Model validation on each request: rejects unknown models with a list of what's available
- Imagen models filtered out of discovery — deprecated June 2026, incompatible API
- Claude Code plugin layer: `plugin.json` manifest + `skills/image-generation/SKILL.md`
- README with step-by-step setup for Claude Code, Claude Desktop, and generic MCP clients

### Changed
- Removed `personGeneration` parameter — not supported on Gemini API (Vertex AI only), SDK types include it but API rejects
- File extension now matches actual mime type — gemini-3-pro returns JPEG, was incorrectly saved as .png
- Improved safety filter detection: checks `promptFeedback.blockReason`, `finishReason`, and text-only responses with model's explanation
- Added debug logging of full response shape when no image is returned

