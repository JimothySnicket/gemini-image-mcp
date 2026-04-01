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
  "resolution": "2K"
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

## Prompt Tips

Structure prompts as: **[Style] [Subject] [Composition] [Context/Atmosphere]**

- Be specific about visual style: "flat illustration", "photorealistic", "watercolour"
- Include composition details: "centered", "rule of thirds", "close-up"
- Mention lighting and mood: "warm golden hour light", "moody and dramatic"

## Models

- `gemini-2.5-flash-image` (default) — fast, budget-friendly
- `gemini-3-pro-image-preview` — best quality, text rendering, up to 14 reference images, 4K output
- `gemini-3.1-flash-image-preview` — speed + quality balance

## Output

The tool returns the saved file path, model used, token counts, and estimated cost. Images are saved as PNG to the configured output directory (default: `~/gemini-images`).

## Important

- Every response includes token usage and estimated cost — mention this to the user
- If the user wants to iterate on an image, pass the previous output path in the `images` array
- For web assets, suggest appropriate aspect ratios (16:9 for hero images, 1:1 for avatars, etc.)
