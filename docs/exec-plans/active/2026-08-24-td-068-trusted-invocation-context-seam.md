# TD-068 trusted invocation context seam (#610)

> Chinese: [中文](../../zh-CN/exec-plans/active/2026-08-24-td-068-trusted-invocation-context-seam.md)

Status: #610 implementation and final-tree local CI are complete on `codex/td-068-trusted-invocation-context`; merge-ready under the owner's documented full-local-CI exception while the monthly GitHub Actions quota is exhausted. This plan remains active as the shared migration record: the slice establishes the server-internal context and policy/audit seams, while TD-068 stays Open until #611–#615 land.

## Goal

Provide one branded, server-owned `user` / `agent` / `system` trusted invocation context without changing legacy call sites or public request contracts.

## Scope and implementation

- `server/modules/auth/trustedInvocation.ts`: discriminated context, immutable authenticated-principal snapshots, strict constructors, runtime brand validation, and Agent approval correlation.
- `server/modules/auth/trustedInvocationPolicy.ts`: required-context human-required policy seam with stable `403` refusal details.
- `server/modules/audit/trustedAudit.ts` and `server/modules/audit/auditedWrite.ts`: actor/audit projection plus transaction and pool refusal writers that preserve system null-user semantics.
- Focused tests cover constructor invariants, policy outcomes, actor/audit projection, platform-scoped system audit, and malformed-context failure before a query.
- Existing optional `actorType` callers remain unchanged for later migration tickets. No request DTO, header, body, `/me`, or OpenAPI contract is changed.

## Verification

- Focused trusted-context tests: 3 files, 15 tests passed.
- After rebasing onto repaired main `a57a88806`, the complete final-tree matrix passed: frontend 408 files / 3022 tests; scripts 69 files / 830 passed / 5 skipped; bridge 21 files / 138 tests; server 355 files passed / 1 skipped and 2739 tests passed / 4 skipped.
- `npm run build`, `npm run contract:check`, `npm run docs:check`, `npm run acceptance:ci`, the required DTS toolchain check (dtc/fdtoverlay 1.8.1 and dtschema 2026.6), and the three-project DTS seed compile passed against an isolated pgvector database.
- `npm run lint` completed with 0 errors and the 299-warning frontend baseline. `git diff --check origin/main...HEAD` passed.
- `npm run ui:check` passed with every ratchet at baseline. `npm run logs:eval` passed 16/16 scenarios and 4/4 meta checks; generated timestamps were restored and not committed.
- The inherited main-red visual failures were repaired independently by #617 / PR #619 without changing any committed PNG. On this final #610 tree, workflow-equivalent MCR Playwright from an empty pgvector database and isolated object root passed `acceptance:quality` and all 97/97 quality tests. A separate empty database and object root passed `acceptance:smoke` 4/4 under the CI production-HMAC profile.
- Final Standards and Spec reviews were run separately against `origin/main...HEAD`; each reported zero findings. GitHub checks that cannot run because of the exhausted quota are not described as green; the owner explicitly approved the complete final-tree local matrix as merge authority.

## Follow-up boundary

Tickets #611–#615 construct context at HTTP/Xiaoze/system entry points and migrate the five DTS reload mutations and parameter-sensitive production writes. This plan does not close TD-068, refactor unrelated audits, or claim target/device readiness.

## #611 implementation checkpoint

- [x] Xiaoze read-only and approval-gated tool calls receive server-owned durable tool-call ids and persist through the orchestrator/tool-registry seam.
- [x] Execution reconstructs `AgentInvocationContext` from the active authenticated principal plus persisted session, tool-call, and approval records.
- [x] Approval resume validates session/tool-call/approval correlation before execution; edited arguments replace the persisted payload and are re-authorized in the same transaction.
- [x] Request-local auth, invocation, and approval data remain outside checkpoint channel state; missing durable resume correlation fails before execution.
- [ ] #612–#615 remain open follow-up migrations.

## #611 verification

- Focused Xiaoze/orchestrator/AG-UI tests passed: 5 files, 57 tests.
- Full server suite passed on this branch: 354 files passed, 2 skipped; 2738 tests passed, 8 skipped.
- `npm run build`, `npm run contract:check`, `npm run docs:check`, and `git diff --check` passed. The local database-schema portion of `docs:check` was skipped because pgvector is unavailable on this host.

## #611 repair addendum (historical pre-final-rebase checkpoint)

The #610 history and verification above are retained unchanged. This historical #611 repair checkpoint was recorded on:

