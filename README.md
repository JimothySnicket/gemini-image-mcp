# gemini-image-mcp

MCP server for Google Gemini image generation and editing. One tool, no bloat.

## Features

- **Text-to-image** — describe what you want, get an image
- **Image editing** — provide reference images and an editing instruction
- **Cost reporting** — every response includes token counts and estimated USD cost
- **Multiple models** — gemini-2.5-flash-image, gemini-3-pro, gemini-3.1-flash
- **Full aspect ratio support** — 1:1, 16:9, 9:16, 3:2, 2:3, 4:3, 3:4, 21:9
- **Resolution control** — 1K, 2K, 4K

## Quick Start

### As an MCP server (any client)

Add to your MCP client config (e.g. `.mcp.json` for Claude Code):

```json
{
  "mcpServers": {
    "gemini-image": {
      "command": "node",
      "args": ["/path/to/gemini-image-mcp/dist/index.js"],
      "env": {
        "GEMINI_API_KEY": "${GEMINI_API_KEY}"
      }
    }
  }
}
```

### As a Claude Code plugin

```bash
/plugin install /path/to/gemini-image-mcp
```

## Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GEMINI_API_KEY` | Yes | — | Google Gemini API key ([get one](https://aistudio.google.com/apikey)) |
| `OUTPUT_DIR` | No | `~/gemini-images` | Default directory for saved images |
| `DEFAULT_MODEL` | No | `gemini-2.5-flash-image` | Default Gemini model |
| `LOG_LEVEL` | No | `info` | `debug`, `info`, or `error` |
| `REQUEST_TIMEOUT_MS` | No | `60000` | API request timeout in milliseconds |

## Tool: `generate_image`

### Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `prompt` | Yes | Text description or editing instruction |
| `images` | No | Array of file paths to input/reference images |
| `model` | No | Gemini model ID |
| `aspectRatio` | No | `1:1`, `16:9`, `9:16`, `3:2`, `2:3`, `4:3`, `3:4`, `21:9` |
| `resolution` | No | `1K`, `2K`, `4K` |
| `personGeneration` | No | `ALLOW_ALL`, `ALLOW_ADULT`, `ALLOW_NONE` |
| `outputDir` | No | Override output directory for this request |

### Example Response

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
    "estimatedCost": "$0.0390"
  }
}
```

### Usage Examples

**Text-to-image:**
> "Generate a hero image for a SaaS landing page, modern gradient style, 16:9"

**Image editing:**
> "Take this screenshot and redesign the header with a dark theme" (with image paths)

**High quality:**
> "A photorealistic product shot of headphones on marble, 4K" (using gemini-3-pro-image-preview)

## Models

| Model | Strengths | Notes |
|-------|-----------|-------|
| `gemini-2.5-flash-image` | Fast, cheap (~$0.04/image) | Default. Good all-rounder |
| `gemini-3-pro-image-preview` | Best quality, text rendering, 4K | Up to 14 reference images |
| `gemini-3.1-flash-image-preview` | Speed + quality balance | Google Search grounding |

## Development

```bash
bun install
bun run build     # TypeScript -> dist/
bun run dev       # Run directly with Bun
```

## License

MIT
