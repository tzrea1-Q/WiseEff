# TD-032 Parameter Debugging Reload — Execution Plan

**Status:** Completed 2026-07-01 on `feat/td032-parameter-debugging-reload`.

**Goal:** Split node registry from parameter reload bindings, implement reload runtime, restore `/debugging` with M1-aligned catalog federation.

## Progress

| Phase | Scope | Status |
| --- | --- | --- |
| A | Migration 0026, domain types, repository `session_kind` / `parameter_definition_id` | Done |
| B | Admin API + split catalog UI tabs with node/reload-binding create/edit dialogs | Done |
| C | `POST /api/v1/debugging/parameters/reload`, `GET /reload-targets`, writeNode reload branch | Done |
| D | Re-enable `/debugging` nav + route, runtime uses reload targets + reload API | Done |

## Verification

```bash
npm run db:migrate
npm run test:server -- server/modules/debugging server/modules/contracts
npm test -- src/appConfig.test.ts src/App.test.tsx src/application/debugging/debuggingRuntime.test.ts
npx tsc -b --noEmit
npm run docs:check
```

## Documentation Impact Matrix

| Doc | Action | Path |
| --- | --- | --- |
| Domain model | Updated | `docs/design-docs/domain-model.md`, `docs/zh-CN/design-docs/domain-model.md` |
| Tech debt | Closed TD-032; TD-015 note updated | `docs/exec-plans/tech-debt-tracker.md`, zh-CN mirror |
| Frontend map | Updated `/debugging` status | `docs/FRONTEND.md` |
| E2E | Reload API smoke + responsive gate | `e2e/debugging.api.spec.ts`, `e2e/quality/responsive.quality.spec.ts` |

## Documentation Update Gate

- [x] Bilingual domain-model section for DebugNode / ParameterReloadBinding / session_kind
- [x] TD-032 moved to Completed in tech-debt tracker
- [x] `npm run docs:check` passes
