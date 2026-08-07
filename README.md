<div align="center">

# NOVA

### The Prompt-to-Reality Engine

**Describe anything. Get everything.**

NOVA transforms a single sentence into a complete, production-grade web application — live, interactive, and fully functional. No templates. No constraints. No fixed patterns. Just pure creative intelligence that adapts to whatever you imagine.

</div>

---

## What NOVA Does

You type a description. NOVA thinks, designs, and builds — in real-time, token by token, right before your eyes. What you get back isn't a mockup or a wireframe. It's a working application with real logic, real interactivity, and real polish.

**"Build a crypto trading dashboard with live charts and order book"** → You get a fully interactive trading terminal with simulated live data, candlestick charts, a working order book, and portfolio tracking.

**"Build a mobile OS simulator with app grid and notifications"** → You get a phone-like interface with swiping home screens, opening apps, a notification center, and settings panels.

**"Build a 3D solar system explorer"** → You get orbiting planets with realistic mechanics, clickable bodies with info panels, and camera controls.

NOVA doesn't pick from templates. It doesn't follow fixed patterns. It analyzes what you want and decides — on its own — the best architecture, design, and implementation strategy for that specific request.

---

## How It Works

### The Pipeline

```
Your words
    ↓
┌─────────────────────────────────────────────────┐
│  ARCHITECT                                      │
│  Analyzes your request, designs a plan          │
│  Decides: features, architecture, visual design │
└──────────────────────┬──────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────┐
│  CODER                                          │
│  Builds the complete application                │
│  Streams code live — you watch it appear        │
└──────────────────────┬──────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────┐
│  ANALYZER                                       │
│  Static analysis — catches bugs before you do   │
│  10+ bug types detected in <1ms                 │
└──────────────────────┬──────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────┐
│  PROBE                                          │
│  Actually clicks buttons, types in inputs       │
│  Verifies the app works — not just "no errors"  │
└──────────────────────┬──────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────┐
│  AUTO-FIX (if needed)                           │
│  Sends found errors back to the AI              │
│  Iterates up to 3× until clean                  │
└──────────────────────┬──────────────────────────┘
                       ↓
              Working application
```

### What Makes NOVA Different

**No fixed patterns.** Most AI builders have presets: "if game → use Canvas", "if todo → use checklist". NOVA has none of that. The AI analyzes each request uniquely and chooses its own approach. A dice game gets dice. A trading dashboard gets charts. A solar system gets orbital mechanics. The AI decides.

**Live token streaming.** You don't wait 60 seconds for a spinner. You watch the code appear character by character — HTML structure, CSS styling, JavaScript logic — all flowing in real-time. The preview updates as the code arrives.

**Deep reasoning mode.** NOVA enables thinking mode on every LLM call — architect, code generation, refinement, and bug fixing. The model reasons deeply about architecture before generating, producing more complete and functional apps.

**It actually verifies.** NOVA doesn't just generate and hope. After building, it loads the app in a sandbox, clicks every button, types in every input, and checks if the DOM actually changes. If something's broken, it sends the errors back to the AI and tries again. Up to 3 times.

**Cross-build memory.** Build something, then rebuild it later? Instant. NOVA caches every build in IndexedDB. Rebuilding a previous request takes 0ms instead of 60s. It also suggests similar past builds as you type.

**Survives anything.** SSE stream drops? NOVA polls the server and recovers the result. AI model fails? Circuit breaker disables it and falls back to the other model. Architect fails? The coder proceeds without a plan. Network timeout? Client-side detection kicks in at 300s.

---

## Capabilities

### What You Can Build

| Request | What NOVA Delivers |
|---------|-------------------|
| Crypto trading dashboard | Live charts, order book, portfolio tracker, simulated market data |
| Mobile OS simulator | Home screen, app grid, notifications, settings, app switching |
| Banking dashboard | Accounts, transfers, transaction history, spending analytics |
| 3D solar system | Orbital mechanics, planet info, camera controls, starfield |
| Music production studio | Multi-track sequencer, effects, mixer, waveform visualization |
| Data visualization dashboard | Real-time charts, KPI cards, filters, responsive layout |
| Dice game | Roll animation, two-player scoring, game-over screen |
| Snake game | Canvas rendering, score, game-over, restart |
| Anything you can describe | The AI decides the best approach |

### Quality Pipeline

- **Static Analysis** — Detects missing element IDs, undefined functions, infinite loops, uncleared intervals, missing try/catch, missing await, empty event listeners — all in <1ms, before you see the result
- **Interaction Probe** — Actually runs the app, clicks buttons, types text, verifies state changes occur
- **Auto-Fix Loop** — If errors are found, sends them back to the AI with full context and retries — up to 3 iterations
- **Quality Scoring** — 0-100 score based on structure, functions, CSS rules, event listeners, and accessibility

### Resilience Layer

- **SSE Recovery** — If the stream drops, client polls `/api/build/result` to recover the completed build
- **Circuit Breaker** — Tracks model failures; after 5 consecutive failures, temporarily disables the model (2-min cooldown)
- **Graceful Degradation** — Architect failure returns `plan:null` (not 502); the coder proceeds without a plan
- **Client Timeout** — 300-second read timeout detects half-open TCP connections
- **Multi-Model Fallback** — Z.AI → Qwen → Kimi K3 automatic failover on all routes (architect, code, refine, enhance) with circuit breaker

