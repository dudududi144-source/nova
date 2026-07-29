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

The app runs on port 3000. Use the **Preview Panel** in the Z.ai interface to view it (do not navigate to `http://localhost:3000` directly — it's internal). Click **Open in New Tab** above the Preview Panel if you want a separate browser tab.

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
    layout.tsx           — Root layout, dark theme, ErrorBoundary, Toaster, viewport
    page.tsx             — Single-page UI: textarea + preview + history
    globals.css          — Tailwind + prefers-reduced-motion
  components/
    ErrorBoundary.tsx    — Catches render errors, shows fallback with error ID
    ui/                  — shadcn/ui components (pre-installed)
  lib/
    llm.ts               — LLM wrapper, mission validation, CSP injection, HTML sanity check
    rate-limit.ts        — RateLimiter class (per-IP sliding window, in-memory)
    logger.ts            — Structured JSON logger with LOG_LEVEL filtering
    utils.ts             — cn() helper
tests/
  llm.test.ts            — validateMission, stripCodeFences, looksLikeHtml
  csp.test.ts            — injectCsp
  rate-limit.test.ts     — RateLimiter
  rate-limit-concurrency.test.ts — RateLimiter edge cases
  build-route.test.ts    — POST /api/build with mocked llmChat
  build-id.test.ts       — newBuildId uniqueness
  edge-cases.test.ts     — fence/HTML edge cases
  edge-cases-2.test.ts   — more edge cases
  cycle-8.test.ts        — injectCsp case-insensitivity, logger, filename
  cycle-9.test.ts        — 4+ backticks, logger levels, defensive CSP
  cycle-10.test.ts       — non-html language fences, extended control chars
```

## Commands

| Command | Description |
|---|---|
| `bun run dev` | Start dev server on port 3000 |
| `bun run lint` | Run ESLint |
| `bun run test` | Run unit tests (163 tests) |
| `npx tsc --noEmit` | Type check |

## Security

- **Sandboxed iframe**: `sandbox="allow-scripts"` — no `allow-same-origin`, so the iframe gets an opaque origin and cannot access parent DOM, cookies, or localStorage.
- **CSP injection**: A `Content-Security-Policy` meta tag is injected into the LLM-generated HTML before it reaches the iframe. This blocks external network requests (`connect-src 'none'`), external scripts, external stylesheets, etc.
- **Rate limiting**: 10 builds/hour in production, 100/hour in development (per IP, in-memory, resets on server restart).
- **Request body size limit**: 10KB max (413 response if exceeded).
- **Mission validation**: Length (3-500 chars), no control characters (including DEL and extended control chars).
- **Error sanitization**: LLM SDK errors are never leaked to the client — human-friendly messages only.
- **Abort support**: Client disconnects abort the server-side LLM call via `request.signal`.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `file:./db/custom.db` | SQLite path (unused by NOVA v1 core, required by scaffold) |
| `LOG_LEVEL` | `info` (dev), `warn` (prod) | Log level: `debug`, `info`, `warn`, `error` |
| `NODE_ENV` | — | Set by Next.js. Affects rate limit and log level defaults |

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
