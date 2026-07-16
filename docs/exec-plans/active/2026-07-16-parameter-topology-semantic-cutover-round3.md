# Parameter Topology Semantic Cutover Round 3

> Chinese: [中文](../../zh-CN/exec-plans/active/2026-07-16-parameter-topology-semantic-cutover-round3.md)
> Prior: [cutover workflow review](./2026-07-16-parameter-topology-cutover-workflow-review.md)

**Goal:** Real vendor dt-schema (no permissive stubs), post-cutover semantic dashboard/hotspot, durable inferred stage→review→finalize, precise merge writeback identity, scoped matcher/review blockers, manifest backfill, UI unmatched review, and acceptance without DB bypass or fallback specs.

**Branch:** `fix/parameter-topology-semantic-cutover-round3`

**Preserved baseline:** `6b4ef783` (merge `fix/parameter-topology-cutover-workflow-review`). **TD-042 BLOCKER** until clean-snapshot rehearsal.

## Success criteria

1. Linux bindings from vendor property specs — not `additionalProperties: true` blanket
2. Post-cutover dashboard/hotspot APIs use semantic tables only
3. Inferred: stage-review persists tasks; finalize atomic; no half-migrated activity data
4. Merge writeback uses locked binding/occurrence/revision identity — no "latest revision" guess
5. Post-cutover workflow tests via real service/API (draft→submit→review→merge→writeback)
6. Matcher override scoped by org/project/driver/locator — no cross-node bleed without compatible
7. Review blockers scoped to project/revision — not org-wide `parameter_spec_id is null`
8. Historical manifest backfill (0052) or explicit `needs_review` blocker
9. Unmatched spec review completable in UI (search library / create spec)
10. Acceptance: exact failure codes, edited values, binding ID, provenance — no batch review cleanup

## Phase commits

1. `docs(parameters): plan semantic cutover round 3`
2. `feat(dts): real vendor linux bindings from property specs`
3. `fix(parameters): semantic dashboard and hotspot post-cutover`
4. `feat(parameters): inferred migration stage review finalize`
5. `fix(parameters): precise merge writeback identity`
6. `test(parameters): real post-cutover service workflow`
7. `fix(parameters): scoped matcher override and review blockers`
8. `feat(parameters): backfill config-set manifest for legacy revisions`
9. `fix(frontend): unmatched spec review library search and create`
10. `test(parameters): topology acceptance without semantic bypass`
11. `docs(parameters): round 3 docs and final gates`

## Documentation Impact Matrix

| Area | Paths | Action |
| --- | --- | --- |
| Planning | this plan, PLANS.md, tech-debt TD-042 | Update |
| Domain/API | domain-model, api-contract + zh-CN | Update |
| Testing | testing-strategy, verification-matrix + zh-CN | Update |
| Frontend | FRONTEND.md + zh-CN | Update |
| Runbooks | parameter-identity-cutover + zh-CN | Update |
| Reliability/Security | RELIABILITY, SECURITY + zh-CN | Review/Update |

## Documentation Update Gate

- [ ] EN+zh-CN pairs updated where required
- [ ] `npm run docs:check` passes
- [ ] TD-042 explicit BLOCKER in tech-debt
- [ ] Plan stays active until parent review

## Risk & rollback

| Risk | Mitigation |
| --- | --- |
| Schema too strict breaks seed | Fix fixtures; vendor schema source of truth |
| Staging migration complexity | Separate stage/finalize transactions; temp-DB tests |
| Dashboard field gaps | Forward migration for risk/module on specs |

Rollback: feature branch only; no production cutover; restore snapshot if rehearsal DB used.

## Verification

```bash
npm run contract:check && npm run docs:check && npm run build
npm run test:server && npm test && npm run test:all
PATH="$HOME/Library/Python/3.9/bin:$PATH" npm run dts:toolchain:check
PATH="$HOME/Library/Python/3.9/bin:$PATH" npm run dtc:seed:compile
npm run selfhost:check && git diff --check
```

Plus: vendor schema negative tests, dashboard API post-cutover, inferred stage/finalize PG tests, merge writeback, topology acceptance.
