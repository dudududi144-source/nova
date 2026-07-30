# Risks
Track the Critical and High items actively.

## Critical

| ID | Risk | Why it matters | Mitigation |
|---|---|---|---|
| C1 | **No backend code in package.** The client expects a complete REST API; without it the app is UI-only. | Blocks all acceptance criteria. | Owner must supply or build backend matching `source/src/api/types.ts` and endpoints. Use this package's API files as the contract. |
| C2 | **No authentication.** Any device that can reach the backend can create, approve, and reject workflows. | Security / abuse risk for alpha on shared networks. | Backend should bind to localhost/secure tunnel by default; add auth before any internet-facing deployment. |

## High

| ID | Risk | Why it matters | Mitigation |
|---|---|---|---|
| H1 | **Bleeding-edge stack.** Expo SDK 55, React 19, RN 0.83, `miaoda-expo-devkit` beta, and `@rn-primitives` may have runtime or build issues. | Could block builds or cause crashes on device. | Build early on both iOS and Android; pin versions; test with Expo dev client; monitor upstream issue trackers. |
| H2 | **PRD ↔ source mismatches.** Templates, search, and pipeline tab are implemented but marked out-of-scope or differently scoped. | QA / acceptance confusion. | Owner resolves Q2 and Q3; update PRD or remove code. |
| H3 | **Template objective pass-back may be unreliable.** `templates.tsx` calls `router.back()` then `router.setParams({ selectedObjective })`, but `launch.tsx` reads `params.objective` from `useLocalSearchParams`. | Templates may not pre-fill the objective. | Verify during QA; if broken, use navigation params or global state. |
| H4 | **Polling intervals not aligned with PRD.** Workflow detail polls every 6 s; PRD says 5 s; Missions polling not verified as 8 s. | Inconsistent UX / battery use. | Audit all list screens and align with PRD §4.5. |
| H5 | **Max ZIP size not enforced on client.** Users can attempt huge uploads. | OOM or backend rejection. | Read `/settings` before upload and warn; enforce on backend. |
| H6 | **No automated tests.** 110 source files with zero unit/integration tests. | Regressions likely during rapid changes. | Add test scaffolding (Jest + React Native Testing Library) and critical-path tests. |
| H7 | **Sentry DSN optional.** If not provided, Sentry still initializes with undefined DSN; may send nothing silently. | Observability gap. | Validate env at build time or make Sentry init conditional. |
| H8 | **Hardcoded design tokens duplicated.** Colors are hardcoded in `design.ts`, `theme.ts`, and inline styles across screens. | Visual drift and maintenance burden. | Keep `design.ts` as single source; refactor inline styles to use `C` tokens. |

## Medium

| ID | Risk | Mitigation |
|---|---|---|
| M1 | Default `localhost:4000` does not work on physical devices. | Add onboarding / settings QR or default to local-network IP. |
| M2 | `Provider` picker hardcodes providers; backend may differ. | Sync with backend `/providers` response; remove unsupported options. |
| M3 | `api-client.ts` swallows non-JSON errors as strings. | Add structured error handling and user-facing messages. |
| M4 | No offline state handling beyond error banner. | Add `expo-network` reachability checks and stale data indicators. |
| M5 | Large icon/adaptive-icon PNGs (1.7 MB each) inflate bundle. | Convert to WebP or compress before store submission. |
| M6 | Accessibility labels missing on many icon-only buttons. | Audit and add `accessibilityLabel`. |
