# NOVA — Describe it. Build it.

A prompt-to-iframe generator. Type what you want to build, an LLM generates a complete single-file HTML app, you see it in a sandboxed preview, and you can download it.

## Quick start

```bash
# 1. Install dependencies
bun install

# 2. Copy env file
cp .env.example .env

# 3. Start the dev server
bun run dev
```

Open `http://localhost:3000`.

## What it does

1. Type a mission (e.g., "Build a snake game with score and game-over")
2. Click Build (or press ⌘+Enter / Ctrl+Enter)
3. Wait 20-60 seconds — the LLM writes a complete HTML app
4. See it live in a sandboxed iframe preview
5. Download the HTML file, or rebuild with a fresh generation

## Architecture

```
src/
  app/
    api/build/route.ts   — POST handler: validate → LLM → return HTML with CSP injected
    layout.tsx           — Root layout, dark theme, ErrorBoundary, Toaster
    page.tsx             — Single-page UI: textarea + preview + history
  components/
    ErrorBoundary.tsx    — Catches render errors, shows fallback
    ui/                  — shadcn/ui components (pre-installed)
  lib/
    llm.ts               — LLM wrapper, mission validation, CSP injection, HTML sanity check
    utils.ts             — cn() helper
tests/
  llm.test.ts            — Unit tests for validateMission, stripCodeFences, looksLikeHtml
  csp.test.ts            — Unit tests for injectCsp
```

## Commands

| Command | Description |
|---|---|
| `bun run dev` | Start dev server on port 3000 |
| `bun run lint` | Run ESLint |
| `bun run test` | Run unit tests |
| `npx tsc --noEmit` | Type check |

## Security

- **Sandboxed iframe**: `sandbox="allow-scripts"` — no `allow-same-origin`, so the iframe gets an opaque origin and cannot access parent DOM, cookies, or localStorage.
- **CSP injection**: A `Content-Security-Policy` meta tag is injected into the LLM-generated HTML before it reaches the iframe. This blocks external network requests (`connect-src 'none'`), external scripts, external stylesheets, etc.
- **Rate limiting**: 10 builds per hour per IP (in-memory, resets on server restart).
- **Mission validation**: Length (3-500 chars), no control characters.
- **Error sanitization**: LLM SDK errors are never leaked to the client — human-friendly messages only.
- **Abort support**: Client disconnects abort the server-side LLM call via `request.signal`.

## Limitations

- No database — history is stored in localStorage (last 10 builds, per-browser).
- No authentication — single-user sandbox.
- No streaming — the build is synchronous (one fetch, one response).
- No multi-file output — the LLM returns one complete HTML file.
- In-memory rate limiting resets on server restart.

## Tech stack

- Next.js 16 (App Router)
- TypeScript 5
- Tailwind CSS 4
- shadcn/ui (New York style)
- z-ai-web-dev-sdk (LLM provider)
- bun test (unit tests)