- Branch: `codex/td-068-durable-agent-provenance`
- Base: `origin/main@f52038848`
- Repair commit: `0dd0b39c6` (`fix(agent): close durable Xiaoze execution gaps (#611)`)
- Boundary: reuse the #610 trusted invocation context seam; require a persistent `AgentOrchestrator` at `createXiaozeAgentFactory`; route proactive read-only perception through the same durable orchestrator; and pass one transaction authorization proof through the public `ToolRegistry.run` seam. No new provenance foundation, temporary UUID, or test-only execution fallback was added.
- Every executing Xiaoze tool, including read-only perception, now obtains its persisted session/tool-call record through the orchestrator. Read-only contexts carry the persisted `sessionId` and `toolCallId`, with `approvalId: null`.

The PostgreSQL durable-resume proof creates the session, action tool call, approval, and interrupt through public AG-UI input in instance A. Instance B then uses a fresh PostgreSQL connection, checkpointer, registry, orchestrator, and the same authenticated principal to resume from the persisted checkpoint. The public registry execution seam captures and asserts `initiator: agent`, the unchanged user/organization principal, and the persisted session/tool-call/approval ids. It also asserts that `editedArgs` is the complete persisted payload replacement, that the replacement is re-authorized once inside the transaction, and that the authorization proof is passed into execution before the domain-write seam.

The same public resume path rejects a different approval id, a different body thread, an approval/tool-call mismatch, a tool-call/checkpoint mismatch, another user in the organization, and another organization. Each rejection occurs before `ToolRegistry.run`; the integration seam observes no additional execution and no domain write, while the pending durable rows remain pending.

### #611 repair verification

- TDD red evidence: the focused factory/orchestrator command first reported 2 failing tests (missing persistent-orchestrator enforcement and duplicate-authorization expectation); the suggest-route test first reported 1 failing persistence/context assertion while the old direct registry fallback was temporarily present.
- Focused green command passed: `npm run test:server -- server/modules/agent/orchestrator.test.ts server/modules/agent/toolRegistry.test.ts server/modules/agent/xiaoze/agUiEndpoint.test.ts server/modules/agent/xiaoze/agUiEndpoint.concurrency.test.ts server/modules/agent/xiaoze/agUiEndpoint.assembly.test.ts server/modules/agent/xiaoze/planningGraph.test.ts server/modules/agent/xiaoze/durableAgentResume.integration.test.ts server/modules/agent/xiaoze/suggestRoutes.test.ts` — 8 files, 73 tests passed.
- PostgreSQL durable-resume command passed: `npm run test:server -- server/modules/agent/xiaoze/durableAgentResume.integration.test.ts server/modules/agent/xiaoze/suggestRoutes.test.ts` — 2 files, 8 tests passed.
- Full server command passed: `npm run test:server` — 355 files passed, 2 skipped; 2743 tests passed, 8 skipped.
- `npm run build` passed (`tsc -b` and Vite build); Vite retained the existing large-chunk warning.
- `npm run contract:check` passed: OpenAPI contract artifact is current.
- `npm run docs:check` passed. Its database-schema/pgvector check was skipped because the host does not provide the pgvector extension; CI remains the pgvector/pgvector:pg16 verification boundary.
- `npm run lint` passed with 0 errors and the existing 299 frontend warnings.
- Verification-matrix acceptance specs were run separately with isolated ports and object roots, not the running 5173/8787 services. `xiaoze-perception.acceptance.spec.ts` at frontend `5175` / API `18787` with `/tmp/wiseeff-611-perception.47mXaE` passed 4/4 including warmup. `xiaoze-action.acceptance.spec.ts` at frontend `5176` / API `18788` with `/tmp/wiseeff-611-action.73LvlO` completed 6 passed, 1 skipped, 1 failed; the only failure was the known main-red browser approval-card timeout at `e2e/acceptance/xiaoze-action.acceptance.spec.ts:776` after 60 seconds. The other action flows passed, and this UI baseline issue is outside the #611 durable provenance repair.
- After the plan updates and documentation commit, `git diff --check origin/main...HEAD` passed.

### #611 cleanup repair continuation (historical pre-final-rebase checkpoint)

This continuation is test-only and does not change production behavior, the trusted invocation model, ToolRegistry authorization proof, or AG-UI interfaces.

