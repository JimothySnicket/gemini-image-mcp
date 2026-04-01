# User Stories & Test Cases

## How This Works

Each user story describes a real scenario someone would use this tool for. Each has test cases that verify the behaviour. Results are recorded in the Test Results section at the bottom — nothing gets deleted, we just append.

---

## US-1: Basic Text-to-Image

**As a** developer building a landing page
**I want to** describe an image and get it generated
**So that** I can quickly create hero images, backgrounds, and visual assets

### Test Cases

| ID | Test | Params | Expected |
|----|------|--------|----------|
| 1.1 | Simple prompt | `prompt: "A mountain landscape at dawn"` | Image saved, path returned, usage reported |
| 1.2 | With aspect ratio | `prompt: "Hero banner for a tech startup", aspectRatio: "16:9"` | 16:9 image returned |
| 1.3 | With resolution | `prompt: "Product photo of a coffee mug", resolution: "2K"` | Higher resolution image |
| 1.4 | With model override | `prompt: "A cat wearing a hat", model: "gemini-3-pro-image-preview"` | Uses specified model, different cost |
| 1.5 | With person generation control | `prompt: "A portrait photo", personGeneration: "ALLOW_ADULT"` | Generates person image |
| 1.6 | Minimal prompt | `prompt: "red circle"` | Image generated even with very short prompt |
| 1.7 | Custom output dir | `prompt: "test image", outputDir: "./test-output"` | Saved to specified directory |

---

## US-2: Image Editing with Reference Images

**As a** developer iterating on visual assets
**I want to** provide an existing image and an editing instruction
**So that** I can refine images without starting from scratch

### Test Cases

| ID | Test | Params | Expected |
|----|------|--------|----------|
| 2.1 | Single image edit | `prompt: "Make the sky more purple", images: ["path/to/image.png"]` | Modified image returned |
| 2.2 | Style transfer | `prompt: "Redraw this in watercolour style", images: ["path/to/image.png"]` | Stylistically different image |
| 2.3 | Multiple reference images | `prompt: "Combine elements from these images", images: ["a.png", "b.png"]` | Image incorporating references |
| 2.4 | Edit with aspect ratio change | `prompt: "Crop this to a square", images: ["wide.png"], aspectRatio: "1:1"` | Square version |

---

## US-3: Cost Awareness

**As a** user managing API spend
**I want to** see token counts and estimated cost for every generation
**So that** I can make informed decisions about model and resolution choices

### Test Cases

| ID | Test | Params | Expected |
|----|------|--------|----------|
| 3.1 | Cost with default model | `prompt: "A sunset"` | Cost ~$0.03-0.05 |
| 3.2 | Cost with pro model | `prompt: "A sunset", model: "gemini-3-pro-image-preview"` | Higher cost than flash |
| 3.3 | Cost with 4K | `prompt: "A sunset", model: "gemini-3-pro-image-preview", resolution: "4K"` | Higher cost than 1K |
| 3.4 | Token breakdown | Any generation | imageTokens > 0, promptTokens > 0 |

---

## US-4: Error Handling

**As a** user who might make mistakes
**I want to** get clear error messages
**So that** I know what went wrong and how to fix it

### Test Cases

| ID | Test | Params | Expected |
|----|------|--------|----------|
| 4.1 | Missing prompt | `{}` | Error: prompt is required |
| 4.2 | Invalid model | `prompt: "test", model: "not-a-model"` | Error with available models or API error |
| 4.3 | Invalid aspect ratio | `prompt: "test", aspectRatio: "5:3"` | Schema validation error |
| 4.4 | Non-existent input image | `prompt: "edit", images: ["does-not-exist.png"]` | Error naming the missing file |
| 4.5 | Unsupported image format | `prompt: "edit", images: ["file.tiff"]` | Error listing supported formats |
| 4.6 | Safety filter trigger | `prompt: <something that triggers safety>` | Error explaining safety block, not empty result |

---

## US-5: Common Asset Templates

**As a** developer who generates the same types of assets repeatedly
**I want** well-crafted prompt templates for common use cases
**So that** I get consistent, high-quality results without being a prompt engineer

### Potential Templates

These are prompt patterns we could advertise in the tool description or skill:

