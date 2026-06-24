# Frontend

> Chinese: [Chinese](zh-CN/frontend.md)

WiseEff frontend is a Vite, React, TypeScript SPA. It supports a rich mock-backed prototype plus API mode for the M0-M6.2 productized backend surface.

## Key Directories

- `src/app/`: page routing, navigation, permission checks.
- `src/domain/`: role, parameter, log, debugging, audit, and Agent domain types and pure logic.
- `src/application/ports/`: frontend-facing business interfaces.
- `src/infrastructure/mock/`: mock state and mock implementations for demos/tests.
- `src/infrastructure/http/`: API client, DTOs, auth client, runtime mode.
- `src/components/`: reusable UI, layout, tables, dialogs, filters, charts.
- `src/features/agent/`: unified Agent UI and Xiaoze CopilotKit surface (`XiaozeProvider`, `useXiaozePageContext`, `XiaozeApprovalCard`, frontend tools).
- `src/test/setup.ts`: Vitest DOM setup.

## Runtime Modes

Default mode is `api`. `npm run dev` and `npm run dev:all` inject API runtime settings; copy `.env.example` to `.env` for the same defaults when using other Vite entrypoints.

```text
VITE_WISEEFF_RUNTIME_MODE=api
VITE_WISEEFF_API_BASE_URL=http://127.0.0.1:8787
```

Use `mock` only for frontend-only demos or component tests that should not call the backend:

```text
VITE_WISEEFF_RUNTIME_MODE=mock
```

Production builds must not use mock runtime as a business data source.

M6.2 OIDC runtime support uses an async authorization provider so API clients can request the current access token and handle refresh/logout failures without static bearer injection. `VITE_WISEEFF_API_AUTHORIZATION` remains a local static-token convenience and is rejected by production builds.

When API mode starts, the app calls `/api/v1/me` before rendering the main shell. If the current token is missing or rejected, it shows the WiseEff auth screen with local account login and registration forms. Local login uses username and password. Registration collects one of the localized hardware/software department organization choices, name, a self-service platform role, username, and password. The registration role picker excludes Admin. Hardware/Software Committer requests create an inactive account with the matching base User role plus a pending Admin approval request; `/api/v1/auth/register` returns `202 pending_approval` without a session token, and the auth screen stays on a pending-approval result state without the editable registration form until an Admin approves the request from `/user-permissions`. Successful local login or non-committer registration stores the opaque `we_local_*` session token in `localStorage` under `wiseeff.localAuthToken`; the default API client prefers an OIDC runtime token when one is available and otherwise falls back to this local token. The topbar user menu opens the current-user profile dialog and logout action. Profile updates call `PATCH /api/v1/me/profile`; logout calls `POST /api/v1/auth/logout` and clears the local token.

`/user-permissions` uses the user-governance HTTP client in API mode for listing users, creating local-account users, activation changes, profile updates, and role replacement. The Admin Add User dialog creates an active local account in the current Admin organization with `name`, `username`, optional job title, initial password, and initial role; it no longer uses email as the account identifier. API-mode rows hydrate from `/api/v1/users`, including local usernames, before operators make changes, so UI rows use backend governed ids instead of mock ids. UI permission checks remain UX only; backend `/api/v1/users` routes enforce `users:manage`, self-lockout protection, credential hashing, and audit.

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

`DebuggingGateway` is the frontend port for M3 device debugging. Page components call runtime actions from `src/application/debugging/debuggingRuntime.ts`; those actions keep mock/HDC demos available outside API mode and call the HTTP gateway in API mode for HDC or ADB sessions.

Runtime split:

- `mock` mode keeps `/debugging` reducer behavior for demos and component tests.
- Local HDC helpers remain available for non-API `/node-debugging` experiments.
- `api` mode uses `src/infrastructure/http/debuggingClient.ts` for HDC/ADB devices, targets, parameters, sessions, node reads, node writes, snapshot rollback, and session events.

### Local Device Bridge (Phase 1–2)

`/node-debugging` includes a Windows-first local bridge connect panel for self-hosted API mode. The frontend reads bridge release metadata from `/api/v1/device-bridges/releases`, creates pairing codes from `/api/v1/device-bridges/pairing-codes`, and lists user-owned bridges from `/api/v1/device-bridges/mine` through `src/infrastructure/http/deviceBridgeClient.ts`. The browser bridge-health probe (`http://127.0.0.1:18787/health`) is UI guidance only; bridge-backed device execution remains server-authorized through debugging sessions and audit.

Phase 2 adds bridge management in the same panel: operators can rename a bridge machine label (`PATCH /api/v1/device-bridges/:bridgeId`), revoke a bridge token (`POST /api/v1/device-bridges/:bridgeId/revoke`), and view last-seen/online status. Rename and revoke require `debugging:use` and only affect bridges owned by the authenticated user.

When detect returns targets from more than one online bridge, `/node-debugging` shows a bridge target picker with `machineLabel · targetRef` labels and requires an explicit selection before `detectAndStartSession` creates the debugging session. Single-bridge detect still auto-starts the session. Bridge RPC supports both `adb` and `hdc`; the connect panel and multi-bridge picker appear when the page protocol is `adb` (the default bridge-backed path in API mode).