- Cleanup repair commit: `79d059635` (`test(agent): guarantee durable resume cleanup (#611)`).
- The entire `withTempDatabase` callback is covered by an outer `try/finally`. Instance A and B saver handles are registered immediately after construction, before saver setup can fail; the instance B database connection is registered immediately after creation. The cleanup closes the instance B connection, instance A saver, instance B saver, and shared checkpointer/probe saver in that order, with optional handles and repeated cleanup handled safely.
- Reset of shared saver state is present in the callback `finally` and the surrounding test `finally`. Each cleanup operation catches its own failure so cleanup cannot replace the first setup, interrupt, resume, or assertion error.
- The focused regression deliberately throws after instance A is ready and before instance B is created. It asserts the original sentinel error is preserved and instance A's saver is closed. This covers the failure boundary requested for A setup/interrupt-to-B creation; the same outer boundary also covers B connection/setup and every positive/negative resume assertion.
- TDD red: before this repair, `npm run test:server -- server/modules/agent/xiaoze/durableAgentResume.integration.test.ts` reported 1 failed test (A saver end count 0) and an unhandled PostgreSQL `57P01` connection error. Green: the same file passed 3/3 tests.
- Requested focused command passed: `npm run test:server -- server/modules/agent/xiaoze/durableAgentResume.integration.test.ts server/modules/agent/orchestrator.test.ts server/modules/agent/toolRegistry.test.ts server/modules/agent/xiaoze/agUiEndpoint.test.ts server/modules/agent/xiaoze/planningGraph.test.ts` — 5 files, 60 tests passed.
- Repeated full server command passed: `npm run test:server` — 355 files passed, 2 skipped; 2744 tests passed, 8 skipped.
- Repeated `npm run build` passed with the existing Vite large-chunk warning. `npm run contract:check` passed: OpenAPI contract artifact is current. `npm run lint` passed with 0 errors and 299 existing warnings.
- Parent/current pgvector revalidation used `TEST_DATABASE_URL=postgres://wiseeff:wiseeff@127.0.0.1:5433/wiseeff npm run docs:check` against the local `pgvector/pgvector:pg16` container. Documentation governance passed and `db-schema artifact is current`; the schema check was not skipped.
- After this plan update and its separate documentation commit, `git diff --check origin/main...HEAD` passed.

The preceding #611 repair evidence retains its original host boundary, where the pgvector check was skipped; this cleanup continuation records the later pgvector revalidation above. No PR was opened or merged at that checkpoint. It did not claim complete local CI green because the action UI baseline failure still existed at that time.

## #611 final rebase and landing verification

- Finalization branch/worktree: `codex/td-068-durable-agent-provenance-final` at `/Users/tzrea1/Develop/WiseEff-td611-final`.
- Final rebase base: `origin/main@c9abd61c7bcf1508c7728f330cb6b2e40f4534ba`. The five rebased commits are `8284fc8e0`, `a13550b73`, `be77cd27d`, `9977885a2`, and production/test tip `68d76d88e`; `git range-diff` reported each patch exactly equivalent to its pre-rebase commit.
- The final diff contains only the bilingual active plan and the related `server/modules/agent/**` implementation/tests. The `XiaozeProvider` repair from #625 is inherited from `main` and is not reintroduced by #611.
- Exact-tree PostgreSQL verification passed: the durable-resume file passed 3/3; the five-file Agent focus passed 60/60; the complete server suite passed 356 files with 2747 tests passed and 5 tests skipped.
- `npm run test:all` passed: frontend 411 files / 3048 tests, scripts 69 files / 926 passed / 5 skipped, bridge 21 files / 138 tests, and server 356 files / 2747 passed / 5 skipped. `npm run build`, `npm run contract:check`, pgvector-backed `npm run docs:check`, `npm run lint` (0 errors; existing 299 warnings), `npm run selfhost:check`, `npm run acceptance:ci`, `npm run acceptance:models`, `npm run acceptance:coverage`, `npm run acceptance:operations`, and `git diff --check` passed.
- Owned-runtime Xiaoze acceptance passed on source-clean production/test tip `68d76d88e`: action 7 passed / 1 planned skip, perception 4 passed, two consecutive approval-card runs each passed 2/2 including warmup, and planning passed 3/3 including warmup. The planning run `full-20260825t013501071z-68d76d88e58d-880ccd19` finished with both processes stopped and its exact database/object root removed.
- The earlier approval-card main-red was repaired independently by #625 before this final rebase. Final action evidence confirms the card is visible and approvable, the chat remains open, no domain write occurs before approval, resume completes with Agent provenance, and the open change-request count changes from 0 to 1.
- `npm run acceptance:evidence` was run but did not pass because this focused Xiaoze run does not contain the full P0/P1 operation-record corpus. The command is required when operation-evidence coverage changes; #611 changes neither the operation matrix nor evidence helpers, so this focused-corpus failure is recorded but is not claimed as a pass or used as the #611 landing gate.
- GitHub Actions remain unavailable because the monthly quota is exhausted. The owner authorized the complete exact-tree local matrix as merge authority. The parent/session owner still owns final review, PR creation, merge, issue closure, and local `main` synchronization.

## #612 implementation checkpoint

