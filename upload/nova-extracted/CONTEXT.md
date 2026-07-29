# NOVA Build Anything — Context for New Conversation

## What This Project Is

This is **NOVA Build Anything** — an AI-powered app builder. Users describe what they want ("Build a snake game"), and NOVA's 8-stage LLM pipeline generates complete, working code with live preview.

## Current Architecture

```
src/
  app/
    page.tsx          (2943 lines) — Main UI: 8-mode interface (Dashboard/PRISM/Chain/ATLAS/NOVA/FORGE/Arena/Vault)
    api/nova/         (52 API routes) — master-mission, chat, refine, deploy, zip, quality-stats, etc.
  components/
    NovaIDE.tsx       (820 lines) — IDE Shell: activity rail + chat + preview + code + files + pipeline + insights + status bar
    ChatPanel.tsx     (124 lines) — Floating per-project AI chat with live code changes
  lib/
    pipeline.ts       (1879 lines) — 8-stage LLM pipeline (DISCOVER→ARCHITECT→BUILD→INTEGRATE→TEST→REVIEW→FIX→POLISH)
    llm.ts            (88 lines) — LLM wrapper using z-ai-web-dev-sdk
    mission-stream.ts (144 lines) — Event streaming (DB + in-memory subscribers)
    nova-llm-agents.ts — Agent definitions + 144 quality metrics
    nova-real-workspace.ts — Real file workspace + exec
    db.ts              — Prisma client
    + 96 other lib files (abort-manager, rate-limiter, retry-queue, etc.)
```

## What Works ✅

1. **Page loads** — 200, 8-mode interface renders
2. **⌘K Command Palette** — 30 searchable actions, opens with Ctrl/Cmd+K
3. **26 action buttons** — Refine, Deploy, ZIP, HTML, GitHub, Review, Audit, Profile, Stats, Branch, Map, Cost, Auto-Deploy, Share, Save Component, API Test, Analytics, Workspace, Plugin, Diff v, CI/CD, etc.
4. **Saved projects** — localStorage, gallery with quality scores
5. **Templates** — 8 templates (Calculator, Todo, Markdown, Snake, Weather, Music, etc.)
6. **Engine presets** — Fast/Balanced/Quality (quality target 6/7/9)
7. **Build API** — POST /api/nova/master-mission starts pipeline, returns missionId
8. **Chat API** — POST /api/nova/chat — AI sees project files + history, returns reply or code changes
9. **Dedup cache** — findSimilarBuild checks Jaccard similarity before building
10. **NovaIDE component** — Full IDE shell with activity rail, collapsible sidebar, split view, file tabs, live editing, status bar

## What's Broken ❌ (CRITICAL — needs fixing)

### 1. PIPELINE CRASHES — DB write fails
```
mission-stream] DB write failed: Cannot read properties of undefined (reading 'create')
```
**Root cause**: Prisma client in Turbopack runtime doesn't have `missionStreamEvent` model. The schema was added to `prisma/schema.prisma` and `prisma generate` was run, but the Turbopack dev server caches the OLD Prisma client that doesn't have the new models.

**Fix needed**: 
- Kill ALL node/next processes: `fuser -k -9 3000/tcp`
- Delete `.next` cache: `rm -rf .next`
- Regenerate Prisma: `DATABASE_URL="file:$(pwd)/db/custom.db" bunx prisma generate`
- Push schema: `DATABASE_URL="file:$(pwd)/db/custom.db" bunx prisma db push --accept-data-loss`
- Restart server: `nohup bun run dev > .zscripts/dev.log 2>&1 &`
- WAIT for full compile (page.tsx is 2943 lines, takes 30-60s on first compile)

**Current workaround**: `mission-stream.ts` has a no-op stub fallback:
```typescript
const db: any = _db && _db.missionStreamEvent ? _db : {
  missionStreamEvent: { create: async () => ({}), findMany: async () => [], count: async () => 0 },
  agentMemory: { create: async () => ({}), findMany: async () => [], count: async () => 0 },
  missionCheckpoint: { create: async () => ({}), findMany: async () => [] },
};
```
This prevents crashes but events DON'T persist to DB. UI still gets real-time updates via in-memory subscribers.

### 2. BUILD RETURNS EMPTY HTML
When `master-mission` finds a similar build in cache (AgentMemory), it returns `cachedBuild.html` — but if the previous build failed (saved empty HTML), the cache returns empty content.

**Fix needed**: 
- Option A: Clear the AgentMemory table: `DELETE FROM AgentMemory WHERE sourceCode = ''`
- Option B: Pass `forceNew: true` in the build request body to skip cache
- Option C: In `master-mission/route.ts`, check `best.sourceCode.length > 200` before returning cache

### 3. NOVAIDE NOT CONNECTED TO PAGE.TSX
`page.tsx` has its own built-in IDE (the 26-button header + Code/Preview/Tests tabs). `NovaIDE.tsx` is a SEPARATE component with the newer features (activity rail, collapsible sidebar, status bar, file tabs, live editing). They are NOT merged.

**Two options**:
- Option A: Replace page.tsx's COMPLETE view with `<NovaIDE>` component
- Option B: Merge NovaIDE's features (activity rail, status bar, tabs, split view, live editing) INTO page.tsx

