# Contributing

Thanks for your interest in contributing.

## Before you start

Open an issue first. Describe the bug or feature so we can discuss it before you write any code. This avoids wasted effort on both sides.

## Development setup

```bash
bun install
bun run build     # TypeScript -> dist/
bun run dev       # Run directly with Bun
```

You'll need a `GEMINI_API_KEY` environment variable set to test image generation. See the README for setup instructions.

## Pull requests

- One thing per PR — don't bundle unrelated changes
- Make sure `bun run build` succeeds with no errors
- Test your changes manually against the actual Gemini API
- Keep the scope tight — if you spot something else that needs fixing, open a separate issue