- Scope: migrate all five DTS reload mutation entries — start-run, restore-baseline, deploy, configuration update, and promote-to-drafts — plus their five HTTP mutation routes to the branded `TrustedInvocationContext` seam.
- HTTP routes construct `createUserInvocation(auth)` inside the server and pass a `TrustedRefusalAuditSink` backed by a server-owned PostgreSQL pool root. Request bodies, query strings, headers, DTO fields, and arbitrary `actorType` strings do not select provenance; the route regression tests cover all five routes with body/header spoof values.
- Every domain entry validates the brand and authenticated-principal match before mutation. User calls retain the existing permission, sensitive-token, lease, snapshot, bridge-capability, transaction, and audit behavior; Agent and System calls fail before domain/device writes.
- The mutation context requires a branded server-owned refusal sink and rejects a missing or malformed sink as an internal invariant failure; refusal writers never fall back to the caller's transaction.
- Agent refusal remains `dts-reload-agent-refused`. System refusal is fixed as `dts-reload-system-refused`; System refusal audits use the platform path with `actorUserId: null`, `organizationId: null`, and the constructed service/job identity. Agent refusal audits retain principal, session, tool-call, approval, action, target, request, and `requireHuman` correlation.
- Refusal evidence uses the existing trusted audit writer through the branded sink. The real PostgreSQL matrix runs each of the 25 operation/context cells inside an outer transaction, rolls that transaction back, and verifies durable refusal evidence, unchanged domain tables, no lease/snapshot/device side effect, and no success audit.

### #612 TDD and verification evidence

- Red: `npm run test:server -- server/modules/dts-reload/routes.test.ts --run` failed 1 test on the pre-migration implementation because the configuration route passed only `{ requestId: "test-request" }`; the test required a formally constructed server-owned user invocation and client `actorType: "agent"` was not allowed to affect it.
- Focused green: `npm run test:server -- --run server/modules/dts-reload` passed 18 files / 219 tests, including service, deploy, restore-baseline, configuration, promote, routes, and the real PostgreSQL provenance matrix.
- The provenance matrix has five operations × user/agent/system/missing/malformed contexts. User cases reach the original business validation path; Agent/System cases return stable 403s with durable truthful refusal audits; missing/malformed cases raise `INVALID_TRUSTED_INVOCATION_CONTEXT`; all rejected cells have no mutation, success audit, lease, snapshot, or device call.
- Hardware/HDC validation is intentionally out of scope. The deploy matrix uses an adapter spy to prove refusal happens before the bridge/device seam; it is not hardware evidence.
- #613–#615 remain open follow-up migrations. This shared plan stays active and is not moved to `completed/` by #612.

### #612 pre-repair verification boundary (historical)

- Before the independent-review repair, `npm run test:server` timed out in 4 unchanged parameter/parameter-topology PostgreSQL integration tests, while 353 files passed / 2 skipped and 2750 tests passed / 8 skipped. The pre-repair DTS-focused command was green at 18 files / 217 tests. This historical result is retained for provenance and is not the repair result below.
- Before the independent-review repair, `npm run test:all` failed in its frontend phase on 5 existing UI tests; the same command on a clean `origin/main` worktree failed 3 different existing frontend tests. No unrelated frontend fix was included in #612.
- The earlier focused-corpus `npm run acceptance:evidence` result was not used as a #612 gate. #612 does not change operation-evidence coverage, so the command remains intentionally unrun for this repair; no HDC or hardware acceptance was requested or claimed.

## #612 independent review repair checkpoint

- The repair worktree is `/Users/tzrea1/Develop/WiseEff-td612` on `codex/td-068-dts-reload-user-provenance`, rebased without conflict from `49ddd3925` onto `origin/main@537e932ce101a76606347ce8ab0f67303ace1068`. The earlier #611 branch/worktree references below are historical and are not the current #612 branch.
- P1 Red: `npm run test:server -- --run server/modules/dts-reload/provenance.integration.test.ts` failed the caller-transaction refusal regression because the old `refusalDb: tx` path returned Agent 403 but its audit disappeared after rollback (`expected 1`, received `0`). The repair replaces the raw database field with a private-branded `TrustedRefusalAuditSink`; only `createPostgresDatabase` roots can create it, and a root-owned closure writes through the independent pool.
- P2 Red: the exact configuration audit assertion failed with `targetId: "org-1"` instead of the existing public `"dts-reload"` contract. The repair fixes that target while retaining Agent kind/code, `reason`, `requireHuman`, action, principal, session, tool-call, approval, and trace correlation.
- P2 false-green Red: after exact reason/message assertions were added while the old fixtures still omitted the refusal handle, both malformed and principal-mismatch cases failed at the earlier refusal-database guard. The fixtures now carry a valid formal sink, so malformed reaches `context must come from a server-owned constructor` and mismatch reaches `DTS reload invocation principal does not match the authenticated principal`; neither writes refusal or success audit.
- P2 HTTP coverage: the real PostgreSQL matrix now uses the public HTTP router and real five DTS domains, with body/header `actorType` spoofing on all five routes and query spoofing on configuration. It compares no-spoof and spoof business outcomes, verifies user success audit projection, state behavior, absence of Agent/System refusal, and zero deploy bridge calls. It uses an isolated object-store fake only at the pre-device seam; this is not HDC evidence.
- The shared root/sink runtime tests prove that a session wrapper, savepoint/transaction handle, or raw `{ write() }` object is not a trusted sink and fails with `INVALID_TRUSTED_INVOCATION_CONTEXT`. The DTS test helper uses the formal root/sink constructor; it does not wrap a test transaction as a sink.

