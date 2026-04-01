# Gemini Image MCP — Design Spec

> Standalone MCP server wrapping Google Gemini's native image generation API. Works with any MCP client. Ships as both npm package and Claude Code plugin.

## Core Design Principle

One tool, parameter-driven routing. The behaviour changes based on what inputs are provided — not which tool you call. Future capabilities add parameters, not tools, keeping context cost flat.

## Tool: `generate_image`

### Parameters

| Parameter | Required | Type | Default | Description |
|-----------|----------|------|---------|-------------|
| `prompt` | Yes | string | — | Text description or editing instruction |
| `images` | No | string[] | — | File paths to input/reference images (up to 14 on gemini-3-pro) |
| `model` | No | string | `gemini-2.5-flash-image` | Gemini model ID |
| `aspectRatio` | No | string | `1:1` | `1:1`, `16:9`, `9:16`, `3:2`, `2:3`, `4:3`, `3:4`, `21:9` |
| `resolution` | No | string | `1K` | `1K`, `2K`, `4K` |
| `personGeneration` | ~~No~~ | ~~string~~ | — | **REMOVED** — Vertex AI only, Gemini API rejects it |
| `outputDir` | No | string | `OUTPUT_DIR` env or `~/gemini-images` | Where to save the generated image |

### Routing Logic

- No `images` provided → text-to-image generation
- `images` provided → image editing (images sent as inline content parts alongside prompt)

### Return Value

```json
{
  "imagePath": "/home/user/gemini-images/gemini-1711929600000-a1b2c3.png",
  "mimeType": "image/png",
  "model": "gemini-2.5-flash-image",
  "usage": {
    "promptTokens": 5,
    "outputTokens": 1295,
    "imageTokens": 1290,
    "thinkingTokens": 412,
    "totalTokens": 1712,
    "estimatedCost": "$0.039"
  }
}
```

## Architecture

```
gemini-image-mcp/
├── src/
│   ├── index.ts          — MCP server entry, tool registration, request handling
│   ├── generate.ts       — Core generation logic (Gemini API calls)
│   ├── pricing.ts        — Model pricing table + cost calculator
│   └── utils.ts          — Image saving, base64 decode, file I/O, logging
├── skills/
│   └── image-generation/
│       └── SKILL.md      — Claude Code skill (when/how to use the tool)
├── plugin.json           — Claude Code plugin manifest
├── package.json
├── tsconfig.json
├── README.md
└── .gitignore
```

### Data Flow

1. MCP client sends `tools/call` with `generate_image` and params
2. `index.ts` validates input against schema
3. `generate.ts` builds the `generateContent` request:
   - Sets `responseModalities: ['TEXT', 'IMAGE']`
   - Nests `aspectRatio` and `imageSize` inside `config.imageConfig` (not top-level)
   - If `images` provided, reads files from disk, converts to base64, adds as inline content parts
4. Gemini API returns response with image parts + `usageMetadata`
5. Image decoded from base64, saved to output directory
6. `pricing.ts` calculates estimated cost from usage metadata + model pricing table
7. Structured result returned to MCP client

### API Correctness

These are hard-won lessons from the Zeke ImageGen work:

- `responseModalities: ['TEXT', 'IMAGE']` is **required** — omitting it gives text-only responses
- `aspectRatio` must be nested inside `config.imageConfig`, NOT at the top level of `config` (causes 400)
- Values are case-sensitive: `'TEXT'`, `'IMAGE'` (uppercase)
- SDK uses camelCase (`imageConfig`, `aspectRatio`), REST uses snake_case — SDK translates automatically
- Max 1 image per `generateContent` call
- All images include SynthID watermarks (cannot disable)
- For future multi-turn: `thoughtSignature` fields must be preserved in conversation history

## Authentication

- Primary: `GEMINI_API_KEY` environment variable
- Fail fast at startup with clear error if not set
- This is the MCP spec's recommended approach for stdio servers
- Documentation will include secure setup guidance (env var expansion in `.mcp.json`, OS keychain wrapper pattern)

## Configuration

