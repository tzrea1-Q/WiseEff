# ADR-0023: Frontend app state transitions live in application/state, not App.tsx

- Status: Accepted
- Date: 2026-08-12

## Context

The global prototype reducer (`reducer`, alias `appReducer`) and its `AppAction` union lived inside `src/App.tsx` alongside the app shell, several full feature pages, and app chrome. Fourteen non-test modules — including two application-layer runtime modules — imported `AppAction` from `@/App`, so every feature had a compile-time dependency on the 6,000-line UI entry file, and application code depended on the UI layer (a layering inversion). Every feature commit converged on `App.tsx` (179 commits, the most-changed file in the repository), and testing any state transition or trapped page required importing the whole shell.

## Decision

State transitions are an application-layer module: `src/application/state/appState.ts` owns `AppAction`, `reducer`/`appReducer`, and the state-transition helpers only the reducer uses. `App.tsx` imports the reducer like any other consumer. Feature modules, runtime modules, and tests must import state types and the reducer from `@/application/state/` — **never from `@/App`**. The only permitted import from `@/App` is the default `App` component (entry mounting and shell tests).

## Consequences

- `application/logs/logRuntime.ts` and `application/debugging/debuggingRuntime.ts` no longer import from the UI entry; the action-type dependency now points application → application.
- Reducer slice tests (`reducerReview`, `reducer.debugging`, `reducer.logAdmin`, `reducer.userPermissions`, `appReducer.parameterAdmin`) exercise the state module directly.
- The state module still imports `PrototypeState` and seed-adjacent values from `@/mockData`, and one mock-notifications helper from `@/infrastructure/mock/` — pre-existing facts moved verbatim, tracked as the architecture-review C2/C6 follow-ups (see `docs/exec-plans/active/2026-08-12-app-shell-decomposition.md`). This ADR does not settle where `PrototypeState` finally lives.
- Splitting the reducer switch into per-domain slice files is now a local change inside `application/state/` and needs no further ADR.