### #612 repair verification result

- On the final repair code tree based on `origin/main@537e932ce101a76606347ce8ab0f67303ace1068`, `npx tsc -b --pretty false` passed; `npm run test:server` passed 358 files / 2759 tests with 2 files / 8 tests skipped; and the second exact `npm run test:all` run passed frontend 418 files / 3096 tests, scripts 69 files / 948 tests with 5 skipped, bridge 21 files / 138 tests, and server 358 files / 2759 tests with 2 files / 8 tests skipped.
- Focused evidence passed: provenance 1 file / 4 tests, routes 1 file / 5 tests, all DTS reload 18 files / 219 tests, audit 6 files / 26 tests, shared database 4 files / 47 tests, and promote cleanup 1 file / 9 tests.
- The first exact `npm run test:all` attempt failed only in the scripts phase at `scripts/finalize-gate0-upload.test.ts` (1 failed / 947 passed / 5 skipped) while parsing an incomplete `ready.json`. The direct single-file command passed 23/23 on the repair branch five times and on the clean `origin/main` worktree three times; no unrelated source fix was made. The repeat full run passed. Existing warnings included `Not implemented: navigation to another Document` and `ps: process id too large: 999999999`.
- `npm run build`, `npm run contract:check`, `TEST_DATABASE_URL=postgres://wiseeff:wiseeff@127.0.0.1:5433/wiseeff npm run docs:check`, `npm run selfhost:check`, and `git diff --check origin/main...HEAD` passed. Build retained existing Vite externalized-module and large-chunk warnings; lint passed with 0 errors and 299 existing warnings. `npm run acceptance:evidence` remains unrun because operation-evidence coverage is unchanged; GitHub Actions remain unavailable because the monthly quota is exhausted.
- No HDC or hardware validation is claimed. The deploy adapter spy proves only that the refusal/validation seam precedes device invocation. #613–#615 remain open, so this bilingual plan remains active.

## #613 implementation checkpoint

- Scope: parameter submission now requires one branded `TrustedInvocationContext` plus a branded, root-owned refusal sink across binding drafts, node-enablement drafts, structured DTS edits, and semantic/retained-legacy Xiaoze action paths. Direct HTTP routes construct `createUserInvocation(auth)` after authentication; request `actorType`, `initiator`, headers, and query data remain outside the provenance contract.
- The domain validates the context, refusal sink, request correlation, and user/Agent principal match before permission checks, queries, transactions, draft consumption, candidate changes, submission rows, or success audits. Nested structured submission passes the same context object. Missing, malformed, or principal-substitution contexts fail closed instead of defaulting to user.
- The Xiaoze action path requires the orchestrator-owned Agent invocation to match the durable session, tool-call, and approval ids. Approval remains correlation evidence and never changes `initiator: agent` into user. Both semantic and retained-legacy identity paths pass that same invocation into the domain.
- Critical sensitive-node submissions allow the existing capable direct user but return stable `403` for Agent and System. High-tier and non-sensitive Agent submissions retain their existing capability/approval behavior. Agent refusal audit records the accountable user, organization, session, tool-call, approval, and trace; System refusal records its service/job identity with a null actor user. Refusals use the independent root sink and survive caller transaction rollback; successful submission and its trusted audit remain in one transaction.
- #614 topology/writeback governance, #615 global legacy actor-label removal, TD-123 device-write audit, public API/DTO changes, frontend work, and HDC/hardware/live-provider readiness remain out of scope. TD-068 and parent #609 remain Open, and this plan stays active.

### #613 TDD and verification evidence

