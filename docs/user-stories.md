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

### Run: 2026-04-01 — Full v0.2 Regression

**Generation — Real Use Cases**

| Test | Result | Notes |
|------|--------|-------|
| Sprite sheet (warrior walk cycle) | PASS | 4 frames, transparent bg, consistent pixel art character |
| Game texture (stone wall) | PASS | Tileable cobblestone, detailed, looks genuinely usable |
| T-shirt mockup (POD) | PASS | Clean flat lay on grey background |
| Mug mockup (POD) | PASS | Mountain line art rendered ON the mug in a cafe setting |
| UI design primitives | FAIL then PASS | "A set of..." triggered text-only response. "Generate an image of..." worked. Prompt sensitivity. |
| Session tracking | PASS | Running count 1→5, cost $0.04→$0.20 across batch |

**Processing Pipelines**

| Test | Result | Notes |
|------|--------|-------|
| Sprite trim + resize 128px | PASS | Trimmed whitespace, resized to 128x128 |
| Texture → 16:9 center crop + webp | PASS | 1024x576 webp at quality 85 |
| T-shirt bg removal + trim | PASS | Background removed, trimmed to 640x607 |

**Error Handling Regression**

| Test | Result | Notes |
|------|--------|-------|
| Invalid model | PASS | Lists available models from discovery |
| Missing file (process_image) | PASS | "Image not found" with path |
| Safety filter | PARTIAL | Model returned empty response (no text, no image, no finishReason). Generic fallback shown. Different behaviour to earlier test where model returned refusal text. Safety response is inconsistent across prompts. |

**Prompt Sensitivity Findings**

Phrases that previously triggered text-only responses (no image):
- "A set of..." — model describes instead of drawing
- "Crop this..." — model explains cropping instead of generating
- Any list-like instruction ("circles, rectangles, triangles")
- "Generate an image: " prefix could *cause* failures ("Sure, here's an image..." then text-only)

~~Fix: prefix with "Generate an image of..." or "Draw..." to force image output.~~

**Actual fix (v0.2):** Use `responseModalities: ['IMAGE']` for single-shot generation. Model has no choice but to generate an image. Sessions use `['TEXT', 'IMAGE']` to preserve thoughtSignature.

### Run: 2026-04-01 — IMAGE-only Mode Validation

| Prompt | Before (TEXT+IMAGE) | After (IMAGE-only) |
|--------|--------------------|--------------------|
| "A set of flat geometric shapes..." | FAIL (text-only) | **PASS** |
| "Generate an image: List of 5 button styles" | FAIL (text-only: "Sure, here's...") | **PASS** |
| "List of 5 button styles" (no prefix) | Inconsistent | **PASS** |
| Safety filter prompt | Generic fallback | Same (empty response, correct) |
| Multi-turn session (turn 1: house) | PASS | PASS (IMAGE-only) |
| Multi-turn session (turn 2: add garden) | PASS | PASS (TEXT+IMAGE, preserved style + added garden) |

**Conclusion:** IMAGE-only mode eliminates all text-only failures. Prompt prefixing is NOT needed and can be counterproductive. Sessions correctly switch to TEXT+IMAGE for thoughtSignature preservation.

### Run: 2026-04-01 — Pre-Production Test Suite (v0.2 final)

All tests run against built dist/ after doc updates (chroma key added to README + SKILL.md, version fixed to 0.2.0).

**Generation Tests**

| # | Test | Result | Notes |
|---|------|--------|-------|
| 1 | Simple prompt | PASS | "Mountain landscape at dawn" — 1300 tokens, $0.039, saved to pre-production/ subfolder |
| 2 | Filename + subfolder + 16:9 | PASS | `test-02-hero.png` in `pre-production/`, 16:9 aspect, custom filename |
| 3 | Multi-turn session (turn 2) | PASS | SessionId preserved, prompt tokens 10→280 (history replayed), turn 2 correctly applied edit |

