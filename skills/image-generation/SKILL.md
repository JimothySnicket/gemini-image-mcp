---
name: image-generation
description: Generate and edit images using Google Gemini via the gemini-image-mcp server
---

# Image Generation Skill

You have access to Google Gemini image generation via the `generate_image` MCP tool.

## When to Use

Generate images when the user:
- Asks for an image, illustration, or visual asset
- Needs a hero image, placeholder, icon, or background for a project
- Asks to edit, modify, or iterate on an existing image
- Mentions creating visual content of any kind

## How to Use

Call the `generate_image` tool. The behaviour depends on the parameters:

### Text-to-Image (no input images)
```json
{
  "prompt": "A modern dashboard UI with dark theme and blue accent colours",
  "aspectRatio": "16:9",
  "resolution": "2K",
  "filename": "dashboard-hero",
  "subfolder": "landing-page"
}
```

### Image Editing (with input images)
```json
{
  "prompt": "Change the background to a sunset over water",
  "images": ["./src/assets/hero.png"],
  "aspectRatio": "16:9"
}
```

### Multi-Turn Refinement
The tool returns a `sessionId` with every response. Pass it back to continue editing:
```json
{
  "prompt": "Make the colours warmer and add more contrast",
  "sessionId": "session-1711929600000-a1b2c3"
}
```
This preserves the conversation history so the model remembers what it generated.

## Output Organization

- Use `filename` to give images meaningful names (e.g. `hero-banner` instead of `gemini-1711929600000-a1b2c3`)
- Use `subfolder` to group related assets (e.g. `landing-page`, `blog-posts`)
- Duplicate filenames are auto-versioned: `hero.png`, `hero-v2.png`, `hero-v3.png`
- When generating assets for a project, save them directly to the project's asset directory using `outputDir`

## Image Processing (process_image)

Use `process_image` for local, free operations that don't need AI:

### Common Pipelines

**Subject on a specific background (canvas approach — recommended):**
Create a solid colour canvas with `process_image`, then feed it to `generate_image` as input. Gemini places the subject with correct lighting and reflections — no chroma key needed.
```json
// Step 1: generate_image with a canvas image as input
{
  "prompt": "Place a yellow rubber duck on this background. Product photography, studio lighting, centered.",
  "images": ["./canvas-white.png"],
  "filename": "duck-on-white"
}
```
This is better than chroma key for yellow, green, or glass/reflective subjects.

**Transparent asset from green screen (two-step pipeline):**
Generate on green, then chroma key locally for free. Best for high-contrast subjects (dark/red/blue on green):
```json
// Step 1: generate_image
{"prompt": "A product photo on a bright green background", "filename": "product-green"}

// Step 2: process_image
{
  "imagePath": "./product-green.png",
  "removeBackground": {"color": "#00FF00"},
  "trim": true,
  "filename": "product-transparent"
}
```
Always use `#00FF00` — it works better than trying to match Gemini's actual green shade.

**Favicon/icon from a logo:**
```json
{
  "imagePath": "./logo.png",
  "removeBackground": {"threshold": 230},
  "trim": true,
  "resize": {"width": 192, "height": 192},
  "filename": "favicon-192"
}
```

**Crop to aspect ratio:**
```json
{
  "imagePath": "./photo.png",
  "crop": {"aspectRatio": "16:9", "strategy": "attention"},
  "filename": "hero-banner"
}
```
Strategies: `center` (default, crops from center), `attention` (shifts crop toward the most visually interesting region), `entropy` (shifts toward the most detailed region). These control the focal point — not content detection.

**Convert for web:**
```json
{
  "imagePath": "./image.png",
  "format": "webp",
  "quality": 85
}
```

### Limitations of process_image
- **Threshold bg removal only works on light backgrounds** — it makes near-white pixels transparent. If the subject is also white/light (e.g. white t-shirt on white background), it will damage the subject. For same-colour subjects, use chroma key (`color` param) or `generate_image` with "remove the background".
- **Chroma key struggles with yellow, green, or glass subjects** — yellow is too close to green in hue space and gets partially removed. Green subjects (plants, etc.) overlap with the background. Glass/reflective surfaces pick up green reflections that can't be separated. For these subjects, use the canvas approach instead (feed a solid background to `generate_image`).
- **Use #00FF00 for chroma key, not the actual background colour** — Gemini generates desaturated greens (~hue 105°), not pure green (hue 120°). Targeting #00FF00 creates a natural safety margin that protects the subject. Default tolerance is 80.
- **Trim removes all border whitespace** — don't use trim on sprite sheets or images where surrounding space is intentional. Trim + small resize = blurry results.
- **Resize respects the input dimensions** — if you trim a 1024px image down to 200px of content, then resize to 128px, that's fine. But trimming a 1024px-wide sprite sheet with 4 characters and resizing to 128px means 32px per character.

### When to use which tool
- **process_image** — crop, resize, format convert, threshold bg removal (white backgrounds), chroma key bg removal (green screen), trim. Free and instant.
- **Canvas approach** (generate_image with a solid colour input image) — when you want a subject on a specific background, especially for yellow, green, or glass subjects. One API call, correct lighting.
- **Green screen + process_image** — when you need a transparent PNG for compositing. Best for high-contrast subjects (red, blue, black, white on green). Two calls, processing is free.
- **generate_image with images** — AI-powered editing: style changes, complex background removal (any background, any subject), content-aware modifications. Costs ~$0.04 per operation.

## Prompt Tips

Structure prompts as: **[Style] [Subject] [Composition] [Context/Atmosphere]**

- Be specific about visual style: "flat illustration", "photorealistic", "watercolour"
- Include composition details: "centered", "rule of thirds", "close-up"
- Mention lighting and mood: "warm golden hour light", "moody and dramatic"
- For editing: use "recreate" or "reimagine" rather than "crop" or "resize" — the latter may produce text-only responses

## Models

- `gemini-2.5-flash-image` (default) — fast (~6s), cheap (~$0.04/image)
- `gemini-3-pro-image-preview` — best quality, text rendering, up to 14 reference images, 4K. Slower (~16s), pricier (~$0.15/image)
- `gemini-3.1-flash-image-preview` — speed + quality balance. Supports Google Search grounding.

## Important

- Every response includes token usage, estimated cost, and session totals — mention the cost to the user
- If rate limits are configured, the response shows remaining budget. Respect these limits.
- For iterative refinement, prefer `sessionId` over passing the output image back as input — sessions preserve conversation context and produce better edits
- For web assets, suggest appropriate aspect ratios (16:9 for hero images, 1:1 for avatars, 9:16 for mobile)
- Use `seed` when the user wants to iterate on a prompt while keeping the visual style consistent