### Memory System

- **IndexedDB Cache** — Every build stored for instant rebuild (0ms vs 30-60s)
- **Similar Build Search** — Reverse cursor scans recent builds, fuzzy matches by mission keywords
- **Normalized Matching** — Word-order independent: "build snake game" = "game snake build"
- **30-day TTL** — Old builds auto-pruned; max 200 entries

### User Experience

- **Dark/Light Mode** — CSS-only toggle, zero hydration mismatch
- **10 Color Themes** — Slate, midnight, ocean, forest, sunset, amber, rose, violet, emerald, cyan
- **Responsive Preview** — Full / Desktop (1280px) / Tablet (768px) / Mobile (375px)
- **Live Pipeline Progress** — Visual stage tracker with real-time text updates
- **Diff View** — LCS-based line diff comparing current build with previous
- **Multi-File Viewer** — Syntax highlighting for 9 languages, file tree, ZIP download
- **Chat Refine** — "make it blue", "add dark mode", "add a chart" — iterative refinement
- **Sandboxed Preview** — Strict CSP, null-origin iframe, no access to parent storage
- **Settings Panel** — Configure API keys (Z.AI, DashScope, TokenRouter) via UI; keys stored in memory, take precedence over env vars
- **Code Execution** — Run generated Python/JS/Bash code in a sandboxed environment with stdin support
- **Backup System** — Export/Import builds as ZIP, list and download backups

---

## Architecture

```
src/
├── app/
│   ├── api/
│   │   ├── build/
│   │   │   ├── architect/route.ts    → Stage 1: Plan generation
│   │   │   ├── code/route.ts         → Stage 2: Code generation (SSE streaming)
│   │   │   └── result/route.ts       → Polling fallback endpoint
│   │   └── refine/route.ts           → Chat-driven refinement (SSE)
│   ├── layout.tsx                    → Root layout + ThemeProvider
│   └── page.tsx                      → Main UI
├── components/
│   ├── theme-toggle.tsx              → Dark/light CSS-only toggle
│   ├── file-viewer.tsx               → Multi-file code viewer + syntax highlighting
│   ├── diff-viewer.tsx               → LCS diff viewer
│   ├── pipeline-progress.tsx         → Visual stage tracker
│   └── preview-error-boundary.tsx    → Crash protection
├── lib/
│   ├── llm.ts                        → Z.AI SDK wrapper
│   ├── tokenrouter.ts                → Kimi K3 backend
│   ├── model-circuit-breaker.ts      → Failure tracking + auto-disable
│   ├── llm-fallback.ts               → Multi-model fallback executor
│   ├── build-store.ts                → In-memory result store (SSE recovery)
│   ├── build-memory.ts               → IndexedDB cross-build cache
│   ├── sse-reader.ts                 → Shared SSE reading utility
│   ├── static-analysis.ts            → 10+ bug type detector
│   ├── interaction-probe.ts          → Runtime testing (clicks, types, verifies)
│   ├── error-recovery.ts             → Smart error categorization
│   ├── multi-file.ts                 → Multi-file output parsing
│   ├── diff.ts                       → LCS diff engine
│   ├── zip.ts                        → Dependency-free ZIP encoder
│   ├── golden-templates.ts           → Pre-built templates (available, not forced)
│   └── ...                           → Utilities
└── tests/                            → 3029 tests, 0 failures
```

---

## Quick Start

```bash
bun install
cp .env.example .env    # Add TOKENROUTER_API_KEY for Kimi K3 (optional)
bun run dev             # Open http://localhost:3000
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ZAI_API_KEY` | Auto | Auto-loaded from `/etc/.z-ai-config` in Z.ai sandbox; or set via Settings UI |
| `DASHSCOPE_API_KEY` | Optional | For Qwen fallback; set via env var or Settings UI |
| `TOKENROUTER_API_KEY` | Optional | For Kimi K3 fallback (free at tokenrouter.com); set via env var or Settings UI |

> **Note:** API keys can also be configured at runtime via the Settings panel in the UI. Settings UI keys take precedence over environment variables.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 + App Router + Turbopack |
| Language | TypeScript 5 (strict) |
| Styling | Tailwind CSS 4 + shadcn/ui |
| Primary AI | Z.AI SDK |
| Fallback AI | Kimi K3 via TokenRouter (free, OpenAI-compatible) |
| Memory | IndexedDB |
| Streaming | Server-Sent Events (SSE) |
| Testing | Bun test — 3029 tests, 5342 assertions |

---

## Testing

```bash
bun test    # 3029 tests, 0 failures
```

---

## Philosophy

NOVA is built on a simple principle: **the AI should decide how to build, not follow a script.**

Most AI app builders have a library of templates and patterns. "If the user says 'game', use Canvas and requestAnimationFrame." "If they say 'todo', use a checklist." This produces predictable, homogeneous output.

NOVA has no such presets. The AI receives the request, analyzes it, and decides — from scratch — the best architecture, design, and implementation for that specific thing. A dice game gets 3D dice. A trading dashboard gets candlestick charts. A solar system gets orbital mechanics. Each build is unique because the AI adapts.

The result: you get what you asked for, not what the template dictated.

---

## License

MIT

---

<div align="center">

**[Live Demo](https://nova.preview)** · **[GitHub](https://github.com/rabotatony/nova)**

Built with Z.ai — AI-powered development.

</div>
