# Gemini Image MCP v0.2 — Design Spec

> Multi-turn editing, generation tracking, output organization, rate limiting, seed, and grounding.

## Design Principles

- Everything new is optional. The tool works exactly as it does today if you pass nothing extra.
- Lightweight. No database, no external dependencies. Flat files and in-memory state.
- Transparent. The user always sees what's happening — session totals, remaining budget, file paths.

---

## 1. Output Organization

### Filename Parameter

New optional `filename` parameter on `generate_image`. If provided, used as the base name instead of `gemini-{timestamp}-{hash}`.

**Versioning for duplicates:** If `hero-banner.png` already exists in the output dir:
- `hero-banner.png` (first)
- `hero-banner-v2.png` (second)
- `hero-banner-v3.png` (third)

Logic: check if file exists, scan for `{name}-v{n}` pattern, increment. Simple filesystem check, no index needed.

**If no filename provided:** falls back to the current `gemini-{timestamp}-{hash}` pattern. No breaking change.

### Subfolder Organization

New optional `subfolder` parameter. Appended to the output dir.

```
outputDir: ~/gemini-images
subfolder: landing-page

→ ~/gemini-images/landing-page/hero-banner.png
```

If not set, images go directly into the output dir as they do today.

---

## 2. Generation Manifest

A `generations.jsonl` file (one JSON object per line) in the output directory. Appended after every successful generation.

Each line:

```json
{"timestamp":"2026-04-01T10:23:44Z","filename":"hero-banner.png","path":"C:/Users/.../hero-banner.png","prompt":"Modern SaaS hero banner","model":"gemini-2.5-flash-image","aspectRatio":"16:9","resolution":"1K","usage":{"promptTokens":19,"outputTokens":1317,"imageTokens":1290,"thinkingTokens":0,"totalTokens":1336,"estimatedCost":"$0.0387"},"sessionId":null,"inputImages":0}
```

**Why JSONL not JSON:** append-only, no need to parse the whole file to add an entry, survives crashes mid-write, easy to grep/tail.

**Why not a database:** overkill. This is a log, not a query engine. If someone wants to analyse it, they can parse the JSONL.

---

## 3. Generation Tracking & Rate Limiting

### Tracking (always on)

Every response now includes a `session` object alongside the existing fields:

```json
{
  "imagePath": "...",
  "mimeType": "...",
  "model": "...",
  "usage": { ... },
  "session": {
    "generationsThisSession": 5,
    "totalCostThisSession": "$0.19",
    "generationsThisHour": 8,
    "limit": {
      "maxPerHour": 20,
      "maxCostPerHour": "$5.00",
      "remainingThisHour": 12
    }
  }
}
```

Session = lifetime of the server process (one MCP connection). Hourly tracking uses the manifest timestamps — count entries from the last 60 minutes.

### Rate Limiting (optional, configurable)

| Env Variable | Default | Description |
|-------------|---------|-------------|
| `MAX_REQUESTS_PER_HOUR` | `0` (unlimited) | Max generations per rolling hour |
| `MAX_COST_PER_HOUR` | `0` (unlimited) | Max estimated cost (USD) per rolling hour |

When a limit is hit, the tool returns an error:

```
Error: Rate limit reached — 20/20 generations used this hour. 
Resets in 23 minutes. To change: set MAX_REQUESTS_PER_HOUR env var.
```

The error message tells them how to change it. No guessing.

### First-Run Guidance

MCP servers can't prompt interactively at setup. Instead:

- **At startup with no limits set:** log an info message: "No rate limits configured. Set MAX_REQUESTS_PER_HOUR and/or MAX_COST_PER_HOUR to prevent runaway generation."
- **In the skill SKILL.md:** instruct Claude to mention rate limits to the user on first use if none are configured.
- **In the README:** clear setup section for limits with recommended defaults.

The user can change limits at any time by updating env vars and restarting the server.

---

