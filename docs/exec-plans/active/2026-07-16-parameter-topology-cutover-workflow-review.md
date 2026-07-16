# Parameter Topology Cutover Workflow Review Fixes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> Chinese: [中文](../../zh-CN/exec-plans/active/2026-07-16-parameter-topology-cutover-workflow-review.md)
> Prior: [e2e review blockers](./2026-07-16-parameter-topology-e2e-review-blockers.md)
> Design: [Topology- and Schema-Aware Parameter Management](../../superpowers/specs/2026-07-16-parameter-topology-schema-management-design.md)

**Goal:** Make post-cutover activity workflows run entirely on semantic identity (`project_parameter_binding_id` / `parameter_spec_id` / occurrences / binding revisions), with precise occurrence writeback, real spec-review application, fail-closed candidate/validation state machines, honest migration reports, reusable identity continuity, truthful frontend provenance, and acceptance that never mutates business DB state to fake success.

**Architecture:** Keep migration `0048` + cutover SQL. Split pre-cutover adapters from post-cutover runtime. Centralize candidate and validation state machines. Persist Config Set manifests and reviewed continuity/overrides for subsequent revisons. Do not squash reviewed history.

**Tech Stack:** TypeScript 5.9, Node/tsx, PostgreSQL 16, Zod, React 19/Vite, Vitest, Playwright, dtc 1.8.1, dtschema 2026.6.

## Git & PR Workflow

| Role | Allowed |
| --- | --- |
| Implementation agent | Branch from local `main`, merge `fix/parameter-topology-e2e-review-blockers` without squash, implement/test/commit |
| Implementation agent | Must not push, open PRs, merge PRs, or claim production cutover ready |
| Parent agent | Review, PR, merge when approved |

**Branch:** `fix/parameter-topology-cutover-workflow-review`  
**Preserved baseline:** `afbb3eab` (and prior topology commits). TD-042 remains BLOCKER without clean non-customer snapshot rehearsal.

## Success criteria

- Post-cutover activity code never accesses renamed legacy tables/columns or creates shadow PPV/definitions.
- Post-cutover full workflow integration tests pass (list/draft/submit/review/merge/history/writeback/debug/project delete).
- Spec review resolution creates/updates bindings and reusable matcher overrides.
- Precise occurrence writeback tests pass (duplicate `&label`, multi-node keys, stale span).
- `needs_mapping` cannot be overwritten to `draft`; validation failure revokes `validated`.
- Full Config Set manifest persists and reloads; no hardcoded `includeSearchPaths=["."]`.
- Inferred specs are separately counted and block unaudited cutover.
- Reviewed identity mapping reused across revisons (R1→R2→R3).
- Frontend provenance from API; mapping/review UI real; publish wording accurate.
- Topology acceptance has no direct business DB mutation; success path includes real typed edit + successful validate (not `schema-failed` as success).
- `git diff --check` clean; workspace clean; no push/PR.
- Explicit: **TD-042 not cleared → not production cutover ready.**

## Global constraints

- apply_patch only; no destructive git; no weakening fail-closed or dt-schema.
- No temporary fallbacks that reintroduce flat identity into post-cutover APIs.
- Forward-only migrations; org isolation + authz + audit on writes.
- Do not execute production/customer cutover.

## Phase commits

1. Active exec plan
2. Post-cutover semantic workflow (+ remove shadow PPV from typed edit)
3. Spec review application
4. Precise occurrence writeback
5. Candidate + validation state machines
6. Config Set manifest persistence
7. Migration inferred specs + identity continuity
8. Frontend governance workflow
9. Acceptance rewrite (no DB bypass)
10. Docs + final gates

---

### Task 1–2: Post-cutover workflow + typed edit without shadow PPV

- [x] Audit and replace legacy SQL in parameters/debugging/writeback/delete paths with semantic IDs
- [x] Strengthen `legacyDependencyGuard` allowlist to migration/cutover/rollback/adapters only
- [x] Remove `ensureShadowParameterValue` from post-cutover typed draft path
- [x] Integration: temp DB → migrate → cutover → list/draft/submit/review/merge/history/writeback/debug/delete

### Task 3: Spec review applies decisions

- [x] Evidence locates org/project/revision/occurrence/logical node/property/candidates
- [x] Transactional resolve: lock → validate spec → occurrence→spec → binding → revision → status → audit → close
- [x] Persist reusable matcher override; dismiss fail-closed; cross-org 404; rollback + idempotency tests

### Task 4: Precise occurrence writeback

- [x] Write by file version + occurrence + CST span + node/property identity
- [x] Duplicate `&label` / delete-property / base-only override / stale span golden tests

### Task 5–6: Candidate + validation state machines + manifest

- [x] Central candidate FSM; never promote needs_mapping/invalid to draft
- [x] Failed re-validation revokes validated; missing base fail-closed
- [x] Persist entryFile/includeSearchPaths/overlay order/member roles; path safety

### Task 7–8: Migration honesty + continuity

- [x] Report exactMatched / reviewedMatched / inferredPendingReview / ambiguous / unmapped / broken
- [x] Cutover blocks unaudited inferred; dry-run does not mask inferred as mapped
- [x] Reviewed mapping evidence reused on next ingest; only stable revisons are continuity baselines
- [x] R1/R2/R3 continuity tests

### Task 9–11: Frontend, acceptance, hygiene

- [x] Real provenance; mapping UI; accurate validate/publish copy; no teaching fallback in API mode
- [x] Topology acceptance via APIs only; persistent evidence dir separate from Playwright outputDir
- [x] Fix golden `status="ok"` via standard values or vendor schema (keep fail-closed)
- [ ] trailing whitespace; docs EN+zh-CN; final gates

## Risk & rollback

| Risk | Mitigation |
| --- | --- |
| Cutover breaks production reads | Feature branch only; temp-DB integration; TD-042 blocks real cutover |
| Writeback corrupts DTS | Span-based edits + checksum/stale conflict + round-trip tests |
| Acceptance flaky from DB pollution | Ban business DB mutation in acceptance body |
| Inferred specs inflate mapping rates | Split counters + cutover gate |

Rollback: do not apply cutover outside temp DB; restore from snapshot if any rehearsal DB used; revert feature branch commits if parent rejects.

## Documentation Impact Matrix

| Area | Paths | Action |
| --- | --- | --- |
| Planning | this plan, `docs/PLANS.md`, zh-CN, tech-debt (TD-042) | Update |
| Domain/API | domain-model, api-contract + zh-CN | Update |
| Frontend | FRONTEND.md + zh-CN | Update |
| Reliability/runbooks | parameter-identity-cutover + zh-CN | Update |
| Developer | verification-matrix, env + zh-CN | Review/Update |
| Quality/acceptance | coverage maps + acceptance specs | Update |
| Generated | OpenAPI, evidence | Regenerate |
| Security | SECURITY.md + zh-CN | Review |

## Documentation Update Gate

- [ ] Update/Review rows handled
- [ ] `npm run docs:check` passes
- [ ] OpenAPI matches routes
- [ ] Topology acceptance evidence regenerable without Playwright wiping it
- [ ] TD-042 remains explicit BLOCKER until clean-snapshot rehearsal
- [ ] Plan stays active until parent review

## Verification

```bash
npm run contract:check && npm run docs:check && npm run build
npm run test:server && npm test && npm run test:all
npm run dts:toolchain:check && npm run dtc:seed:compile && npm run selfhost:check
git diff --check
# plus focused post-cutover / writeback / review / continuity / topology acceptance
```
