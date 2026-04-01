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

### When to use which tool
- **process_image** — crop, resize, format convert, threshold bg removal, trim. Free and instant.
- **generate_image with images** — AI-powered editing: style changes, complex background removal, content-aware modifications. Costs ~$0.04 per operation.

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
