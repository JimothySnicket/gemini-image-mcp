# gemini-image-mcp

MCP server for Google Gemini image generation and editing. One tool, no bloat.

Built on Gemini's native image generation API (`generateContent`), not the deprecated Imagen API. If you're migrating from Imagen (shutting down June 2026), this is what you move to — multi-turn editing, reference images, and all the features Imagen didn't have.

## Features

- **Text-to-image** — describe what you want, get an image
- **Image editing** — provide reference images and an editing instruction
- **Multi-image input** — up to 14 reference images on gemini-3-pro
- **Cost reporting** — every response includes token counts and estimated USD cost
- **Auto model discovery** — detects available models from your API key at startup
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
claude mcp add gemini-image -- node /path/to/gemini-image-mcp/dist/index.js
```

Claude Code will pick up `GEMINI_API_KEY` from your environment automatically.

#### Claude Code (manual `.mcp.json`)

Add to `.mcp.json` in your project root or `~/.claude/.mcp.json` for global access:

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

The `${GEMINI_API_KEY}` syntax reads the value from your shell environment — your actual key never gets written into config files.

#### Claude Code Plugin

```bash
/plugin install /path/to/gemini-image-mcp
```

This registers both the MCP server and a skill that teaches Claude when to generate images proactively. Your `GEMINI_API_KEY` environment variable is passed through automatically.

#### Claude Desktop

Edit `claude_desktop_config.json`:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

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

Restart Claude Desktop after saving.

#### Other MCP Clients

Any client that supports stdio transport works. Point it at `node /path/to/dist/index.js` and pass `GEMINI_API_KEY` in the environment.

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
