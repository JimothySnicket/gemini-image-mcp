# gemini-image-mcp

MCP server for Google Gemini image generation, editing, and processing. Two tools, no bloat.

Built on Gemini's native image generation API (`generateContent`), not the deprecated Imagen API. If you're migrating from Imagen (shutting down June 2026), this is what you move to — multi-turn editing, reference images, and all the features Imagen didn't have.

## Features

### generate_image — AI-powered
- **Text-to-image** — describe what you want, get an image
- **Image editing** — provide reference images and an editing instruction
- **Multi-turn sessions** — iteratively refine images with conversation history
- **Multi-image input** — up to 14 reference images on gemini-3-pro
- **Cost reporting** — every response includes token counts, estimated USD cost, and session totals
- **Rate limiting** — configurable per-hour caps on requests and cost to prevent runaway agents
- **Auto model discovery** — detects available image models from your API key at startup
- **Seed** — reproducible generation with integer seeds
- **Google Search grounding** — real-world accuracy on gemini-3.1-flash

### process_image — Local (free, no API calls)
- **Crop** — pixel-exact, aspect ratio (center), or focal point (attention/entropy)
- **Resize** — to width, height, or both (maintains aspect ratio)
- **Background removal** — threshold-based (white backgrounds) or chroma key (green screen, any solid colour)
- **Chroma key pipeline** — HSV keying with smoothstep feather, spill suppression, and edge anti-aliasing
- **Trim** — auto-remove whitespace borders
- **Format conversion** — PNG, JPEG, WebP with quality control

### Both tools
- **Output organization** — meaningful filenames with auto-versioning, subfolders
- **Generation manifest** — `generations.jsonl` logs every generation with prompt, params, cost
- **Full aspect ratio support** — 1:1, 16:9, 9:16, 3:2, 2:3, 4:3, 3:4, 21:9
- **Resolution control** — 1K, 2K, 4K

## Setup

### 1. Get a Gemini API Key

