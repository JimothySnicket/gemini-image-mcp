# Changelog

All notable changes to this project.

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