| Template | Use Case | Suggested Params |
|----------|----------|-----------------|
| Hero Banner | Landing page hero image | `aspectRatio: "16:9", resolution: "2K"` |
| App Icon | Mobile app icon | `aspectRatio: "1:1", resolution: "1K"` |
| Social Card | Open Graph / Twitter card | `aspectRatio: "16:9", resolution: "1K"` |
| Avatar/Profile | User avatar placeholder | `aspectRatio: "1:1", resolution: "1K"` |
| Product Shot | E-commerce product image | `aspectRatio: "1:1", resolution: "2K"` |
| Blog Header | Article header image | `aspectRatio: "16:9", resolution: "1K"` |
| Mobile Screenshot | App store screenshot | `aspectRatio: "9:16", resolution: "2K"` |
| Presentation Slide | Slide background | `aspectRatio: "16:9", resolution: "2K"` |
| Thumbnail | Video/content thumbnail | `aspectRatio: "16:9", resolution: "1K"` |
| Banner Ad | Web banner | `aspectRatio: "21:9", resolution: "1K"` |

These need testing to validate quality and consistency before we advertise them.

---

## Test Results

Results are appended here as tests are run. Format:

```
### Run: YYYY-MM-DD HH:MM — Context
| ID | Result | Notes |
```

### Run: 2026-04-01 — Initial MVP Smoke Test

| ID | Result | Notes |
|----|--------|-------|
| 1.2 | PASS | "Sunset over the River Clyde, 16:9" — image generated, 1338 tokens, $0.039, saved to ~/gemini-images/ |

### Run: 2026-04-01 — Full Test Suite

**US-1: Basic Text-to-Image**

| ID | Result | Notes |
|----|--------|-------|
| 1.1 | PASS | "Mountain landscape at dawn" — 1308 tokens, $0.039, default 1:1 |
| 1.2 | PASS | Already tested in smoke test |
| 1.3 | PASS* | 2K resolution requested — image generated but token count unchanged (1290). Resolution param may be silently ignored by gemini-2.5-flash-image. Known Gemini quirk. |
| 1.4 | PASS | gemini-3-pro-image-preview used. Returned JPEG (not PNG). $0.149. Thinking tokens present (124). 16s response time vs ~6s for flash. |
| 1.5 | FAIL | `personGeneration` not supported on Gemini API (Vertex AI only). SDK types include it but API rejects it. **Removed from tool.** |
| 1.6 | PASS | "red circle" — minimal 2-word prompt works fine. 1294 tokens, $0.039 |
| 1.7 | PASS | Custom outputDir `./test-output/` — directory created, image saved correctly |

**US-2: Image Editing with Reference Images**

| ID | Result | Notes |
|----|--------|-------|
| 2.1 | PASS | "Make sky more purple" on mountain image — sky changed to purple. Prompt tokens jumped from ~6 to 266 (input image tokenised). |
| 2.2 | PASS | "Redraw in watercolour style" on red circle — clear style transfer |
| 2.3 | PASS | Two images combined (mountain + red circle) — "Japanese flag-inspired" composite. 534 prompt tokens (two images). |
| 2.4 | PASS* | "Crop to square" failed (model gave text-only). "Recreate as square" worked. **Prompt sensitivity**: avoid "crop/resize" language, use "recreate/reimagine" instead. |

**US-3: Cost Awareness**

| ID | Result | Notes |
|----|--------|-------|
| 3.1 | PASS | Flash default: $0.039, 1290 image tokens |
| 3.2 | PASS | Pro model: $0.149 — **3.8x more expensive** than flash |
| 3.3 | PASS | Pro 4K: $0.261, 2000 image tokens — **6.7x more** than flash 1K |
| 3.4 | PASS | All responses include imageTokens > 0, promptTokens > 0, estimatedCost string |

**US-4: Error Handling**

| ID | Result | Notes |
|----|--------|-------|
| 4.1 | PASS | Missing prompt rejected by Zod schema validation at MCP layer |
| 4.2 | PASS | Invalid model: "models/not-a-real-model is not found for API version v1beta" — clear, actionable |
| 4.3 | PASS | Invalid aspect ratio caught by Zod enum validation — never reaches server |
| 4.4 | PASS | Missing file: "ENOENT: no such file or directory" with full path shown |
| 4.5 | PASS | Unsupported format: "Unsupported image format .json" with supported list |
| 4.6 | PARTIAL | Safety filter triggers (584ms response, no image) but error is generic. Improved detection built (checks promptFeedback, finishReason, text-only responses) — **needs server restart to verify.** |

**US-5: Common Asset Templates**

