# Xiaoze action tool submits through typed binding drafts (TD-078)

> Status: **Active**
> Date: 2026-08-12
> Branch: `fix/xiaoze-action-semantic-submit` (stacked on `fix/xiaoze-approval-chain-single-seam`, merged via PR #319)
> Chinese: [`docs/zh-CN/exec-plans/active/2026-08-12-xiaoze-action-semantic-submit.md`](../../zh-CN/exec-plans/active/2026-08-12-xiaoze-action-semantic-submit.md)

## Goal

Close **TD-078**: `action.submitParameterChange` still submitted the retired flat shape (`items: [{parameterId, targetValue, reason}]`), so after the semantic identity cutover every approved Xiaoze write failed at execution with "Legacy parameter submission is retired". The tool now walks the legitimate post-cutover path — resolve the binding head revision, create a typed binding draft (`createBindingDraft`: schema validation, write lock, candidate revision, fail-closed toolchain), then `submitParameterChanges` with the draft identity and `actorType: "agent"` — and the `xiaoze-action` acceptance spec drops its retired `project_parameter_value_id` predicates.

## Non-goals

- Widening the tool beyond `action: "set"` (no delete/enablement surface for the agent).
- Repairing the broader acceptance-governance drift (TD-075) beyond this spec's schema fixes.
- Making the CI acceptance database post-cutover (recorded as TD-079).

## Git & PR Workflow

| Role | Allowed |
| --- | --- |
| Implementation agent | Commit on `fix/xiaoze-action-semantic-submit`; do not open or merge GitHub PRs |
| Parent agent | Review, run verification, open/merge the PR, then sync local `main` |

## Design decisions

- **Two-step semantic path, same actor.** Drafts are actor-bound (`user_id`); the agent has no separate principal, so the draft created with the caller's `AuthContext` is submittable in the same request. A failed submission best-effort deletes the agent-created draft so it does not park in the user's workbench.
- **Early sensitive-node guard stays.** `assertSensitiveNodeWriteAllowed(actorType: "agent")` runs before any draft/candidate is created (critical hits leave no residue); `submitParameterChanges` re-checks inside the transaction.
- **`targetValue` is DTS source text.** `parseDtsValue` rejects bare literals; the tool returns a format-guiding `VALIDATION_FAILED`, and the tool catalog documents the format (models can mirror `current_value` from `perception.searchParameters`, whose `id` is exactly the binding id the tool needs).
- **No silent shape guessing** (TD-065 spirit): unparseable values fail loudly instead of being coerced.
- **`resolveBindingHeadRevisionId`** is extracted from `resolveBindingWriteLock` in `editService` and reused by both, instead of duplicating the head-revision SQL in the tool.
- The retired raw-INSERT fallback (fake change request without target value) is replaced by an explicit `INTERNAL_ERROR` when the database is not transactional.

## Tasks

1. `server/modules/agent/tools/actionTools.ts`: semantic submission (above); `server/modules/parameter-topology/editService.ts`: export `resolveBindingHeadRevisionId`.
2. Thread `objectStore` (and test-only `toolchain`) through `createAgentToolRegistry`, `createXiaozeAgentFactory`, `registerXiaozeRoutes`, and `server/app.ts`.
3. `toolCatalog.ts`: document binding-id + DTS-text contract in the tool description and schema.
4. Tests: rewrite `actionTools.test.ts`; extend `actionTools.sensitiveNode.test.ts` and `agUiEndpoint.assembly.test.ts`; add **non-mocked** `actionTools.integration.test.ts` (real pglite schema: draft → change request, critical sensitive refusal without residue, 404 without residue).
5. `e2e/acceptance/xiaoze-action.acceptance.spec.ts`: resolve a seeded binding at runtime (retired flat id removed), switch predicates to `project_parameter_binding_id`, use DTS cell values derived from the binding's current value.
6. Docs: tracker TD-078 → Completed, new TD-079 (CI acceptance DB is pre-cutover); `docs/SECURITY.md` + zh Xiaoze P1 sentence; `docs/PLANS.md` + zh entries.

## Verification results (2026-08-12)

- `npx vitest run server/modules/agent --config vitest.server.config.ts`: 34 files green, including the new integration file (real schema, no parameters-module mocks) proving draft → change-request with `target_value` equal to the tool's raw text and the draft deleted after submission.
- `npx vitest run server/modules/parameter-topology/editService.test.ts`: 28 green (extraction is behavior-preserving).
- `acceptance:coverage` / `acceptance:operations`: green with the new requirement/operation registry entries (landed on the base branch).
- Local full-spec acceptance is blocked by the pinned toolchain (`dt-validate` not installed locally); the CI acceptance job installs the pinned toolchain and exercises the full path. Note the CI acceptance database is **pre-cutover** (legacy shape still accepted there), which is why TD-078 never surfaced in CI — recorded as TD-079.

## Documentation Impact Matrix

| Area | Action | Paths |
| --- | --- | --- |
| Repository maps | No change | Module set and seams unchanged |
| Planning | Update | This plan + zh companion; `docs/PLANS.md` + `docs/zh-CN/PLANS.md` |
| Domain / ADR | No change | ADR-0024 unaffected; no new durable decision beyond the documented tool contract |
| Product specs | No change | Approval UX unchanged; the tool now actually completes what the spec already promised |
| Architecture | No change | `ARCHITECTURE.md` describes the approval chain, not the submission shape |
| Quality / testing | Update | Acceptance spec (schema-drift repair); registries updated on the base branch |
| Reliability / runbooks | No change | No operational procedure change |
| Security / governance | Update | `docs/SECURITY.md` + `docs/zh-CN/SECURITY.md` Xiaoze P1 (typed-binding-draft submission wording) |
| Generated artifacts | No change | No route or schema change |
| Tech debt | Update | TD-078 closed; TD-079 added (CI acceptance DB pre-cutover drift) |

## Documentation Update Gate

- [x] TD-078 moved to Completed with branch + evidence; TD-079 recorded
- [x] `docs/SECURITY.md` + zh state the typed-binding-draft submission path for Xiaoze P1
- [x] `docs/PLANS.md` EN + zh list this plan
- [x] `npm run docs:check` green before moving this plan to `completed/`
