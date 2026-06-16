# gemini-image-mcp

A simple, focused MCP server for Google Gemini's native image generation — the "Nano Banana" models. Generate, edit, and locally process images from Claude Code, Claude Desktop, or any stdio-based MCP client. Two tools, no bloat.

Built for agents: a single call returns a *saved image* — or, with one-call background removal, a ready-to-use transparent PNG — without streaming image data through your agent's context. Uses Gemini's `generateContent` API (not the deprecated Imagen API).

## Install

```bash
npm install -g @jimothy-snicket/gemini-image-mcp
```

Or use directly with npx:

```bash
npx -y @jimothy-snicket/gemini-image-mcp
```

**Claude Code (one command):**

```bash
claude mcp add gemini-image -- npx -y @jimothy-snicket/gemini-image-mcp
```

Requires a `GEMINI_API_KEY` environment variable — see [Setup](#setup) for details.

**Set up a config file (optional):**

```bash
npx @jimothy-snicket/gemini-image-mcp --init
```

Creates `~/.gemini-image-mcp.json` with commented defaults. For project-specific overrides:

```bash
npx @jimothy-snicket/gemini-image-mcp --init --local
```

## Features

### generate_image — AI-powered
- **Text-to-image** — describe what you want, get an image
- **Image editing** — provide reference images and an editing instruction
- **Transparent assets in one call** — `removeBackground` returns a clean transparent PNG: a local AI matte (works on any subject; optional add-on, see below) by default, or built-in green-screen / white-threshold keying. No extra API cost
- **Multi-turn edits** — pass a `sessionId` to refine an image across calls, with prior turns kept as context
- **Multi-image input** — up to ~14 reference images on gemini-3.1-flash-image (~11 on gemini-3-pro-image)
- **Cost reporting** — every response includes token counts, estimated USD cost, and session totals
- **Rate limiting** — configurable per-hour caps on requests and cost to prevent runaway agents
- **Auto model discovery** — detects available image models from your API key at startup
- **Seed** — reproducible generation with integer seeds
- **Google Search grounding** — real-world accuracy on the gemini-3.x image models

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
| `GEMINI_IMAGE_AUTO_INSTALL` | `1` (on) | Auto-install the AI matte engine on first `removeBackground: { mode: "auto" }` use. Set `0` to disable (then `auto` falls back to chroma/threshold with instructions) |

Set these the same way as `GEMINI_API_KEY`, or pass them in the `env` block of your MCP config.

**Rate limiting** is recommended when agents have access to this tool. An agent in a loop can generate images quickly — set `MAX_REQUESTS_PER_HOUR=20` and `MAX_COST_PER_HOUR=5` as sensible defaults.

### Config File

Instead of environment variables, you can use a JSON config file. Create one with:

```bash
npx @jimothy-snicket/gemini-image-mcp --init
```

This creates `~/.gemini-image-mcp.json` with all defaults and inline documentation. Edit it to set your preferences.

**Priority:** env vars > local config (`.gemini-image-mcp.json` in CWD) > global config (`~/.gemini-image-mcp.json`) > defaults.

You can also set per-tool defaults so every request uses your preferred settings:

```json
{
  "defaultModel": "gemini-3.1-flash-image",
  "defaults": {
    "generate": {
      "aspectRatio": "16:9",
      "resolution": "2K"
    },
    "process": {
      "removeBackground": { "color": "#00FF00" },
      "trim": true
    }
  }
}
```

Per-request parameters always override config defaults.

**Custom pricing.** Cost estimates come from a built-in per-token rate table (there's no pricing API to fetch live). If you use a model the table doesn't know yet — or Google changes a rate before this package updates — add `pricingOverrides` so cost reporting stays accurate without waiting for a release:

```json
{
  "pricingOverrides": {
    "some-new-image-model": {
      "inputPerMillion": 0.5,
      "textOutputPerMillion": 60,
      "imageOutputPerMillion": 60,
      "thinkingPerMillion": 60
    }
  }
}
```

Models with no entry (built-in or override) still generate — their cost is reported as `unknown` rather than guessed.

## Tool: `generate_image`

### Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `prompt` | Yes | Text description or editing instruction |
| `images` | No | Array of file paths to input/reference images |
| `model` | No | Gemini model ID |
| `aspectRatio` | No | `1:1`, `2:3`, `3:2`, `3:4`, `4:3`, `4:5`, `5:4`, `9:16`, `16:9`, `21:9`, plus `1:4`, `4:1`, `1:8`, `8:1` (gemini-3.1-flash-image). Validated by the API. |
| `resolution` | No | `512` (gemini-3.1-flash-image only), `1K`, `2K`, `4K` |
| `outputDir` | No | Override output directory for this request |
| `filename` | No | Base name for saved file (e.g. `hero-banner`). Auto-versioned if duplicate. |
| `subfolder` | No | Subfolder within output directory (e.g. `landing-page`) |
| `sessionId` | No | Continue a multi-turn editing session from a previous response |
| `seed` | No | Integer seed for reproducible generation |
| `useSearchGrounding` | No | Enable Google Search grounding (gemini-3.x image models) |
| `removeBackground` | No | Return a transparent PNG cutout. `{ "mode": "auto" }` = local AI matte (any subject; default); `{ "mode": "chroma" }` = green screen; `{ "mode": "threshold" }` = white removal (line art). No extra API cost |

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
    "estimatedCost": "$0.0390",
    "pricingVerifiedDate": "2026-06-15"
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

**Iterative editing (multi-turn):**
> Generate an image, then call again with the returned `sessionId` and a refinement like "make it more minimal" — the prior image stays in context.

**Organized output:**
> "Generate a hero banner" with `filename: "hero"`, `subfolder: "landing-page"` → saves to `~/gemini-images/landing-page/hero.png`

**High quality:**
> "A photorealistic product shot of headphones on marble, 4K" (using gemini-3-pro-image)

**Transparent asset (one call):**
> "A glossy red sneaker, product shot" with `removeBackground: { "mode": "auto" }` → a ready-to-place transparent PNG. The local AI matte works on any subject — no green screen needed.

## Tool: `process_image`

Local image processing via sharp. Free, fast, no API calls.

### Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `imagePath` | Yes | Path to the image file to process |
| `crop` | No | Crop by pixel dimensions, aspect ratio, or focal point strategy |
| `resize` | No | Resize to width/height (maintains aspect ratio) |
| `removeBackground` | No | Remove background: `{ "mode": "auto" }` (AI matte, any subject), `{ "mode": "chroma" }` (green screen), or `{ "mode": "threshold" }` (white). Defaults to chroma if `color` set, else threshold |
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
// AI semantic matte — best quality, works on ANY subject
{"mode": "auto"}

// White/light background (threshold)
{"mode": "threshold", "threshold": 240}

// Green screen (chroma key)
{"mode": "chroma", "color": "#00FF00"}

// Any solid colour
{"mode": "chroma", "color": "#0000FF", "tolerance": 60}
```

`mode: "auto"` runs a local BiRefNet matte that isolates the subject semantically — so it handles hair, glass, and green/yellow subjects that chroma key can't. **The matte engine isn't bundled** (keeps the base install ~65 MB). On your first `auto` call the server auto-installs it (`@huggingface/transformers`, ~340 MB) plus the fp16 model (~109 MB) — a one-time pause of a minute or two, then it runs locally with no extra API cost. Set `GEMINI_IMAGE_AUTO_INSTALL=0` to disable auto-install (then `auto` falls back to returning the image with instructions to install it manually). `chroma` and `threshold` need nothing extra.

Chroma key (`mode: "chroma"`) uses HSV keying with smoothstep feathering, spill suppression, and 5-pass edge anti-aliasing (default tolerance 80). Use `#00FF00` for AI-generated green screens — it works better than matching the exact shade Gemini produces.

**Note:** Chroma key destroys subjects that share the key colour (green/yellow) and transparent/reflective subjects (glass) — the green parrot vanishes. For those, use `mode: "auto"` (the AI matte preserves them), or the canvas approach: feed a solid-colour background image to `generate_image` and let Gemini place the subject with correct lighting. The canvas approach is still best for truly transparent objects like glass, which should transmit the *final* background rather than be cut out.

### Common Pipelines

**Subject on a specific background (canvas approach):**
```
generate_image → "Place a [subject] on this background" with images: [solid colour canvas]
```
One API call. Best for yellow, green, or glass subjects where chroma key struggles.

**Transparent asset (one call):**
```
generate_image → "A product photo of <subject>" with removeBackground: {mode: "auto"}
```
One API call → a transparent PNG. The local AI matte works on any subject. (For truly transparent/reflective objects like glass, the canvas approach above is still best.)

**Transparent asset from green screen (zero-dependency):**
```
generate_image → "A product photo on a bright green background"
process_image → removeBackground {mode: "chroma"} + trim
```
Avoids the matte model entirely — best for high-contrast subjects on locked-down/offline machines.

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

| Model | Strengths | Resolution | Notes |
|-------|-----------|------------|-------|
| `gemini-2.5-flash-image` | Cheapest (~$0.04/image) | 1K | Default. Shuts down 2026-10-02 |
| `gemini-3.1-flash-image` | Speed + quality, Google Search grounding | 512, 1K, 2K, 4K | ~$0.07/1K image. ~14 reference images |
| `gemini-3-pro-image` | Best quality, text rendering | 1K, 2K, 4K | ~$0.13/1K image. ~11 reference images |

The `-preview` IDs (`gemini-3-pro-image-preview`, `gemini-3.1-flash-image-preview`) are still accepted during Google's cutover but **retire 2026-06-25** — use the GA IDs above. The server discovers whichever image models your API key supports at startup and validates each request against that live list, so new models work without an update.

## Development

```bash
bun install
bun run build     # TypeScript -> dist/
bun run dev       # Run directly with Bun
```

## License

MIT