- Red evidence on the pre-migration implementation: `actionTools.test.ts` reported 2 failures because semantic and legacy submission received only handwritten `{ actorType: "agent" }`; `routes.test.ts` reported 1 failure because the HTTP route supplied no branded user invocation; `submissionProvenance.test.ts` reported 2 failures because missing/malformed context reached the database instead of failing before a transaction.
- Focused final tree: 14 files / 185 tests passed, covering routes, binding/enablement/structured submission, semantic/legacy Xiaoze, orchestrator, registry, critical policy, and PostgreSQL provenance. The owned PostgreSQL matrix covers user/Agent/System/missing/malformed and critical/high/non-sensitive outcomes; it asserts zero rejected-domain residue and zero success audit, durable refusal after outer rollback, truthful correlation, organization substitution refusal, and joint rollback of successful domain rows plus success audit.
- Independent Standards review found that a successful non-sensitive System submission was initially projected to platform scope. The added PostgreSQL assertion failed with no tenant audit row; both structured and ordinary success writers now pass the authenticated tenant scope for System while retaining `actor_type: system` and `actor_user_id: null`. The focused repair command passed 3 files / 37 tests, followed by `npx tsc -b`.
- `npx tsc -b` passed. `npm run test:all` passed: frontend 418 files / 3096 tests; scripts 69 files / 948 passed / 5 skipped; bridge 21 files / 138 tests; server 361 files / 2766 passed / 4 skipped. The first standalone full-server run had one migrated test-fixture failure (`parameter-files/integration.test.ts`, expected 201 and received 500); after injecting the formal test refusal sink, that file passed 3/3 and the complete server phase in `test:all` passed.
- `npm run build`, `npm run contract:check`, pgvector-backed `npm run docs:check`, `npm run lint` (0 errors; inherited 299 warnings), `npm run selfhost:check`, and `npm run acceptance:ci` passed. Build retained the inherited browser-externalization and large-chunk warnings; tests retained jsdom navigation, `ps: process id too large`, and planned skip output.
- Owned-runtime perception acceptance passed 4/4 at frontend `5174` and an allocated API port, without touching the existing 5173/8787 listeners. Action acceptance completed 3 passed / 1 planned skip / 4 failed: approved-write cases selected a seeded semantic binding with no source text and stopped before `submitParameterChanges` (`Config set source text unavailable for typed edit`). A clean detached `origin/main@b676a1e32` run reproduced the same focused approval failure and exact error, so no unrelated fixture repair was absorbed. Every generated database, object root, API/frontend process, and browser run was independently owned and cleaned; one recovery from the repository helper's undefined `stopRuntime` failure moved its exact object root to Trash after deleting the marker-proven database.
- No PR was created or merged and no Issue was closed. Parent/session owner retains final acceptance, PR, merge, and Issue updates.

## #613 independent review repair checkpoint

- The repair stays on `codex/td-068-parameter-submission-provenance` in `/Users/tzrea1/Develop/WiseEff-td613`. It started from feature HEAD `cbbe13fce16097e5fdd5f3ee6d4a127e3411364f` on `origin/main@b676a1e320f1d7fcc1c5e9baaba78c3510c97b14`; production and PostgreSQL repair commit `8bd4eb844` was appended without amending history.
- P1 root cause: the semantic Xiaoze early guard used `loadBindingContext.node_locator`, whose subquery selected a latest logical-node revision by string id ordering, while the central binding-draft guard used the flat parameter source projection. Neither guard supplied the exact revision's `compatible`, so a compatible-only critical rule could be bypassed.
- Both binding guards now use `loadLogicalNodeSubmissionContext`, which accepts organization, project, stable logical-node id, and an exact server-owned config revision. It has no latest or client fallback and canonicalizes the first persisted DTS compatible token using the same single-compatible match input consumed by the sensitive-rule matcher.
- Xiaoze resolves the newest binding revision by numeric `dts_config_revisions.revision_number`, restricted to a revision that also carries the binding's stable logical node, then performs the guard before value parsing, draft creation, or candidate creation. The central seam resolves from the locked draft's persisted `base_config_revision_id` and binding logical-node id; it never substitutes the candidate, current head, request data, or flat source projection.
- PostgreSQL Red on the pre-repair behavior: the new compatible-only critical action test expected Agent 403 but the promise resolved successfully with a change request. Green proves early Agent refusal before draft/candidate/round/change-request/item/success-audit creation, durable correlation after outer rollback, and central refusal of a pre-existing valid draft/candidate without consuming or promoting either. The same central draft also proves System refusal with null actor user, incapable direct-user 403 with unchanged state, and capable direct-user success.
- Existing path-critical, high-tier Agent, non-sensitive Agent, missing/malformed trusted context, route-owned user context, structured submission, and success/refusal atomicity matrices remain regression gates. This repair changes no frontend, route, DTO, public API, migration, or schema. It does not implement #614/#615 trusted-provenance work or change those Issues' interfaces or acceptance state; the shared enablement loader's quoted-compatible normalization does, however, narrowly tighten compatible-rule matching for the topology enablement edit caller described below. No HDC/device readiness is claimed.

