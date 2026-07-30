# Verified Facts
Direct observations from `source/`.

## Identity
- **App name**: TFA Evolution Studio (`source/app.json`)
- **Slug**: `tfa-evolution-studio`
- **Version**: 1.0.1, iOS build 1, Android versionCode 1
- **Bundle ID**: `com.miaoda.appcvu5slxpg9a9`
- **Positioning**: "AI Operating System in Your Pocket" — mobile-first alpha for a single user managing AI code-evolution workflows against a self-hosted backend.

## Tech stack
- React Native Expo SDK 55.0.6, Expo Router 55.0.5, `src` as router root.
- React 19.2.0, React Native 0.83.2, React DOM 19.2.0, TypeScript 5.9.2 strict.
- NativeWind 4.2.3 + TailwindCSS 3.4.17 for styling.
- `@rn-primitives/*` 1.4.0 for headless UI primitives (accordion, dialog, dropdown, select, tabs, etc.).
- Lucide icons via `lucide-react-native`.
- State: React hooks only; no external state library.
- Storage: `@react-native-async-storage/async-storage` for API URL and Sentry DSN env.
- File pick: `expo-document-picker`; download: `expo-web-browser`.
- Haptics: `expo-haptics`.
- Lint/formatter: Biome 2.4.5, oxlint, `miaoda-expo-devkit` 0.1.1-beta.87, `devkit-lint`.
- Crash reporting: Sentry via `@sentry/react-native`, DSN from `EXPO_PUBLIC_SENTRY_DSN`.

## Navigation
- Root layout `source/src/app/_layout.tsx`: stack with `(tabs)`, `launch`, `templates`, `search`, `settings`, `workflows`, `projects`, `admin`.
- Entry `source/src/app/index.tsx` redirects to `/(tabs)/home`.
- Tab bar `source/src/app/(tabs)/_layout.tsx`: Home, Missions, Forge, Lab, Vault.
- **Pipeline** exists as a tab screen but is hidden from the tab bar (`href: null`) and used as a fallback/detail route.

## Design system
- Hardcoded tokens in `source/src/lib/design.ts`:
  - `C.bg = '#080c14'`, `C.card = '#111827'`, `C.border = '#1e293b'`, `C.fg = '#e2e8f0'`, `C.muted = '#64748b'`
  - Accent colors: cyan, green, amber, red, purple, blue.
- State → color map and agent-tier colors also live in `design.ts`.
- Navigation theme in `source/src/lib/theme.ts` (light/dark; app is dark-only).

## Authentication
- **No login or auth headers.** PRD §1 and §4.1 state the app is alpha/no-auth.
- AsyncStorage key `tfa_api_url` holds the self-hosted backend base URL; default is `http://localhost:4000`.

## Backend API surface (client expectation)
All calls are unauthenticated JSON unless noted. Source files: `source/src/api/*.ts`.
- `GET  /health` — health status, db, uptime, version.
- `GET  /providers` — list AI providers.
- `POST /providers/:id/ping` — ping provider.
- `POST /providers/:id/set-default` — set default provider.
- `GET  /projects` — list projects.
- `POST /projects` — create project.
- `GET  /projects/:id` — project detail.
- `GET  /projects/:id/versions` — version history.
- `POST /projects/:id/upload` — multipart ZIP upload.
- `GET  /projects/:id/files?versionId=` — file tree.
- `GET  /lineage/:id` — project lineage.
- `GET  /workflows` — list workflows.
- `POST /workflows` — create workflow (body: `projectId`, `versionId`, `objective`).
- `GET  /workflows/:id` — workflow detail.
- `POST /workflows/:id/approve` — approve plan (optional `notes`).
- `POST /workflows/:id/reject` — reject plan (optional `reason`).
- `GET  /artifacts` — list artifacts.
- `GET  /artifacts/:id` — artifact detail.
- `GET  /artifacts/:id/download` — artifact download URL.
- `GET  /agents/observatory` — agent stats by tier.
- `GET  /agents/observatory/workflows/:id` — agents for a workflow.
- `GET  /audit?page=&limit=` — audit log.
- `GET  /settings` — app settings.
- `PUT  /settings` — update settings.
- `GET  /admin/health/history` — health history.

