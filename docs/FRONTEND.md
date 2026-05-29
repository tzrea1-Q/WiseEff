# Frontend

WiseEff frontend is a Vite, React, TypeScript SPA. It currently supports a rich mock-backed prototype plus M0 seams for API mode.

## Key Directories

- `src/app/`: page routing, navigation, permission checks.
- `src/domain/`: role, parameter, log, debugging, audit, and Agent domain types and pure logic.
- `src/application/ports/`: frontend-facing business interfaces.
- `src/infrastructure/mock/`: mock state and mock implementations for demos/tests.
- `src/infrastructure/http/`: API client, DTOs, auth client, runtime mode.
- `src/components/`: reusable UI, layout, tables, dialogs, filters, charts.
- `src/features/agent/`: unified Agent UI.
- `src/test/setup.ts`: Vitest DOM setup.

## Runtime Modes

Default mode is `mock`, which supports demos and frontend development.

API mode:

```text
VITE_WISEEFF_RUNTIME_MODE=api
VITE_WISEEFF_API_BASE_URL=http://127.0.0.1:8787
```

Production builds must not use mock runtime as a business data source.

## Parameter Repository

`ParameterRepository` is the frontend port for parameter-management workflows. Page components call runtime actions from `src/application/parameters/parameterRuntime.ts`; those actions dispatch local reducer updates in `mock` mode and call a repository in `api` mode.

In `mock` mode, `src/infrastructure/mock/mockParameterRepository.ts` preserves prototype behavior for demos and component tests. It can list projects and parameters, stash drafts, submit rounds, advance reviews, and apply import previews against the in-memory mock state.

In `api` mode, `src/infrastructure/http/parameterClient.ts` maps `ParameterRepository` calls to `/api/v1` endpoints and DTO adapters. Parameter pages hydrate projects, parameters, drafts, change requests, and submission rounds from the backend, then refresh after write actions.

Page action flow:

- `/parameters` filters project parameters, opens details/history, creates local drafts, submits selected draft items, and sends assignees to the submission API.
- `/parameter-review` lists pending and merged requests, advances or rejects workflow steps through `reviewChange`, and refreshes state after each server response.
- `/parameter-admin` keeps direct library editing in mock mode; in API mode, parameter writes go through import batches or review flows instead of mutating client state directly.

The M1 API smoke lives in `e2e/parameter-management.api.spec.ts` and requires `DATABASE_URL` plus `db:migrate`, `db:seed:m0`, and `db:seed:m1`.

## Log Analysis Repository

`LogAnalysisRepository` is the frontend port for M2 log-analysis workflows. Page components call runtime actions from `src/application/logs/logRuntime.ts`; those actions keep mock demos responsive in `mock` mode and call a repository in `api` mode.

In `mock` mode, uploads use the reducer's simulated log path: supported `.log`, `.txt`, and `.json` files become processing records that can be promoted through prototype state, while unsupported files become failed mock records. This keeps component tests and demos independent from PostgreSQL and object storage.

In `api` mode, `src/infrastructure/http/logClient.ts` maps the port to `/api/v1/log-files`, `/api/v1/logs`, `/api/v1/jobs`, archive/unarchive, rerun, and feedback endpoints. Uploads send base64 file content, hydrate the created `LogRecord`, poll the job until a terminal state, then refresh the completed report and evidence. Archive and feedback actions refresh active logs afterward, so default `/logs` excludes archived records.

The M2 API smoke lives in `e2e/log-analysis.api.spec.ts` and requires `DATABASE_URL` plus `db:migrate`, `db:seed:m0`, `db:seed:m1`, and `db:seed:m2`.

## Debugging Gateway

`DebuggingGateway` is the frontend port for M3 device debugging. Page components call runtime actions from `src/application/debugging/debuggingRuntime.ts`; those actions keep mock/HDC demos available outside API mode and call the HTTP gateway in API mode.

Runtime split:

- `mock` mode keeps `/debugging` reducer behavior for demos and component tests.
- Local HDC helpers remain available for non-API `/node-debugging` experiments.
- `api` mode uses `src/infrastructure/http/debuggingClient.ts` for devices, targets, parameters, sessions, node reads, node writes, snapshot rollback, and session events.