### #613 independent repair verification result

- `npx tsc -b --pretty false` passed. After independent-review repair, the exact focused command passed 9 files / 83 tests: compatible PostgreSQL action, binding-central, and enablement-central checks; submission provenance; structured submission; action unit/sensitive tests; Xiaoze assembly; parameter routes; sensitive-node policy; and post-cutover workflow.
- The first complete server run found two Xiaoze assembly fixture failures because its module mock did not expose the new exact-node loader/trusted guard. No production fallback was added: append-only test commit `3326d8eec` wires the real production dependency shape, its file passed 5/5, and the complete server rerun passed 361 files / 2768 tests with 1 file / 4 tests skipped.
- `npm run test:all` passed on the review-repaired code tip: frontend 418 files / 3096 tests; scripts 69 files / 948 passed / 5 skipped; bridge 21 files / 138 tests; server 361 files / 2770 passed / 4 skipped. The standalone complete server rerun also passed 2770 / 4 skipped. Test output retained inherited jsdom navigation and `ps: process id too large` warnings.
- `npm run build`, `npm run contract:check`, pgvector-backed `npm run docs:check`, `npm run lint` (0 errors / inherited 299 warnings), `npm run selfhost:check`, and `npm run acceptance:ci` passed. Build retained inherited browser-externalization and large-chunk warnings.
- Owned-runtime Xiaoze acceptance passed again on review-repaired code tip `6652a1286`: 10 tests passed with 1 planned skip; action passed all 6 executable cases, perception passed 3/3, and runtime warmup passed. Run `full-20260826t151950508z-6652a128651f-dbb0f41f` used API `18800` and frontend `5180`; both processes stopped and the exact database/object root were removed. Existing `8787`/`5173` ports were not used or signalled.
- A preceding controller invocation failed before Playwright because the wrapper attempted to mark the browser phase `running` without the required process-start identity. Its owned API/frontend had already stopped; marker-bound orphan recovery removed only run `full-20260826t150116846z-3326d8eec622-b675ae8d`'s exact database/object root and verified both ports unused and the database absent. This harness retry is not reported as a product-test pass or failure.
- Fresh Standards review found a P1 inconsistency: enablement returned persisted quoted compatible text while the new binding loader canonicalized it. Commit `6652a1286` centralizes compatible-token canonicalization for both exact-revision loaders and adds owned-PostgreSQL enablement Agent/System durable refusal, unchanged draft/candidate state, truthful audit, and capable-user success coverage.
- Fresh Spec review found two P2 evidence gaps. The PostgreSQL central test now creates a higher numeric binding/logical-node revision with a different safe compatible, proving the persisted draft base wins over latest/head; a separate semantic compatible-only high rule proves an approved capable Agent still succeeds with truthful Agent audit. The bilingual workflow record now lists the complete append-only repair chain. P1/P2 are subject to a final fixed-point rereview after this documentation record.

### #613 shared enablement-loader boundary repair

- Parent review identified that `loadLogicalNodeEnablementContext` is shared by the #613 enablement-submission central guard and the topology enablement edit path owned by future #614 work. Keeping commit `6652a1286`'s normalization therefore also makes a persisted `"wiseeff,charging_core"` compatible match a compatible-only `wiseeff,charging_core` rule during `createNodeEnablementDraft`. This is an intentional narrow security correction, not a claim that #614 is implemented.
- Test commit `f661fbcfd` adds an owned-temporary-PostgreSQL regression at `postCutoverWorkflow.integration.test.ts`. Through the public `createNodeEnablementDraft` service seam it binds organization, project, exact config revision, and stable logical-node identity; proves an incapable direct user receives 403 before draft/candidate creation; and proves a direct user with `parameter:edit-critical` still creates exactly one draft/candidate. The test does not assert Agent/System provenance on this legacy path.
- Sensitivity Red used a temporary, uncommitted mutation that returned raw `row.compatible` from only the enablement loader. The exact focused command then failed because the incapable-user promise resolved with an enablement draft/candidate instead of rejecting. `apply_patch` restored `canonicalizeLogicalNodeCompatible(row.compatible)`; the restored `writeLock.ts` blob `e5d3d3b3a7524ca01a95e018d8f60bc697e14816` and SHA-256 `5dd686210d8fed05040e068a1a5f09065896a63dd22ac0792f9dbd629312c4e8` match the pre-mutation file, and production diff is empty.
- Final Green passed the focused file at 15/15, `npx tsc -b --pretty false`, and the requested 9-file matrix at 75/75. `npm run test:all` passed: frontend 3096/3096; scripts 948 passed / 5 skipped; bridge 138/138; server 361 files / 2771 passed / 4 skipped with one planned-skipped file. `npm run build` and `npm run contract:check` passed with the inherited browser-externalization and large-chunk warnings.
- Pgvector-backed `npm run docs:check`, `npm run lint` (0 errors / inherited 299 warnings), `npm run selfhost:check`, `npm run acceptance:ci`, and `git diff --check origin/main...HEAD` passed on the exact repair tree. Test output retained the inherited jsdom navigation and `ps: process id too large` notices; no skip or warning is reported as a pass.
- #614 remains Open and still owns topology/writeback migration from legacy `actorType` to `TrustedInvocationContext`, including Agent/System provenance, refusal-audit durability, interfaces, and its full acceptance matrix. No Xiaoze owned-browser, viewport, Hosted, HDC, hardware, or live-provider verification was rerun or claimed for this test/docs-only repair; the earlier `6652a1286` Xiaoze acceptance remains historical evidence only.

