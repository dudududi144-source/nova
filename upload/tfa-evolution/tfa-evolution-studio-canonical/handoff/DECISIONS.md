# Settled Decisions
These are already embodied in the source or PRD. Do not re-litigate unless constraints change.

| # | Decision | Source / rationale |
|---|---|---|
| D1 | **No authentication in alpha.** App opens directly to the main interface. | PRD §1, §4.1; `source/src/lib/api-client.ts` sends no auth headers. |
| D2 | **Self-hosted backend with configurable API URL.** Stored in AsyncStorage; default `http://localhost:4000`. | PRD §4.1; `source/src/lib/api-client.ts`. |
| D3 | **Dark theme only.** Hardcoded dark tokens; no light-mode toggle. | PRD §7; `source/src/lib/design.ts`; `source/app.json` `userInterfaceStyle: "dark"`. |
| D4 | **Expo Router with `src` as root.** File-based routing; stack + tabs layout. | `source/app.json` `router.root: "src"`; `source/src/app/_layout.tsx`. |
| D5 | **Bottom tabs: Home / Missions / Forge / Lab / Vault.** Pipeline is a hidden route, not a tab. | `source/src/app/(tabs)/_layout.tsx`. |
| D6 | **React hooks + AsyncStorage for state.** No Redux/Zustand/MobX. | Code inspection. |
| D7 | **ZIP upload via `expo-document-picker` and multipart fetch.** Type forced to `application/zip`. | `source/src/api/projects.ts`. |
| D8 | **Artifact download opens in `expo-web-browser`.** Download URL composed as `${apiUrl}/artifacts/${id}/download`. | `source/src/api/artifacts.ts`. |
| D9 | **Approval/Reject are inline actions.** Both in Missions and Pipeline; rejection requires reason via dialog. | PRD §3.1, §3.3; code in `source/src/app/(tabs)/missions.tsx` and `pipeline.tsx`. |
| D10 | **Workflow detail shows 8-stage rail and agent execution timeline.** Includes expandable agent output, file ops, approve/reject. | `source/src/app/workflows/[id].tsx`. |
| D11 | **Agent tiers color-coded:** executive purple, engineering cyan, quality green, release amber. | PRD §3.4; `source/src/lib/design.ts` `TIER_COLORS`. |
| D12 | **Sentry is opt-in via `EXPO_PUBLIC_SENTRY_DSN`.** If unset, Sentry init runs with undefined DSN. | `source/src/app/_layout.tsx`. |
| D13 | **Polling, not SSE, for real-time updates.** Code uses `setInterval` on focused screens. | PRD §4.5; code. |
| D14 | **No in-app code editor or diff viewer.** ZIP contents shown as read-only file tree. | PRD §7; `source/src/app/projects/explorer.tsx`. |
| D15 | **UI primitives from `@rn-primitives/*` and custom wrappers.** Do not introduce a second component library. | `source/package.json`, `source/src/components/ui/`. |