`/debugging-admin` uses API-backed catalog management in `api` mode. It calls `src/infrastructure/http/debuggingAdminClient.ts` to list, create, update, archive, restore, and bind debug parameters. `mock` mode keeps the local `configDraft` and JSON editing path for demos and component tests.

### Debugging Admin UI

Page shell lives in `src/DebuggingAdminPage.tsx` (mirrors the `/parameter-admin` rhythm). The main surface is a full-width catalog table; create/edit/archive flows open modal dialogs instead of a split list-plus-inline-editor layout.

- `DebugParameterLibraryTable` — toolbar search, risk chips, module multi-select, coverage/status filters, and row actions.
- `DebugParameterDefinitionDialog` — metadata editor opened from the row **Edit** action (save; restore when archived).
- `DebugParameterBindingsDialog` — HDC and ADB binding panels opened from **Path bindings**.
- `CreateDebugParameterDialog` — empty draft plus default bindings, opened from the table **Add parameter** action.
- `ArchiveDebugParameterDialog` — confirm archive from a row action or the definition dialog.

Complex debug parameters use `src/debugValueKind.ts` helpers shared by admin and runtime surfaces. `DebugParameterDefinitionDialog` exposes value kind, format, normalization mode, and multiline code editors for complex current/target values. `DebugParameterLibraryTable` shows a compact format badge. `/node-debugging` renders complex values as compact previews with format badges, opens a wide sheet for inspect/edit, and shows operation-history preview plus digest instead of full payloads.

URL-synced filters and dialog deep links use `useDebugAdminSearch`. Mock mode keeps a collapsible config-source preview footer below the table for `power-management.json` export/sync.

The runtime coordinator hydrates devices and debugging parameters after auth, detects `Aurora Simulator 1`, starts a session, dispatches node operations into operation history, and records valid write snapshots returned by the API. A current residual gap is that snapshots created from `/node-debugging` writes are not yet promoted into `/debugging`'s `lastDebugSnapshot` rollback card; the M3 E2E therefore verifies rollback through the API if that UI affordance is disabled.

The M3 API smoke lives in `e2e/debugging.api.spec.ts` and requires `DATABASE_URL` plus `db:migrate`, `db:seed:m0`, `db:seed:m1`, and `db:seed:m3`. Playwright starts the backend with `DEBUG_DEVICE_GATEWAY_MODE=simulator` and the frontend with `VITE_WISEEFF_RUNTIME_MODE=api`.

## Agent Gateway

`AgentGateway` is the frontend port for M4 WiseAgent API mode. `src/infrastructure/http/agentClient.ts` maps it to `/api/v1/agent` sessions, messages, persisted tool-call runs, and approval approve/reject endpoints.

Runtime split:

- `mock` mode preserves the existing UnifiedAgent plan prompts, local messages, and confirmation behavior for demos and component tests.
- `api` mode creates an Agent session from the current path, page key, project, role, and auth context, then sends prompts through `sendMessage`.
- API-mode quick prompts and plan actions also enter through `sendMessage`; the persisted tool-call run endpoint is only for existing backend-created toolCall ids.

`UnifiedAgent` renders API assistant confidence as a percentage and shows citations from returned messages. Approval-required tool calls open the existing confirmation dialog and call `approveToolCall` or `rejectToolCall`; mutating tools remain backend-gated by approval state, authz, and audit.

The frontend contract for WiseAgent is unchanged. Xiaoze uses CopilotKit/AG-UI directly against `/api/v1/agent/xiaoze`.

## Xiaoze (P0 perception + P1 action + P2 planning)

When `VITE_XIAOZE_ENABLED=true`, the app mounts `XiaozeProvider` (`@copilotkit/react-core/v2` + `@ag-ui/client` `HttpAgent`) and streams AG-UI events from `POST /api/v1/agent/xiaoze`. `UnifiedAgent` registers page-visible state through `XiaozePageContextRegistrar` (`useAgentContext` with description `wiseeff.page`).

P0: read-only `perception.*` tools.

P1 adds `XiaozeApprovalCard` (`useInterrupt`) for mutating `action.submitParameterChange` proposals (approve / reject / edit target value) and low-risk frontend tools (`navigateTo`, `prefillParameterValue`) via `useFrontendTool`.

P2 adds a LangGraph planning loop on the backend (intent → perceive → plan → act → observe) with checkpoint resume after approval, and opt-in proactive suggestions via `useXiaozeSuggestions` mounted in `AgentInsightBar`. When `VITE_XIAOZE_PROACTIVE_ENABLED=true` (and the API flag is on), the hook calls `POST /api/v1/agent/xiaoze/suggest` for the current page context; insight actions can open Xiaoze chat pre-seeded with the suggestion headline.