The runtime coordinator hydrates devices and debugging parameters after auth, detects `Aurora Simulator 1`, starts a session, dispatches node operations into operation history, and records valid write snapshots returned by the API. A current residual gap is that snapshots created from `/node-debugging` writes are not yet promoted into `/debugging`'s `lastDebugSnapshot` rollback card; the M3 E2E therefore verifies rollback through the API if that UI affordance is disabled.

The M3 API smoke lives in `e2e/debugging.api.spec.ts` and requires `DATABASE_URL` plus `db:migrate`, `db:seed:m0`, `db:seed:m1`, and `db:seed:m3`. Playwright starts the backend with `DEBUG_DEVICE_GATEWAY_MODE=simulator` and the frontend with `VITE_WISEEFF_RUNTIME_MODE=api`.

## Agent Gateway

`AgentGateway` is the frontend port for M4 WiseAgent API mode. `src/infrastructure/http/agentClient.ts` maps it to `/api/v1/agent` sessions, messages, persisted tool-call runs, and approval approve/reject endpoints.

Runtime split:

- `mock` mode preserves the existing UnifiedAgent plan prompts, local messages, and confirmation behavior for demos and component tests.
- `api` mode creates an Agent session from the current path, page key, project, role, and auth context, then sends prompts through `sendMessage`.
- API-mode quick prompts and plan actions also enter through `sendMessage`; the persisted tool-call run endpoint is only for existing backend-created toolCall ids.

`UnifiedAgent` renders API assistant confidence as a percentage and shows citations from returned messages. Approval-required tool calls open the existing confirmation dialog and call `approveToolCall` or `rejectToolCall`; mutating tools remain backend-gated by approval state, authz, and audit.

The M4 API smoke lives in `e2e/agent.api.spec.ts` and requires `DATABASE_URL` plus `db:migrate`, `db:seed:m0`, and `db:seed:m1`.

## M5 Pilot Gate

M5 does not add a new frontend surface yet, but it does add the release smoke that guards the backend pilot boundary. `npm run smoke:m5` checks the OpenAPI contract artifact, `/health/live`, `/health/ready`, and `/api/v1/operations/pilot-readiness`. It requires a live API base URL by default and only skips with `M5_SMOKE_ALLOW_NO_API=true` for local documentation runs. `npm run test:m5` is the intended full pilot gate when PostgreSQL and the other environment-specific checks are available, and it invokes the smoke with `--require-api` so the live API probe cannot be skipped.

## Commercial Readiness Notes

M3.5 keeps the frontend architecture unchanged: pages still call `application/ports`, mock mode remains available for demos/tests, and API mode remains the production-oriented path. The backend now reflects `X-Request-Id` and propagates it into M1 parameter, M2 log, and M3 debugging audit traces, so HTTP client calls can be correlated with backend audit evidence.

Before treating API mode as a commercial pilot baseline, run `npm run test:m3-5` in an environment with `DATABASE_URL`. That command includes frontend tests, backend tests, production build, and the simulator debugging API smoke.
M5 extends that baseline with the release smoke and pilot acceptance artifact. Do not call the environment pilot-ready until `docs/generated/m5-pilot-acceptance.md` records the external checks that were actually exercised.

## Frontend Rules

- Keep business rules out of page components when they can live in `domain/` or a focused view-model file.
- Keep API DTO mapping in `infrastructure/http/`.
- Do not let UI permission checks become the security boundary; backend writes must enforce permissions.
- Preserve mock mode when adding API mode unless the task explicitly removes a prototype path.
- Prefer existing component patterns and tests before adding new primitives.

## Testing

Use targeted tests while editing:

```bash
npm test -- src/path/to/test.tsx
```

Use broader checks before finishing frontend-impacting changes:

```bash
npm test
npm run build
```

Commercial-readiness gate:

```bash
npm run test:m3-5
```

Agent acceptance gate:

```bash
npm run test:m4
```

Testing priorities:

- Role and permission visibility.
- Workbench filters, sorting, table states, and dialogs.
- Agent actions and confirmation behavior.
- Runtime mode parsing and API error mapping.
- Domain pure functions and DTO conversions.