## Documentation Impact Matrix

| Area | Status | Evidence |
| --- | --- | --- |
| Repository maps and agent guidance | Review | `AGENTS.md`; it already routes security/auth/audit work to the relevant docs. |
| Planning and technical-debt tracking | Review | `docs/PLANS.md`, `docs/exec-plans/tech-debt-tracker.md`; both retain TD-068 Open and its migration boundary. |
| Product and API contracts | Review | `docs/design-docs/api-contract.md`, `server/modules/contracts/`; route paths and request contracts remain unchanged, while server-owned provenance and actor-field stripping are covered by route tests. |
| Architecture and domain model | Review | `docs/adr/0038-trusted-invocation-provenance-separates-principal-and-initiator.md`, `docs/design-docs/full-stack-architecture.md`, `docs/design-docs/domain-model.md`. |
| Security and audit guidance | Review | `docs/SECURITY.md`, `server/modules/audit/auditedWrite.ts`; trusted-context and no-default-user rules remain a partial migration. |
| Quality and verification docs | Review | `docs/QUALITY_SCORE.md`, `docs/developer/verification-matrix.md`; #613 adds exact-revision compatible-only PostgreSQL refusal coverage and keeps HDC outside its evidence boundary. |
| Chinese developer docs | Review | `docs/zh-CN/SECURITY.md`, `docs/zh-CN/design-docs/full-stack-architecture.md`, `docs/zh-CN/design-docs/domain-model.md`, `docs/zh-CN/PLANS.md`. |
| Generated artifacts, runbooks, frontend/design, references | No change | `docs/generated/`, `docs/runbooks/`, `src/`, `docs/references/`; no generated schema, operation, runtime, UI, or operator-procedure change. |

## Documentation Update Gate

- [x] ADR-0038 and the bilingual security/architecture/domain/API planning references were reviewed against the implemented seam.
- [x] No public contract or frontend documentation became stale.
- [x] #613 repair scope, compatible-only Red, exact binding/draft revision provenance, rollback-audit boundary, zero-residue assertions, and HDC evidence boundary are recorded here and in the synchronized Chinese plan.
- [x] #613 did not absorb or modify the original worktree's unrelated `src/App.tsx` and `src/App.test.tsx` changes.
- [x] Historical pre-repair frontend/full-server failures and clean-`origin/main` reproductions remain recorded separately from the current repair result; the current exact-tree server and `test:all` reruns are recorded with their warnings and skips.
- [x] Resolved the inherited acceptance-quality failures through #617 / PR #619 and reran the complete required local CI on the rebased final tree.
- [x] #610 obtained zero-finding final Standards and Spec reviews before its merge; #611 receives its own final parent review after this landing record.
- [ ] Move this plan to `completed/` only after the complete TD-068 migration and closure evidence land.

## Git & PR Workflow

The #610-#612 branch/worktree references above are historical. The current implementation and independent repair remain on `codex/td-068-parameter-submission-provenance` at `/Users/tzrea1/Develop/WiseEff-td613`, based on `origin/main@b676a1e320f1d7fcc1c5e9baaba78c3510c97b14`; the pre-repair HEAD was `cbbe13fce16097e5fdd5f3ee6d4a127e3411364f`. The append-only repair chain is `8bd4eb844` (exact binding revision), `de6efbca4` (bilingual repair evidence), `3326d8eec` (Xiaoze assembly fixture), `54da2bd02` (verification record), `6652a1286` (review repair for enablement, competing revision, and compatible-high evidence), `7caf31e8c` (final independent-review record), and `f661fbcfd` (shared-loader topology enablement regression), followed by the bilingual boundary record containing this paragraph. This session does not create or merge a PR and does not close Issue #613. TD-068 remains active; #614 remains Open and its trusted-provenance migration is not implemented here. The parent/session owner retains final PR, merge, Issue, and main-synchronization authority.
