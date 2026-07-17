# Parameter Topology Round 6 Review Blockers

> Chinese: [中文](../../zh-CN/exec-plans/active/2026-07-16-parameter-topology-round6-review-blockers.md)
> Prior: [round5](./2026-07-16-parameter-topology-round5-review-blockers.md)

**Goal:** Close parent-agent Round 5 Review blockers: historical cross-tenant review-task scope reconcile, lossless manual spec identity, global-spec activation authz, full valueShape activate UX, real submit→review→merge acceptance, tenant-scoped fixture cleanup, and stable `npm run test:all`.

**Branch:** `fix/parameter-topology-round6-review-blockers`
**Preserved baseline:** Round5 `a2669639` via `--no-ff` merge. **TD-042 remains BLOCKER — not production cutover ready.**

## Success criteria

1. New forward migration (0058+) re-validates review-task scope from trusted joins only; polluted FKs cleared; ambiguous rows stay needs-review and block finalize; upgrade path from dirty 0055 state proven on real PG.
2. `vendor,limit` and `vendor-limit` (and other lossy-sanitize pairs) produce distinct stable IDs; collision audit fail-closed without silent rewrite of referenced IDs.
3. Org Admin can activate only org-owned drafts; global draft activate is rejected server-side; read/bind of active global specs still allowed.
4. Activate panel/API retain full inferred valueShape (bits/groups/cellsPerGroup/bytes); gpio_int three-cell shape preserved; incomplete shape blocks activate.
5. Topology acceptance exercises real submit→review→merge→writeback→validate via API/UI (no repository status forging); base immutable; candidate new; `writeback.skipped === false`.
6. Fixture cleanup resolves Config Sets by organizationId+projectId+name; cross-org/project same-name sets untouched.
7. Default `npm run test:all` is stable without ad-hoc maxWorkers; migration/dashboard isolation fixed at root cause.
8. Bilingual docs updated; `npm run docs:check` passes; TD-042 stays BLOCKER.

## Task map

| Task | Finding | Implementation focus |
| --- | --- | --- |
| T1 | 0057 trusts polluted task FKs via coalesce | Migration 0058 evidence-only reconcile + PG upgrade tests |
| T2 | sanitize-before-hash collisions | Lossless canonical hash input + collision audit/tests |
| T3 | Org Admin activates global draft | activate requires org-owned row; global fail-closed |
| T4 | UI drops valueShape fields | Mapper→detail→panel full shape; server re-validates |
| T5 | Acceptance skips merge path | Real CR workflow + writeback assertions |
| T6 | Cleanup Config Set by name only | Tenant-scoped resolve + PG isolation tests |
| T7 | test:all PG races | Worker/DB isolation in standard vitest/npm scripts |
| T8 | Docs/browser/evidence | Bilingual docs + playwright-cli + gates |

## Task dependencies

```text
Plan
  → T1/T2/T3/T6 in parallel (independent)
  → T4 (frontend + activate validation)
  → T5 (acceptance merge path; needs T3/T4 semantics)
  → T7 (test harness isolation)
  → T8 docs + browser + full gates
```

## Verification matrix

| Area | Command / focus |
| --- | --- |
| Scope reconcile | new 0058 PG upgrade from polluted 0055 state |
| Spec identity | `vendor,limit` ≠ `vendor-limit`; property tests |
| Global authz | activate service + HTTP/PG negatives |
| ValueShape | mapper/panel/service tests + playwright-cli |
| Acceptance merge | topology acceptance submit→merge→reload |
| Cleanup | cross-org/project same-name Config Set PG test |
| Stability | `npm run test:all` ×3 default config |
| Toolchain | `dts:toolchain:check`, `dtc:seed:compile` |

## Documentation Impact Matrix

| Area | Action | Paths |
| --- | --- | --- |
| Plans | Update | this plan; `docs/PLANS.md`; zh-CN companions |
| Domain model | Update | `docs/design-docs/domain-model.md` + zh-CN |
| API contract | Update | `docs/design-docs/api-contract.md` + zh-CN |
| Testing strategy | Update | `docs/design-docs/testing-strategy.md` + zh-CN |
| Verification matrix | Update | `docs/developer/verification-matrix.md` + zh-CN |
| Cutover / identity runbook | Update | `docs/runbooks/parameter-identity-cutover.md` + zh-CN |
| Frontend | Update | `docs/FRONTEND.md` + zh-CN |
| Security / authz | Review/Update | `docs/SECURITY.md` + global-spec governance notes |
| Tech debt | Review | TD-042 stays BLOCKER |

