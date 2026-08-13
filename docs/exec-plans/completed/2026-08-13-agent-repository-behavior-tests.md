# Agent Repository Behavior Tests (TD-079 slice)

Status: **Completed** (PR #392)

## Goal

Retire the SQL-substring assertions in `server/modules/agent/repository.test.ts` (14 tests, 34 `toContain` assertions against a recording fake) for behavior-level coverage:

- New `repository.integration.test.ts` — 7 behavior tests against Postgres via `createInMemoryTestDatabase()`: session round-trip with the normalized `AgentContext` projection, message ordering + citation round-trip with org/session scoping, tool-call round-trip with row-count update semantics and coalesce partial updates, terminal-status guard with idempotent repeats, approval linking in tool-call lists, single-shot pending-guarded approval decisions (approve/reject, cross-tenant refusals), and rejection reasons.
- The old file keeps only what a real database cannot exercise: JSON **driver-boundary resilience** (JSONB arriving as a string; malformed JSON falling back to safe defaults), renamed to state that scope.

## Old → new mapping

| Old test | New coverage |
| --- | --- |
| creates sessions with scoped context | round-trips a session with its JSONB context, invisible to other tenants |
| maps session rows into DTOs | same (full-record read-back) |
| maps session context when JSONB arrives as a string | **kept** (driver-boundary resilience) |
| falls back safely for malformed JSON strings | **kept** (driver-boundary resilience) |
| creates messages, tool calls, approvals, and approval decisions | appends messages…; round-trips a tool call…; approval decisions are single-shot… |
| loads a scoped tool call with session and project metadata | round-trips a tool call and reports update success by row count |
| loads a pending approval with tool call payload for approved execution | approval decisions are single-shot and pending-guarded |
| returns update success from tool call rowCount and keeps scoped updated SQL | round-trips a tool call and reports update success by row count (incl. cross-tenant false) |
| guards terminal tool call status updates while allowing idempotent updates | guards terminal tool-call statuses while allowing idempotent repeats |
| casts the status update parameter for PostgreSQL | subsumed: the real database executes the cast |
| returns approval decision success from rowCount and keeps pending guard | approval decisions are single-shot and pending-guarded |
| lists messages with organization/session filters and maps JSON string citations | appends messages and lists them in order… (filters as behavior); string-citation mapping kept in resilience file |
| lists tool calls with organization/session filters and maps JSON string payload and result | lists tool calls for the session with the linked approval id; string mapping kept in resilience file |

## Verification

- `vitest run server/modules/agent`: 185 tests green (both identity modes for the new file)
- `tsc -b` clean; `npm run docs:check` green

## Documentation Impact Matrix

| Area | File(s) | Impact |
| --- | --- | --- |
| Planning docs | `docs/PLANS.md`, this plan | Update |
| Tech debt | `docs/exec-plans/tech-debt-tracker.md` | Update (TD-079 progress) |
| All other areas | — | No change (test-only) |

## Documentation Update Gate

- [x] `docs/PLANS.md` lists this plan
- [x] TD-079 row updated
- [x] `npm run docs:check` green
- [ ] Move to `completed/` after merge