## 4. Multi-Turn Editing Sessions

### How It Works

New optional `sessionId` parameter on `generate_image`. When provided, the server maintains conversation history for that session, preserving `thoughtSignature` fields across turns.

**Flow:**

1. First call: `prompt: "Draw a logo"` → returns result with `sessionId: "auto-generated-id"` in the response
2. Second call: `prompt: "Make it blue", sessionId: "that-id"` → server replays conversation history + new prompt
3. Third call: `prompt: "Add a shadow", sessionId: "that-id"` → continues building on the conversation

**Session storage:** in-memory Map keyed by sessionId. Each entry stores the conversation history (array of content parts including `thoughtSignature` fields).

**Cleanup:** sessions expire after 30 minutes of inactivity (configurable via `SESSION_TIMEOUT_MS`). Logged when expired.

**Why not persist to disk:** sessions are conversational context, not permanent data. They're only useful within a single working session. The generated images are the persistent output.

### Response Addition

When a session is active, the response includes:

```json
{
  "sessionId": "abc123",
  "sessionTurn": 3,
  ...
}
```

The model (Claude) can then pass `sessionId` back on the next call to continue the conversation.

---

## 5. Seed Parameter

New optional `seed` parameter (integer). Passed through to the Gemini API config for reproducible generation.

```json
{ "prompt": "A red apple", "seed": 42 }
```

Same seed + same prompt + same model = same image (within Gemini's guarantees). Useful for iterating on prompts while keeping other variables constant.

---

## 6. Google Search Grounding

New optional `useSearchGrounding` parameter (boolean). When true, enables Google Search grounding on the request. Available on gemini-3.1-flash-image-preview.

Lets the model reference real-world knowledge for more accurate images (e.g. "the Eiffel Tower" actually looks like the Eiffel Tower).

---

## Updated Tool Parameters

| Parameter | Required | Type | Default | Status |
|-----------|----------|------|---------|--------|
| `prompt` | Yes | string | — | Existing |
| `images` | No | string[] | — | Existing |
| `model` | No | string | `gemini-2.5-flash-image` | Existing |
| `aspectRatio` | No | string | `1:1` | Existing |
| `resolution` | No | string | `1K` | Existing |
| `outputDir` | No | string | env/default | Existing |
| `filename` | No | string | auto-generated | **New** |
| `subfolder` | No | string | — | **New** |
| `sessionId` | No | string | — | **New** |
| `seed` | No | integer | — | **New** |
| `useSearchGrounding` | No | boolean | false | **New** |

Five new optional parameters. The tool description grows by ~100 tokens. Still well under 300 tokens total — a fraction of what RLabs costs.

## Updated Env Variables

| Variable | Default | Description | Status |
|----------|---------|-------------|--------|
| `GEMINI_API_KEY` | — | API key | Existing |
| `OUTPUT_DIR` | `~/gemini-images` | Default output dir | Existing |
| `DEFAULT_MODEL` | `gemini-2.5-flash-image` | Default model | Existing |
| `LOG_LEVEL` | `info` | Log level | Existing |
| `REQUEST_TIMEOUT_MS` | `60000` | API timeout | Existing |
| `MAX_REQUESTS_PER_HOUR` | `0` (unlimited) | Rate limit: requests | **New** |
| `MAX_COST_PER_HOUR` | `0` (unlimited) | Rate limit: cost | **New** |
| `SESSION_TIMEOUT_MS` | `1800000` (30min) | Session expiry | **New** |

## Implementation Order

1. **Filename + versioning + subfolder** — small, self-contained, immediately useful
2. **Generation manifest (JSONL)** — needed before tracking/limits
3. **Session tracking + rate limiting** — reads from manifest
4. **Multi-turn editing sessions** — most complex, independent of above
5. **Seed parameter** — trivial pass-through
6. **Google Search grounding** — trivial pass-through

Steps 1-3 build on each other. Steps 4-6 are independent and can be done in any order.