| Flag | Default | Purpose |
| --- | --- | --- |
| `VITE_XIAOZE_ENABLED` | `false` | Enables CopilotKit Xiaoze chat and page-context registration. |
| `VITE_XIAOZE_PROACTIVE_ENABLED` | `false` | Enables proactive read-only suggestions in `AgentInsightBar` via `useXiaozeSuggestions`. Requires API `XIAOZE_PROACTIVE_ENABLED=true`. |
| `XIAOZE_RUNTIME_ENABLED` (API) | `false` | Registers the AG-UI SSE endpoint and LangGraph planning agent. |
| `XIAOZE_PROACTIVE_ENABLED` (API) | `false` | Registers `POST /api/v1/agent/xiaoze/suggest` for read-only proactive suggestions. |
| `XIAOZE_DETERMINISTIC` (API) | `false` | Offline deterministic model for acceptance/tests (no live LLM). |
| `XIAOZE_MODEL` (API) | falls back to `AGENT_MODEL` | Model name for LangChain `ChatOpenAI`. |

The M4 API smoke lives in `e2e/agent.api.spec.ts` and requires `DATABASE_URL` plus `db:migrate`, `db:seed:m0`, and `db:seed:m1`.

## Identity And User Governance

M6.2 moves target production identity to OIDC while preserving the existing `AuthContext` shape returned by `/api/v1/me`. API-mode clients send `Authorization: Bearer <oidc-access-token>` through `createOidcAuthProvider` or the selected runtime handoff. Local HMAC smoke tokens are acceptable only for local development and deterministic tests.

WiseEff local accounts use the same `AuthContext` shape after login. Registration creates a local account with the selected organization and an allowed self-service platform role; email verification is not supported yet. Admin cannot be selected during registration. Committer requests remain inactive and unauthenticated until an Admin approves them, at which point the backend activates the user and replaces the base role with the requested Committer role. The frontend treats permission checks as UX only, so API-mode writes still depend on backend authorization and audit.

The user-governance client maps `/api/v1/users` responses into frontend `UserAccount` records, including local usernames when present. Creating a user through `/user-permissions` posts `name`, `username`, `password`, optional `title`, and role bindings using the platform role ids: `guest`, `hardware-user`, `software-user`, `hardware-committer`, `software-committer`, and `admin`. Admin-created users are active immediately because the Admin action is already authenticated and audited; self-registered Committer users still use `/api/v1/users/registration-role-requests` and the Admin approval queue.

## M5 Pilot Gate

M5 does not add a new frontend surface yet, but it does add the release smoke that guards the backend pilot boundary. `npm run smoke:m5` checks the OpenAPI contract artifact, `/health/live`, `/health/ready`, and `/api/v1/operations/pilot-readiness`. It requires a live API base URL by default and only skips with `M5_SMOKE_ALLOW_NO_API=true` for local documentation runs. `npm run test:m5` is the intended full pilot gate when PostgreSQL and the other environment-specific checks are available, and it invokes the smoke with `--require-api` so the live API probe cannot be skipped.

## Commercial Readiness Notes

M3.5 and M5 keep the frontend architecture unchanged: pages still call `application/ports`, mock mode remains available for demos/tests, and API mode remains the production-oriented path. The backend now reflects `X-Request-Id` and propagates it into M1 parameter, M2 log, and M3 debugging audit traces, so HTTP client calls can be correlated with backend audit evidence.

Before treating API mode as a commercial pilot baseline, run `npm run test:m3-5` in an environment with `DATABASE_URL`. That command includes frontend tests, backend tests, production build, and the simulator debugging API smoke.
M5 extends that baseline with the release smoke and pilot acceptance artifact. Do not call the environment pilot-ready until `docs/generated/m5-pilot-acceptance.md` records the external checks that were actually exercised.

## Frontend Rules

- Keep business rules out of page components when they can live in `domain/` or a focused view-model file.
- Keep API DTO mapping in `infrastructure/http/`.
- Do not let UI permission checks become the security boundary; backend writes must enforce permissions.
- Preserve mock mode when adding API mode unless the task explicitly removes a prototype path.
- Prefer existing component patterns and tests before adding new primitives.

## Button And Action Styling

Buttons must look and behave like buttons. Do not rely on a bare `.button` class, raw `<button>` browser defaults, or text-only styling for actions that mutate state, submit forms, close dialogs, navigate workflows, or open menus. Use the existing button component or an established local variant; if a scoped button variant is needed, define the full visual contract in that scope:

- layout: `inline-flex`, centered content, stable `min-height`, and stable `min-width` or icon-only square dimensions;
- surface: explicit `background`, `border`, `border-radius`, text color, and disabled opacity/cursor;
- hierarchy: clear primary, secondary/subtle, destructive, or ghost treatment instead of two equal-looking text labels;
- interaction: hover and focus-visible states, with focus rings that remain visible on light and dimmed modal backdrops;
- responsive behavior: buttons must not collapse to bare text, overlap siblings, overflow their container, or change layout unexpectedly across desktop, tablet, and mobile widths.

Dialog footers, table row actions, topbar actions, card actions, and toast actions are common regression points. When changing them, add a focused DOM assertion for the intended button variant or class and run browser verification that captures the relevant state. The browser check should explicitly confirm that primary and secondary actions have visible surface styling, stable dimensions, and no horizontal overflow. Text-only actions are acceptable only for low-emphasis links or inline affordances, and should use a link/text-action class rather than masquerading as a button.

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