## Data model
Canonical types in `source/src/api/types.ts`:
- `Workflow`, `AnalysisResult`, `EvolutionPlan`, `WorkflowAgent`, `FileOp`, `Project`, `ProjectVersion`, `Artifact`, `Provider`, `AgentStat`, `AgentObservatoryData`, `AppSettings`, `AuditEntry`, `HealthData`.
- File ops: `create | modify | delete | rename`.
- Agent status: `pending | running | completed | failed | skipped`.
- Provider has latency, health, default flag, cost estimate.

## Workflow state machine
States implemented in client:
- Active: `extracting`, `analyzing`, `architecture_generated`, `plan_generated`, `approved`, `executing_agents`, `qa_running`, `security_scanning`, `packaging`.
- Terminal / gated: `awaiting_approval`, `ready_for_download`, `completed`, `failed`, `rejected`.
- Stage map and progress helper in `source/src/lib/utils.ts` (`stageLabel`, `stageProgress`).

## Polling behavior (from code)
- Workflow detail: `setInterval(load, 6000)` when active.
- PRD specifies Missions 8 s, Pipeline 6 s, Workflow detail 5 s; code currently uses 6 s for workflow detail.
- Pull-to-refresh is wired on list screens.

## Key screens and routes
- `source/src/app/(tabs)/home.tsx` — dashboard with approval queue, active evolutions, recent completions.
- `source/src/app/(tabs)/missions.tsx` — Mission Control (approval queue + active + completed).
- `source/src/app/(tabs)/forge.tsx` — project list and workspace.
- `source/src/app/(tabs)/pipeline.tsx` — grouped pipeline (Active / Awaiting Decision / Completed / Failed), collapsed sections.
- `source/src/app/(tabs)/lab.tsx` — agent laboratory.
- `source/src/app/(tabs)/vault.tsx` — outputs, memory, system settings.
- `source/src/app/launch.tsx` — 4-step Mission Launch flow.
- `source/src/app/templates.tsx` — objective templates (18 hardcoded templates in 6 categories).
- `source/src/app/search.tsx` — cross-entity search over projects/workflows/artifacts.
- `source/src/app/settings.tsx` — system configuration.
- `source/src/app/projects/[id].tsx`, `create.tsx`, `explorer.tsx`, `lineage.tsx`.
- `source/src/app/workflows/[id].tsx` — workflow detail with stage rail, agent timeline, file ops, approve/reject.
- `source/src/app/admin/audit.tsx`, `diagnostics.tsx`, `health.tsx`.

## UI component inventory
- `source/src/components/ui/*` — 30+ primitive wrappers (button, card, dialog, select, tabs, etc.).
- `source/src/components/StateBadge.tsx`, `ErrorBanner.tsx`, `EmptyState.tsx`, `SkeletonLoader.tsx`, `StatCard.tsx`.

## Notable PRD ↔ source discrepancies
- PRD §7 lists **workflow templates or presets** as out-of-scope, yet `source/src/app/templates.tsx` exists with 18 objective templates.
- PRD §7 lists **search functionality across tabs** as out-of-scope, yet `source/src/app/search.tsx` exists and is registered in the root stack.
- PRD shows **Pipeline** as a top-level tab, but the tab layout hides it (`href: null`); it appears to be a fallback/experimental route.
- PRD describes 4-stage progress in Workflow Detail (Extracting → Analyzing → Planning → Awaiting Approval → Executing → Completed); code implements 8-stage rail (`extracting`, `analyzing`, `plan_generated`, `awaiting_approval`, `executing_agents`, `qa_running`, `packaging`, `ready_for_download`).
