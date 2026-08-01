# NOVA — Prompt-to-App Generator

> Describe it. Build it. NOVA generates a working, single-file HTML app from a natural language prompt — with live token streaming, runtime error detection, auto-fix loop, and cross-build memory.

## Features

### Core
- **Prompt-to-HTML** — Type what you want, get a complete working HTML app
- **Live token streaming** — Watch the code appear character by character
- **Two-stage pipeline** — Architect (plan) → Coder (generate) with real-time progress
- **Sandboxed preview** — Strict CSP, null-origin iframe (no access to parent storage)
- **Chat refine** — Ask NOVA to change anything ("make it blue", "add dark mode")

### Quality Pipeline
- **Static analysis** — Catches 10+ bug types before the user sees them (missing IDs, undefined functions, infinite loops, uncleared intervals, JSON.parse without try/catch, missing await, empty listeners)
- **Interaction probe** — Clicks buttons, types in inputs, checks DOM state changes
- **Auto-fix loop** — Automatically fixes runtime errors (up to 3 iterations)
- **Quality scoring** — 0-100 score based on HTML structure, functions, CSS, listeners

### Resilience
- **SSE recovery** — If the stream drops, polls the server for the result
- **Circuit breaker** — Disables failing models after consecutive failures
- **Graceful degradation** — Architect failure doesn't block the build (proceeds without plan)
- **Client-side timeout** — Detects half-open connections (90s)

### Memory
- **Cross-build memory** — IndexedDB cache for instant rebuild (0ms vs 30-60s)
- **Similar builds** — Shows "⚡ Similar builds from memory" as you type
- **History** — Last 10 builds in localStorage

### UI
- **Dark/light mode** — Toggle for the NOVA UI itself
- **10 color themes** — Slate, midnight, ocean, forest, sunset, amber, rose, violet, emerald, cyan
- **Responsive preview** — Full / Desktop (1280px) / Tablet (768px) / Mobile (375px)
- **Pipeline progress** — Visual stage tracker (Plan → Code → Analyze → Validate → Done)
- **Diff view** — Compare current build with previous (line-based LCS diff)
- **Multi-file viewer** — File tree + syntax highlighting for Python/React/Node output
- **ZIP download** — Download multi-file output as a real ZIP (dependency-free encoder)

### LLM Backends
- **Z.AI** — Primary model (fast, ~30-50s per build)
- **Kimi K3** — Free reasoning model via TokenRouter (slower but sometimes higher quality)
- **Automatic fallback** — If one fails, the other takes over

## Tech Stack

- **Next.js 16** with App Router + Turbopack
- **TypeScript 5** (strict mode)
- **Tailwind CSS 4** with shadcn/ui (New York style)
- **Z.AI SDK** — Primary LLM backend
- **TokenRouter** — Kimi K3 (OpenAI-compatible, free)
- **IndexedDB** — Cross-build memory cache
- **SSE** — Server-Sent Events for real-time streaming

## Quick Start

```bash
# Install dependencies
bun install

# Set up environment variables
cp .env.example .env
# Edit .env and add your API keys:
#   ZAI_API_KEY=your-z-ai-key (usually pre-configured)
#   TOKENROUTER_API_KEY=your-tokenrouter-key (for Kimi K3)

# Push database schema (if using Prisma)
bun run db:push

# Start development server
bun run dev

# Open http://localhost:3000
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ZAI_API_KEY` | Yes* | Z.AI SDK API key (usually pre-configured in sandbox) |
| `TOKENROUTER_API_KEY` | No | TokenRouter API key for Kimi K3 (free tier available) |

*In the Z.ai sandbox, the Z.AI SDK is pre-configured and doesn't need an explicit key.

## Scripts

| Command | Description |
|---------|-------------|
| `bun run dev` | Start dev server on port 3000 |
| `bun run build` | Production build |
| `bun run start` | Start production server |
| `bun run lint` | Run ESLint |
| `bun test` | Run all tests |
| `bun run db:push` | Push Prisma schema to database |

## Project Structure

```
src/
├── app/
│   ├── api/
│   │   ├── build/
│   │   │   ├── architect/route.ts   # Stage 1: Plan generation
│   │   │   ├── code/route.ts        # Stage 2: Code generation (SSE)
│   │   │   └── result/route.ts      # Polling fallback endpoint
│   │   └── refine/route.ts          # Chat-driven refinement (SSE)
│   ├── layout.tsx                   # Root layout with ThemeProvider
│   └── page.tsx                     # Main UI (prompt, preview, chat)
├── components/
│   ├── ui/                          # shadcn/ui components
│   ├── theme-toggle.tsx             # Dark/light toggle
│   ├── file-viewer.tsx              # Multi-file code viewer
│   ├── diff-viewer.tsx              # Build comparison view
│   ├── pipeline-progress.tsx        # Stage progress tracker
│   └── preview-error-boundary.tsx   # Error boundary for preview
├── lib/
│   ├── llm.ts                       # Z.AI SDK wrapper
│   ├── tokenrouter.ts               # Kimi K3 wrapper
│   ├── model-circuit-breaker.ts     # Failure tracking + cooldown
│   ├── llm-fallback.ts              # Multi-model fallback executor
│   ├── build-store.ts               # In-memory result store (SSE recovery)
│   ├── build-memory.ts              # IndexedDB cache
│   ├── sse-reader.ts                # Shared SSE reading utility
│   ├── golden-templates.ts          # Pre-built app templates
│   ├── static-analysis.ts           # Bug detection engine
│   ├── interaction-probe.ts         # Runtime testing
│   ├── error-recovery.ts            # Smart error messages
│   ├── multi-file.ts                # Multi-file output parsing
│   ├── diff.ts                      # LCS diff engine
│   ├── zip.ts                       # ZIP encoder (no deps)
│   └── ...                          # Other utilities
└── tests/                           # 726 tests, 0 failures
```

## Testing

```bash
# Run all tests
bun test

# Run specific test file
bun test tests/static-analysis.test.ts

# Run with parallelism
bun test --parallel
```

**Current status: 726 tests, 0 failures, 1269 assertions**

## Architecture

### Build Pipeline

```
User types mission
       ↓
[Architect] → Plan (JSON with features, colors, layout)
       ↓
[Coder] → HTML (streamed token-by-token via SSE)
       ↓
[Static Analysis] → Bug detection (missing IDs, undefined functions, etc.)
       ↓  (if bugs found, retry with hints)
[Validation] → Quality score (0-100)
       ↓
[CSP + Runtime Error Capture] → Injected into HTML
       ↓
[Result Store] → Saved for polling fallback
       ↓
[IndexedDB Cache] → Saved for instant rebuild
       ↓
[Probe] → Clicks buttons, checks state changes
       ↓  (if errors found)
[Auto-fix Loop] → Sends errors to LLM, repeats up to 3×
```

### SSE Recovery

If the SSE stream drops (gateway timeout, proxy limit):

```
Client detects stream end without result
       ↓
Polls GET /api/build/result?id=xxx (3 attempts, 3s apart)
       ↓
Server returns stored result from in-memory Map
       ↓
Client receives result → same as if SSE worked
```

## License

MIT — Build anything, share everything.

## Credits

Built with [Z.ai](https://z.ai) — AI-powered development.
