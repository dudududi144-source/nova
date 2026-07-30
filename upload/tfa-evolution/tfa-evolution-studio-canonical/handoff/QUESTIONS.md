# Open Questions
These need an owner decision or further research before the next agent commits to them.

## Must answer before shipping

| # | Question | Why it matters | Recommended default |
|---|---|---|---|
| Q1 | What is the canonical backend API contract? The client expects many endpoints, but no backend code is in this package. | The app cannot function without a matching backend. | Owner must provide backend spec or implementation; treat endpoints in `source/src/api/*.ts` as the provisional contract. |
| Q2 | `templates.tsx` and `search.tsx` exist but PRD marks templates/presets and cross-tab search as out-of-scope. Keep, remove, or scope them? | Source currently registers both routes in the root stack; PRD acceptance criteria do not mention them. | Keep templates as an objective quick-fill helper; keep search as a convenience; update PRD if they ship. |
| Q3 | Pipeline route is hidden from tabs but implemented. Is it a debug fallback, a future feature, or should it be removed? | It may confuse QA / users. | Keep as internal fallback route until product owner decides whether to surface it. |
| Q4 | What are the actual provider names/models the backend supports? The default-provider picker in Settings hardcodes openai/anthropic/gemini/openrouter/ollama/mock. | UI assumes this set; backend may differ. | Confirm provider list with backend owner; align `source/src/app/settings.tsx` picker. |
| Q5 | Where is max ZIP size enforced? PRD says max ZIP size is a System setting, but client upload just sends the file. | Large ZIPs may crash or be rejected unexpectedly. | Enforce limit on backend; optionally add client-side preflight check against `/settings`. |
| Q6 | What is the target build environment and signing? (EAS, local Xcode/Android Studio, Expo dev client, or managed build?) | Affects `app.json`, plugins, and release steps. | Use Expo dev client for alpha; document EAS credentials separately. |
| Q7 | Should rejection always require a reason? PRD says yes; UI shows dialog but not all code paths verified. | Compliance / audit trail. | Require reason; add client validation before POST. |
| Q8 | How is the API URL configured on first launch? Currently default `localhost` will not work on a physical device. | Alpha onboarding. | Add an onboarding screen or default to a known local-network IP / tunnel URL. |

## Research / nice-to-have

| # | Item | When |
|---|---|---|
| R1 | Confirm `miaoda-expo-devkit` and Expo SDK 55 work on target devices (especially iOS/Android new arch with React 19). | Before first build. |
| R2 | Run `devkit-lint` and fix any strict lint errors. | Before PR review. |
| R3 | Verify `router.setParams({ selectedObjective })` after `router.back()` in `templates.tsx` reliably passes the objective back to `launch.tsx`. | During QA. |
| R4 | Accessibility audit (screen reader labels, contrast, focus). | Before public beta. |
| R5 | Unit / integration test strategy. No tests are present. | After core flows stabilize. |
| R6 | Bundle size and startup performance budget. | Before wider rollout. |
| R7 | Push notifications strategy once backend supports them. | Post-alpha. |