## Documentation Update Gate

Blocking before plan completion: every `Update`/`Review` row updated or explicitly unchanged with evidence; `npm run docs:check` passes; TD-042 not closed.

## Execution checkpoint (2026-07-18)

- T1/T2 follow-up findings are closed: unproven polluted tasks reopen even without evidence IDs; finalize blocks every open migration-run task; manual entity IDs and persisted `specificationKey` values are lossless and coexist in one organization.
- T4 follow-up is closed: activation state resets on spec/valueShape changes and frontend/backend reject fractional cell counts.
- T5 creates and destroys a marker-verified `wiseeff_acceptance_disposable_*` database, applies every migration, runs real identity apply+cutover, and passes the formal Software User → Hardware Committer → Software Committer → Software User submit/review/merge/writeback/reload chain. The candidate binding stores a valid three-cell phandle AST; base config/binding revisions remain unchanged.
- The previously weakened `PARAM-ASSIGNEE-001/002` and parameter-review operations again use visible UI controls. API mode loads organization+project-scoped eligible assignees, and browser acceptance switches production HMAC identities before each role-specific UI action.
- Browser-visible behavior was verified with `playwright-cli` at 1440×900, 768×1024, and 390×844 on `/parameters` and `/parameter-admin`. The real API topology exposes the `sc8562@6E` `gpio_int = <&gpio13 29 0>` occurrence; the disposable admin fixture preserved `phandle-list`, `bits=32`, `groups=1`, and `cellsPerGroup=3`, reset stale form state, rejected fractional/incomplete cells, activated the org-owned draft through HTTP 200, hid global-draft activation, and returned HTTP 403 for a forced global activate. Console errors were zero. A 390px topbar overflow found during this pass was fixed in `51bc0608`; both pages then reported document overflow false.
- Full `acceptance:browser` evidence was regenerated from clean source commit `51bc06085df382754197270611cc25e990e19758` (`Dirty worktree: false`). Playwright completed 85 tests: 81 expected/pass, four hardware-conditional skips, zero failures/errors. Requirement coverage is 59/59; operation evidence is 56/56 with 71 records, zero invalid records, and zero validation errors. `npm run acceptance:evidence` exits zero. The outer runner remains failed only because pilot readiness is externally blocked by `deviceGateway`, `xiaozeLlm`, and `backups`.
- Three recorded default `npm run test:all` runs (logs 2/3/4) exited zero with identical totals: frontend 314 files, 2178 passed / 5 skipped; server 214 files, 1531 passed / 1 skipped. No ad-hoc worker override was used.
- Toolchain verification passes with dtc 1.8.1, fdtoverlay 1.8.1, and dtschema 2026.6. Aurora, Nebula, and Atlas all compile with empty diagnostics. Generated evidence/docs were recorded in `4c199b3a`; post-commit contract/docs/build, standalone frontend/server tests, default `test:all`, toolchain, self-host, operation-evidence, and diff gates all pass. The plan remains active only for the explicitly external pilot/cutover blockers. TD-042 remains BLOCKER because no clean non-customer snapshot apply→cutover→whole-DB restore rehearsal has run.

## Risks & rollback

| Risk | Mitigation |
| --- | --- |
| Changing identity hash breaks idempotent createSpec | Lookup existing by org+property before insert; collision audit reports only; no silent rewrite |
| 0058 clears too many scopes | Preserve only join-proven chains; mark others needs_review with diagnostic |
| test:all isolation changes slow CI | Prefer unique namespaces + serial migration file group over global single-worker |

## Git & PR Workflow

- Implementation branch from local `main`, `--no-ff` merge Round5 (`a2669639`).
- Implementation agent: commit on feature branch only; **must not** push, open PR, or merge `main`.
- Parent agent: Review, PR, merge, sync `main`.

## Out of scope / explicit non-claims

- No production cutover; no customer DB/snapshots.
- Not production ready; not cutover ready; not merge-ready without parent Review.
- External pilot blockers (`deviceGateway`, `backups`) reported honestly if still present.
- Platform-admin for global specs: fail-closed unless a designed platform governance path already exists.