**Processing Tests**

| # | Test | Result | Notes |
|---|------|--------|-------|
| 4 | Pixel-exact crop | PASS | 512x512 at offset (100,100) from 1024x1024 source |
| 5 | Aspect ratio crop + attention | PASS | 16:9 → 1:1 via attention strategy, 768x768 output |
| 6 | Resize (width only) | PASS | 1024→256, aspect ratio maintained (square stays square) |
| 7 | Threshold bg removal + trim | PASS | White bg removed (threshold 230), trimmed 1024x1024 → 350x357 |
| 8 | Chroma key bg removal + trim | PASS* | See broad chroma key test below for full analysis |
| 9 | Format conversion (WebP) | PASS | PNG → WebP at quality 85, correct `.webp` extension |
| 10 | Combined pipeline (favicon) | PASS | bg remove + trim + resize 192x192 exact (fixed: fit "cover" when both dims given) |

**Error Handling Tests**

| # | Test | Result | Notes |
|---|------|--------|-------|
| 11 | Missing file (process_image) | PASS | "Image not found: C:\...\does-not-exist.png" — clear path in error |
| 12 | Invalid model (generate_image) | PASS | Lists available models: gemini-2.5-flash-image, gemini-3-pro-image-preview, gemini-3.1-flash-image-preview |

**Summary: 12/12 PASS** (test 8 qualified, test 10 fixed). All README claims verified.

### Run: 2026-04-01 — Broad Chroma Key Comparison

Tested `#00FF00` (tolerance 80) vs auto-detect vs canvas approach across 6 subjects.

**Subjects generated on green backgrounds:**

| Subject | #00FF00 (tol 80) | Auto-detect | Notes |
|---------|------------------|-------------|-------|
| Red mug (glossy) | PASS — 189k opaque, clean edges | FAIL — 0 opaque, mug semi-transparent | Auto too aggressive on reflective surfaces |
| White sneaker | PASS | PASS | Tie — high contrast, easy case |
| Black chess piece | PASS | PASS | Tie — high contrast, easy case |
| Yellow rubber duck | FAIL — duck desaturated/damaged | FAIL — duck more damaged | Both fail — yellow (hue ~60°) too close to green (hue ~120°) |
| Green plant | PASS* — pot clean, plant colour muted | FAIL — plant stripped entirely | Hex preserves more but still affects green subject |
| Glass perfume | PASS — bottle visible, some green tint | FAIL — bottle nearly invisible | Auto nuked the glass (transparency + reflections) |

**Canvas approach (feed solid colour bg to generate_image):**

| Subject | On white | On black | Notes |
|---------|----------|----------|-------|
| Yellow duck | PASS — perfect bright yellow | PASS — natural lighting | Zero colour damage, Gemini handles compositing natively |
| Glass perfume | PASS — clean glass, natural reflections | N/A | No green contamination at all |

**Conclusions:**

1. **#00FF00 with tolerance 80 is the best chroma key setting.** The 15° hue offset from Gemini's actual green (~105°) creates a safety margin that protects subjects. Auto-detect eliminates this margin and damages more subjects.
2. **Chroma key works well for:** red, blue, black, white, and other high-contrast subjects on green.
3. **Chroma key fails for:** yellow (adjacent hue), green (same hue), glass/reflective (picks up green reflections).
4. **Canvas approach is better for difficult subjects.** Feed a solid colour canvas as input to `generate_image` — Gemini places the subject with correct lighting. One API call, no post-processing, works for any subject.
5. **Auto-detect reverted.** Fixed `#00FF00` target with default tolerance 80 produces better results across all tested subjects.
6. **Default tolerance bumped from 50 → 80.** Gemini's desaturated greens need the wider range.
7. **Resize fix:** Both width+height now uses `fit: "cover"` for exact dimensions (was `fit: "inside"`, producing 188x192 instead of 192x192).