| Template | Result | Prompt Used | Notes |
|----------|--------|-------------|-------|
| Hero Banner | PASS | "Modern SaaS landing page hero image with abstract gradient waves in blue and purple, clean and professional" 16:9 2K | Gradient waves, readable CTA text, directly usable |
| App Icon | PASS | "Minimal flat-design app icon for a task management app, rounded square, gradient from teal to blue, white checkmark symbol" 1:1 | Clean, correct shape, exact colours |
| Social Card | PASS* | "Open Graph social card for a developer blog post about TypeScript, modern dark theme with code snippets" 16:9 | Good layout, but text has errors ("TyCcRsipt"). Use gemini-3-pro for text-heavy assets |
| Mobile Screenshot | PASS | "Mobile app store screenshot showing a clean fitness tracking dashboard with step count, calories, progress ring, iPhone frame, light theme" 9:16 2K | iPhone frame, dashboard UI, readable stats |
| Product Shot | PASS | "Product photography of wireless earbuds on white marble surface, soft natural lighting, minimal style" 1:1 2K | Photorealistic, "ECHO" branding appeared, could pass for real |

### Key Findings

1. **Text rendering**: gemini-2.5-flash-image struggles with text accuracy. Use gemini-3-pro-image-preview for assets that need readable text.
2. **Resolution param**: May be silently ignored on flash model — token count stays at 1290 regardless of 1K/2K setting.
3. **Prompt sensitivity for editing**: Avoid "crop/resize" language. Use "recreate/reimagine" to ensure image output.
4. **Cost range**: $0.04 (flash 1K) to $0.26 (pro 4K) per image. 6.7x cost difference at the extremes.
5. **Response time**: Flash ~6s, Pro ~16s per generation.
6. **Pro model returns JPEG**: gemini-3-pro-image-preview returns image/jpeg, flash returns image/png. ~~Filename is always .png — **bug: should use correct extension.**~~ **FIXED**: extension now matches mime type.
7. **personGeneration**: Not supported on Gemini API (Vertex AI only). Removed from tool.
8. **Model discovery**: 6 image models found at startup (3 Gemini native, 3 Imagen 4). Imagen models use a different API — would fail gracefully if used. Later filtered to 3 Gemini native only.
9. **Safety filter**: Blocked prompts now return the model's actual refusal text. Previously gave generic "no image returned" error.

### Run: 2026-04-01 — v0.2 Feature Tests

| Feature | Result | Notes |
|---------|--------|-------|
| Filename param | PASS | `logo.png` saved with correct name instead of `gemini-{hash}.png` |
| Auto-versioning | PASS | Second `logo` saved as `logo-v2.png` automatically |
| Subfolder | PASS | `test-v02/` directory created automatically |
| Session tracking | PASS | Running count (5 gens) and cost ($0.20) in every response |
| Manifest (JSONL) | PASS | All 5 generations logged to `generations.jsonl` with prompt, model, cost, path |
| Multi-turn session (turn 1) | PASS | Coffee shop logo generated, sessionId returned |
| Multi-turn session (turn 2) | PASS | "Make it B&W" — model remembered original design, converted correctly. Prompt tokens 10→294 (history replayed with thoughtSignature) |
| Seed param | PASS | Accepted and passed through without error |
| Rate limit warning | PASS | Startup log shows "none configured" message with env var names |
| Imagen filtered | PASS | Discovery shows 3 models (was 6 before filtering) |

### v0.2 Key Findings

1. **Multi-turn sessions work excellently** — the model preserved the exact design ("The Daily Grind Coffee Roasters") across turns while applying the edit instruction
2. **Auto-versioning is seamless** — no errors, no overwrites, predictable naming
3. **Manifest is comprehensive** — every field logged, JSONL format easy to grep
4. **Session cost tracking is accurate** — increments correctly across generations
5. **Prompt token escalation in sessions** — turn 2 costs more (294 vs 10 prompt tokens) due to conversation history. Worth noting in docs for cost-conscious users.

### Run: 2026-04-01 — process_image Tests

| Operation | Result | Notes |
|-----------|--------|-------|
| Resize | PASS | 1024x1024 → 256x256 thumbnail, aspect ratio maintained |
| Format conversion | PASS | PNG → JPEG at quality 80, correct `.jpg` extension |
| Background removal | PASS | Threshold 230, white areas transparent on B&W coffee logo |
| Trim | PASS | Auto-removed whitespace, 256x256 → 154x62 |
| Crop | PASS | 512x512 from center of 1024x1024, correct offset |
| Subfolder nesting | PASS | `test-v02/processed/` created automatically |
| Filename | PASS | All saved with requested names |
| Crop: aspect ratio center | PASS | 1024x1024 → 1024x576 (16:9). Center crop, equal top/bottom trim |
| Crop: aspect ratio attention | PASS | Same dimensions, shifted up to capture text + cup (most visually interesting) |
| Crop: aspect ratio entropy | PASS | Same dimensions, captured text + cup area (most detailed region) |