### 4. STATE EXISTS BUT UI MISSING
These state variables were added to page.tsx but have NO corresponding UI:
- `splitView` — no Split button or split view rendering
- `openTabs` / `activeTab` — no file tab bar
- `dirtyFiles` / `savedFiles` — no live editing textarea (code is still read-only `<span>`)
- `toasts` — container exists but no action calls `showToast()`
- `cursorLine` / `cursorCol` — no status bar to show them
- `chatHistory` / `sendChat` — ChatPanel component exists but may not render (needs `phase === 'complete'`)

### 5. PREVIEW IFRAME EMPTY
After build completes, the iframe shows nothing because:
- Cached build returns empty HTML (see #2)
- Fresh build pipeline crashes (see #1)
- Even if build works, the `htmlFile` variable in page.tsx comes from `result.files` which may not be set correctly

**Fix**: Ensure `result.files` is populated from the pipeline output, and `htmlFile = allRepoFiles.find(f => /\.html$/i.test(f.path))` finds the HTML file.

## What the User Expects

The user wants a **professional IDE** like Cursor/VS Code where:
1. You describe what to build → AI generates complete working code
2. You see a **live preview** of the generated app (full-bleed iframe, flush to edges)
3. You can **edit code** directly (textarea, not read-only) → preview updates in real-time
4. You can **chat with the AI** about the project → AI makes changes that apply live
5. You have an **activity rail** (left sidebar, 48px icons): Chat | Preview | Code | Files | Pipeline | Insights
6. You can **collapse/expand** the sidebar
7. You have a **status bar** (bottom, 22px): ready/building | Ln,Col | language | files | quality
8. You have a **command palette** (⌘K): 30 searchable actions
9. You have **toast notifications** for actions
10. You have **file tabs** (open multiple files, switch, close with X)
11. You have **split view** (Code + Preview side by side)
12. You have **saved projects** (gallery with quality scores)
13. The build produces **complete, working apps** — not empty pages or stubs
14. **No page-level scroll** — everything fits in 100vh, internal scroll only

## What NOT to Do

- Don't skip pipeline stages (the user hates "Fast mode" that skips REVIEW/FIX — it produces broken apps)
- Don't use cached builds if they're empty (always check `sourceCode.length > 200`)
- Don't add features without wiring them to UI (state without UI = useless)
- Don't claim things work without testing in the browser
- Don't let the page scroll vertically (use `h-screen overflow-hidden` on root)
- Don't wrap the preview iframe in a shadow/card frame (full-bleed, flush to edges)
- Don't split game logic into 12 tiny files (prefer 2-4 substantial files, 100+ lines each)
- Don't let the builder return instructions instead of code ("Add collision detection" is NOT code)

## Key Files to Check

- `src/app/page.tsx` — main UI (2943 lines, has ALL state but some UI missing)
- `src/components/NovaIDE.tsx` — IDE Shell component (820 lines, has activity rail + status bar + split + tabs + live editing)
- `src/components/ChatPanel.tsx` — floating chat panel (124 lines)
- `src/lib/pipeline.ts` — 8-stage LLM pipeline (1879 lines)
- `src/lib/llm.ts` — LLM wrapper (88 lines, uses z-ai-web-dev-sdk)
- `src/lib/mission-stream.ts` — event streaming (144 lines, has DB fallback stub)
- `src/app/api/nova/master-mission/route.ts` — build API (rate limit + dedup + pipeline)
- `src/app/api/nova/chat/route.ts` — chat API (per-project, live code changes)
- `src/app/api/nova/build-stream/route.ts` — streaming build API (SSE, architect+builder+reviewer)
- `prisma/schema.prisma` — DB schema (includes AgentMemory, MissionStreamEvent, MissionCheckpoint)

## Git History (all committed)

```
a2859dae fix: mission-stream DB fallback stub
afa6bc5f fix: mission-stream DB fallback
3117e113 fix: syntax error in command palette
f8d2d921 fix: import ChatPanel
d4e6155b add: Command Palette + Toasts + Chat to page.tsx
b9cfb288 fix: add prisma models
966ef272 fix: dynamic socket.io import
7fb4f99d RESTORE FULL from user zip
+ NovaIDE + build-stream + chat + llm.ts
```

## First Steps for New Conversation

1. Extract this zip
2. `bun install` (if needed)
3. `DATABASE_URL="file:$(pwd)/db/custom.db" bunx prisma generate && bunx prisma db push --accept-data-loss`
4. `rm -rf .next` (clean cache)
5. `fuser -k -9 3000/tcp` (kill any old server)
6. `nohup bun run dev > .zscripts/dev.log 2>&1 &` (start server)
7. Wait 30-60s for first compile
8. `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/` (check 200)
9. Test build: `curl -s -X POST http://localhost:3000/api/nova/master-mission -H "Content-Type: application/json" -d '{"mission":"Build a snake game","stream":true}'`
10. Check if pipeline runs: wait 30s, then `curl -s http://localhost:3000/api/nova/mission-events/<missionId>`
11. If 0 events → pipeline crashed → check `.zscripts/dev.log` for errors
12. Fix the root cause, then wire the missing UI features