| Env Variable | Required | Default | Description |
|-------------|----------|---------|-------------|
| `GEMINI_API_KEY` | Yes | — | Google Gemini API key |
| `OUTPUT_DIR` | No | `~/gemini-images` | Default output directory |
| `DEFAULT_MODEL` | No | `gemini-2.5-flash-image` | Default model |
| `LOG_LEVEL` | No | `info` | `debug`, `info`, `error` |
| `REQUEST_TIMEOUT_MS` | No | `60000` | Timeout for Gemini API calls |

## Error Handling

No silent failures. Every error surfaces to the client via MCP's structured error response:

| Scenario | Behaviour |
|----------|-----------|
| No API key | Fail at startup: "GEMINI_API_KEY not set" |
| Invalid model | Error with available models listed |
| API 400 (bad params) | Return Gemini's error message directly |
| Safety filter blocks | Return `raiFilteredReason`, not empty result |
| Input file not found | Return which file path failed and why |
| Output write failure | Return OS error message |
| API timeout | Error after `REQUEST_TIMEOUT_MS` with clear message |

## Logging

Stderr only (stdout is the MCP protocol transport):

- **Startup:** config loaded, model default, output dir, log level
- **Per-request:** model, image count, token usage, estimated cost, elapsed time
- **Errors:** full error with context

Controlled by `LOG_LEVEL` env var. `debug` shows full request/response shapes for development.

## Cost Reporting

Every response includes token counts from `usageMetadata` plus an estimated USD cost.

Pricing is maintained as a simple lookup object in `pricing.ts`, keyed by model ID. Each entry has rates for input tokens, text output tokens, image output tokens, and thinking tokens. The object includes a `lastVerified` date. Estimated cost comes with implicit understanding that it's approximate — pricing changes over time.

## Output

- Default location: `OUTPUT_DIR` env var, falling back to `~/gemini-images/`
- Per-request override via `outputDir` parameter
- Directory created automatically if it doesn't exist
- Filename: `gemini-{timestamp}-{short-hash}.{ext}` by default, or user-specified with auto-versioning
- Extension matches mime type (flash returns PNG, pro returns JPEG)
- Subfolder support for organized output

## Distribution

### npm Package
- Published to npm for use with any MCP client
- Users add to their MCP client config with the standard stdio transport
- `npx gemini-image-mcp` for zero-install usage

### Claude Code Plugin
- `plugin.json` manifest pointing to the MCP server and skill
- Skill teaches Claude when to generate images proactively (hero sections, placeholders, assets)
- CLI wrapper for direct bash invocation from the skill (avoids MCP protocol overhead)
- Install via `/plugin install`

## Tech Stack

- **Language:** TypeScript
- **Runtime:** Bun / Node.js >=18
- **SDK:** `@google/genai` (Google's official Gemini SDK)
- **MCP:** `@modelcontextprotocol/sdk`
- **Image Processing:** `sharp`
- **Validation:** Zod

## Implemented (was Future/Post-MVP)

- ~~Multi-turn editing sessions~~ — DONE: `sessionId` param, thoughtSignature preservation, 30min expiry
- ~~Model discovery from API key~~ — DONE: `models.list` at startup, Imagen filtered out
- Dynamic tool registration — not needed (2 tools, ~400 tokens total)
- Automated pricing lookup — deferred (manual table works, cost estimate included)

## Competitive Position

| Feature | RLabs | mintmcqueen | guinacio | **This** |
|---------|-------|-------------|----------|----------|
| Tool count | 37 | 14 | 1 | **2** |
| Image generation | Yes | Yes | Yes | **Yes** |
| Image input/editing | Session-based | Single input | No | **Multi-image + sessions** |
| Local processing | No | No | No | **Yes (sharp)** |
| Cost reporting | No | No | No | **Yes + session totals** |
| Rate limiting | No | No | No | **Yes** |
| Auto model discovery | No | No | No | **Yes** |
| Correct API usage | Unknown | Stale | Basic | **Verified + tested** |
| Context cost | ~5000-9000 tokens | ~2000 tokens | ~200 tokens | **~400 tokens** |
| Active | Yes | No (Nov 2025) | Yes | **Yes** |