Go to [Google AI Studio](https://aistudio.google.com/apikey) and create an API key. It's free to start with generous rate limits.

### 2. Set the API Key

The server reads your key from the `GEMINI_API_KEY` environment variable. Set it once so it's available in every session:

**Windows (PowerShell — run as admin):**
```powershell
[System.Environment]::SetEnvironmentVariable('GEMINI_API_KEY', 'your-key-here', 'User')
```
Then restart your terminal.

**macOS / Linux:**
```bash
echo 'export GEMINI_API_KEY="your-key-here"' >> ~/.bashrc
source ~/.bashrc
```
(Use `~/.zshrc` if you're on zsh.)

**Verify it's set:**
```bash
echo $GEMINI_API_KEY
```

### 3. Connect to Your MCP Client

Pick the method that matches how you use MCP:

#### Claude Code (one-liner)

```bash
claude mcp add gemini-image -- npx -y @jimothy-snicket/gemini-image-mcp
```

Claude Code will pick up `GEMINI_API_KEY` from your environment automatically.

#### Claude Code (manual `.mcp.json`)

Add to `.mcp.json` in your project root or `~/.claude/.mcp.json` for global access:

```json
{
  "mcpServers": {
    "gemini-image": {
      "command": "npx",
      "args": ["-y", "@jimothy-snicket/gemini-image-mcp"],
      "env": {
        "GEMINI_API_KEY": "${GEMINI_API_KEY}"
      }
    }
  }
}
```

The `${GEMINI_API_KEY}` syntax reads the value from your shell environment — your actual key never gets written into config files.

#### Claude Desktop

Edit `claude_desktop_config.json`:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "gemini-image": {
      "command": "npx",
      "args": ["-y", "@jimothy-snicket/gemini-image-mcp"],
      "env": {
        "GEMINI_API_KEY": "${GEMINI_API_KEY}"
      }
    }
  }
}
```

Restart Claude Desktop after saving.

#### Other MCP Clients

Any client that supports stdio transport works. Point it at `npx -y @jimothy-snicket/gemini-image-mcp` and pass `GEMINI_API_KEY` in the environment.

### Security Notes

- Never commit your API key to version control. The `${GEMINI_API_KEY}` syntax in config files references your environment — the key itself stays in your shell profile.
- If your `.mcp.json` is in a project repo, add it to `.gitignore` or use the global config at `~/.claude/.mcp.json` instead.
- For extra security, you can use a wrapper script that reads the key from your OS keychain (macOS Keychain, Windows Credential Manager) and launches the server with it injected.

## Configuration

All optional. The only required setup is `GEMINI_API_KEY` (covered above).

| Variable | Default | Description |
|----------|---------|-------------|
| `OUTPUT_DIR` | `~/gemini-images` | Default directory for saved images |
| `DEFAULT_MODEL` | `gemini-2.5-flash-image` | Default Gemini model |
| `LOG_LEVEL` | `info` | `debug`, `info`, or `error` |
| `REQUEST_TIMEOUT_MS` | `60000` | API request timeout in milliseconds |
| `MAX_REQUESTS_PER_HOUR` | `0` (unlimited) | Max image generations per rolling hour |
| `MAX_COST_PER_HOUR` | `0` (unlimited) | Max estimated cost (USD) per rolling hour |
| `SESSION_TIMEOUT_MS` | `1800000` (30min) | Multi-turn session expiry |

Set these the same way as `GEMINI_API_KEY`, or pass them in the `env` block of your MCP config.

**Rate limiting** is recommended when agents have access to this tool. An agent in a loop can generate images quickly — set `MAX_REQUESTS_PER_HOUR=20` and `MAX_COST_PER_HOUR=5` as sensible defaults.

## Tool: `generate_image`

### Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `prompt` | Yes | Text description or editing instruction |
| `images` | No | Array of file paths to input/reference images |
| `model` | No | Gemini model ID |
| `aspectRatio` | No | `1:1`, `16:9`, `9:16`, `3:2`, `2:3`, `4:3`, `3:4`, `21:9` |
| `resolution` | No | `1K`, `2K`, `4K` |
| `outputDir` | No | Override output directory for this request |
| `filename` | No | Base name for saved file (e.g. `hero-banner`). Auto-versioned if duplicate. |
| `subfolder` | No | Subfolder within output directory (e.g. `landing-page`) |
| `sessionId` | No | Continue a multi-turn editing session from a previous response |
| `seed` | No | Integer seed for reproducible generation |
| `useSearchGrounding` | No | Enable Google Search grounding (gemini-3.1-flash) |

### Example Response

```json
{
  "imagePath": "/home/user/gemini-images/hero-banner.png",
  "mimeType": "image/png",
  "model": "gemini-2.5-flash-image",
  "sessionId": "session-1711929600000-a1b2c3",
  "sessionTurn": 1,
  "usage": {
    "promptTokens": 5,
    "outputTokens": 1295,
    "imageTokens": 1290,
    "thinkingTokens": 412,
    "totalTokens": 1712,
    "estimatedCost": "$0.0390"
  },
  "session": {
    "generationsThisSession": 3,
    "totalCostThisSession": "$0.1161",
    "generationsThisHour": 5,
    "limit": {
      "maxPerHour": 20,
      "maxCostPerHour": 5,
      "remainingThisHour": 15
    }
  }
}
```

### Usage Examples

**Text-to-image:**
> "Generate a hero image for a SaaS landing page, modern gradient style, 16:9"

**Image editing:**
> "Take this screenshot and redesign the header with a dark theme" (with image paths)

**Multi-turn refinement:**
> "Draw a logo for a coffee shop" → get result with `sessionId` → "Make it more minimal" (pass `sessionId` back)

**Organized output:**
> "Generate a hero banner" with `filename: "hero"`, `subfolder: "landing-page"` → saves to `~/gemini-images/landing-page/hero.png`

**High quality:**
> "A photorealistic product shot of headphones on marble, 4K" (using gemini-3-pro-image-preview)

## Tool: `process_image`

Local image processing via sharp. Free, fast, no API calls.

### Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `imagePath` | Yes | Path to the image file to process |
| `crop` | No | Crop by pixel dimensions, aspect ratio, or focal point strategy |
| `resize` | No | Resize to width/height (maintains aspect ratio) |
| `removeBackground` | No | Remove background by threshold (white) or chroma key (any solid colour) |
| `trim` | No | Auto-remove whitespace/transparent borders |
| `format` | No | Convert to `png`, `jpeg`, or `webp` |
| `quality` | No | Output quality for JPEG/WebP (1-100) |
| `filename` | No | Base name for saved file. Auto-versioned if duplicate. |
| `subfolder` | No | Subfolder within output directory |
| `outputDir` | No | Override output directory |

### Crop Options

```json
// Pixel-exact
{"width": 500, "height": 300, "left": 100, "top": 50}

// Aspect ratio (center crop)
{"aspectRatio": "16:9"}

// Focal point — shifts crop to the most interesting region
{"aspectRatio": "16:9", "strategy": "attention"}

// Detail-based — shifts crop to the most detailed region
{"aspectRatio": "16:9", "strategy": "entropy"}
```

### Background Removal Options

```json
// White/light background (threshold)
{"threshold": 240}

// Green screen (chroma key)
{"color": "#00FF00"}

// Any solid colour
{"color": "#0000FF", "tolerance": 60}
```

Chroma key uses HSV colour space keying with smoothstep feathering, spill suppression (removes colour fringe on edge pixels), and 5-pass edge anti-aliasing. Default tolerance is 80. Always use `#00FF00` for AI-generated green screens — it works better than matching the exact shade Gemini produces.

**Note:** Chroma key works best with high-contrast subjects (red, blue, black on green). For yellow, green, or glass/reflective subjects, use the canvas approach instead — feed a solid colour background image to `generate_image` and let Gemini place the subject with correct lighting.

### Common Pipelines

**Subject on a specific background (canvas approach):**
```
generate_image → "Place a [subject] on this background" with images: [solid colour canvas]
```
One API call. Best for yellow, green, or glass subjects where chroma key struggles.

**Transparent asset from green screen:**
```
generate_image → "A product photo on a bright green background"
process_image → removeBackground {color: "#00FF00"} + trim
```
Two tool calls, zero cost for the processing step. Best for high-contrast subjects.

**Favicon from a generated logo:**
```
process_image → removeBackground {threshold: 230} + trim + resize {width: 192, height: 192}
```

**Social card from a photo:**
```
process_image → crop {aspectRatio: "16:9", strategy: "attention"} + resize {width: 1200}
```

**WebP conversion for web:**
```
process_image → format: "webp" + quality: 85
```

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
