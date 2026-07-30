# Next Step — Execution Guidance

## 0. Pre-flight (before touching code)
1. Confirm with the owner whether the backend is available or must be built.
2. Resolve `handoff/QUESTIONS.md` Q1–Q3 (backend contract, templates/search scope, Pipeline route).
3. Decide target build environment (Expo dev client, EAS, or local Xcode/Android Studio).

## 1. Run the app locally
```bash
cd source/
pnpm install
# optional: export EXPO_PUBLIC_SENTRY_DSN=...
npx expo start
```
- Press `i` for iOS simulator, `a` for Android emulator, `w` for web.
- The backend must be running at the configured API URL (default `http://localhost:4000`).

## 2. Backend contract (if backend is missing)
Use `source/src/api/*.ts` and `source/src/api/types.ts` as the request/response contract.
Minimum viable endpoints for the PRD acceptance criteria:
- `POST /projects`, `GET /projects`, `GET /projects/:id/versions`, `POST /projects/:id/upload`
- `POST /workflows`, `GET /workflows`, `GET /workflows/:id`, `POST /workflows/:id/approve`, `POST /workflows/:id/reject`
- `GET /artifacts`, `GET /artifacts/:id/download`
- `GET /agents/observatory`
- `GET /health`, `GET /settings`

## 3. Recommended implementation order
1. **Resolve PRD/source mismatches.** Decide on templates, search, and Pipeline route.
2. **Fix template pass-back.** Verify `source/src/app/templates.tsx` reliably sends `objective` to `source/src/app/launch.tsx`.
3. **Align polling intervals.** Audit all focused screens and match PRD §4.5 (Missions 8 s, Pipeline 6 s, Workflow detail 5 s).
4. **Add client-side ZIP size preflight.** Read `/settings` and warn before upload.
5. **Add structured error handling.** Improve `source/src/lib/api-client.ts` error messages and offline detection.
6. **Add basic tests.** Set up Jest + React Native Testing Library; test launch flow, workflow list, approve/reject.
7. **Build and sign.** Resolve iOS/Android bundle identifiers, EAS credentials, and Sentry DSN.

## 4. Acceptance criteria from PRD
Repeat these before calling the release done:
1. App opens directly to Missions/Home without login.
2. Approve a workflow inline in Missions; it moves to Active.
3. Complete the 4-step Mission Launch flow (project → version → objective → review) in under 30 seconds.
4. Create a new project, upload a ZIP, launch from Forge.
5. Approve a workflow inline in Pipeline without opening detail.
6. Wait for workflow to complete; see Download button in Pipeline Completed section.
7. Download artifact from Pipeline.
8. Open Vault → Outputs and view artifact details.

## 5. What NOT to do in this pass
- Do not add authentication until the owner moves out of private alpha.
- Do not add push notifications, scheduling, or workflow templates marketplace.
- Do not add an in-app code editor or diff viewer.
- Do not switch to a different state-management library without a clear reason.
- Do not add a second UI component library.

## 6. Source material references
- Requirements: `source/docs/prd.md`
- Types / API contract: `source/src/api/types.ts`, `source/src/api/*.ts`
- Design tokens: `source/src/lib/design.ts`, `source/src/lib/theme.ts`
- Routing: `source/src/app/_layout.tsx`, `source/src/app/(tabs)/_layout.tsx`
- Networking: `source/src/lib/api-client.ts`
- Launch flow: `source/src/app/launch.tsx`
- Mission Control: `source/src/app/(tabs)/missions.tsx`
- Pipeline: `source/src/app/(tabs)/pipeline.tsx`
- Workflow detail: `source/src/app/workflows/[id].tsx`
- Project screens: `source/src/app/projects/*.tsx`
- Settings / admin: `source/src/app/settings.tsx`, `source/src/app/admin/*.tsx`
