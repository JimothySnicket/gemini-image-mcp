# Changelog

All notable changes to this project are documented here. Every completed task gets an entry, even minor ones.

## [0.2.0] - 2026-04-01

### Added
- `process_image` tool: local image processing via sharp. Free, fast, no API calls.
  - Crop: pixel-exact, aspect ratio (center), or focal point (attention/entropy strategies)
  - Resize: width, height, or both with aspect ratio preservation
  - Background removal: threshold-based, near-white pixels to transparent
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

### Tested — v0.2 (2026-04-01)
- Filename param: `logo.png` saved correctly
- Auto-versioning: second `logo` saved as `logo-v2.png`
- Subfolder: `test-v02/` created and used
- Session tracking: running count and cost across 5 generations
- Manifest: all generations logged to `generations.jsonl`
- Multi-turn: coffee logo → B&W edit preserved design across turns (prompt tokens 10→294)
- Seed: accepted without error
- Imagen filtering: 3 models in discovery (was 6)
- Rate limit startup warning: showing correctly
- process_image resize: 1024x1024 → 256x256 thumbnail, sharp and correct
- process_image format conversion: PNG → JPEG at quality 80
- process_image background removal: threshold-based, white areas made transparent on B&W logo
- process_image trim: whitespace removed, 256x256 → 154x62
- process_image crop: 512x512 center quadrant extracted from 1024x1024

## [0.1.0] - 2026-04-01

### Added (post-test)
- Auto model discovery at startup: calls `models.list` to find image-capable models, validates API key, logs available models
- Model validation on each request: if discovery succeeded, rejects unknown models with a list of what's available
- New models appear automatically on next server restart — no code changes needed
- Discovery failure is non-fatal: server starts anyway, errors surface on first request
- Imagen models filtered out of discovery — deprecated June 2026, uses a different API (`generateImages`), not compatible with this server
- README updated: positioned as the Gemini native wrapper for Imagen migration

### Verified (post-restart 2026-04-01)
- Model discovery: found 6 image models including 3 Gemini native + 3 Imagen 4. Startup in ~200ms.
- Note: Imagen 4 models (`imagen-4.0-*`) appear in discovery but use a different API (`generateImages`). Will fail gracefully if used — could filter these out in future.
- File extension fix verified: gemini-3-pro saves as `.jpg`, flash saves as `.png`
- Safety filter fix verified: blocked prompts now return the model's actual refusal text instead of generic "no image returned"
- personGeneration removed from tool schema confirmed

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
- Claude Code plugin layer: `plugin.json` manifest + `skills/image-generation/SKILL.md`
- README with step-by-step setup for Claude Code, Claude Desktop, and generic MCP clients
- Design spec at `docs/superpowers/specs/2026-04-01-gemini-image-mcp-design.md`

### Changed
- Removed `personGeneration` parameter — not supported on Gemini API (Vertex AI only), SDK types include it but API rejects
- File extension now matches actual mime type — gemini-3-pro returns JPEG, was incorrectly saved as .png
- Improved safety filter detection: checks `promptFeedback.blockReason`, `finishReason`, and text-only responses with model's explanation
- Added debug logging of full response shape when no image is returned

### Tested — Full Suite (2026-04-01)
- **US-1 (text-to-image):** 6/7 pass, 1 removed (personGeneration). Resolution param may be silently ignored on flash model.
- **US-2 (image editing):** 4/4 pass. Single edit, style transfer, multi-image combine all work. "Crop" language triggers text-only — use "recreate" instead.
- **US-3 (cost reporting):** 4/4 pass. Flash: $0.04/image, Pro: $0.15/image, Pro 4K: $0.26/image.
- **US-4 (error handling):** 5/6 pass, 1 partial (safety filter detection improved but needs restart to verify).
- **US-5 (templates):** 5/5 pass. Hero banners, app icons, social cards, mobile screenshots, product shots all produce usable assets. Text rendering on flash model has errors — use pro for text-heavy assets.

### Key Findings
- gemini-2.5-flash-image: ~$0.04/image, ~6s, returns PNG
- gemini-3-pro-image-preview: ~$0.15/image, ~16s, returns JPEG, has thinking tokens, better text rendering
- Pro 4K: ~$0.26/image, 2000 image tokens vs 1290 for 1K
- Input images add ~260 tokens per image to prompt count
- "Crop/resize" prompts fail — model gives text-only. Use "recreate/reimagine" language
