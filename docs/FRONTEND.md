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

Testing priorities:

- Role and permission visibility.
- Workbench filters, sorting, table states, and dialogs.
- Agent actions and confirmation behavior.
- Runtime mode parsing and API error mapping.
- Domain pure functions and DTO conversions.
