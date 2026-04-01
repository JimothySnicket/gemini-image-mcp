# Changelog

All notable changes to this project are documented here. Every completed task gets an entry, even minor ones.

## [0.2.0] - Planned

Design spec written: `docs/superpowers/specs/2026-04-01-v02-features-design.md`

- Output organization: `filename` param with auto-versioning (hero-banner.png, hero-banner-v2.png), `subfolder` param
- Generation manifest: `generations.jsonl` append-only log of all generations with prompts, params, cost
- Session tracking: running totals (generations, cost) returned in every response
- Rate limiting: `MAX_REQUESTS_PER_HOUR`, `MAX_COST_PER_HOUR` env vars with clear error messages
- Multi-turn editing: `sessionId` param, server-managed conversation history, thoughtSignature preservation
- Seed parameter: reproducible generation
- Google Search grounding: `useSearchGrounding` param for real-world accuracy

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
