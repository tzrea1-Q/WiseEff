# Attribution deferred implementation (D-AG-01–04)

> Status: **Active** — decisions locked; implement on sequential feature branches from `main`  
> Date: 2026-08-01  
> Chinese: [`docs/zh-CN/exec-plans/active/2026-08-01-attribution-deferred-implementation.md`](../../zh-CN/exec-plans/active/2026-08-01-attribution-deferred-implementation.md)  
> Locked decisions: [`docs/design-docs/2026-07-31-attribution-governance-deferred-questions.md`](../../design-docs/2026-07-31-attribution-governance-deferred-questions.md)  
> Prior follow-up (merged): [`docs/exec-plans/completed/2026-07-31-attribution-governance-follow-up.md`](../completed/2026-07-31-attribution-governance-follow-up.md)  
> Prior closeout (merged #216): [`docs/exec-plans/completed/2026-08-01-governance-platform-closeout.md`](../completed/2026-08-01-governance-platform-closeout.md)

## Goal

Ship the 2026-08-01 locked answers for D-AG-01–04 without reopening grilling:

1. **PR1 (D-AG-01 + D-AG-02 docs)** — editable `driverNature` / `instanceCardinality` with authz + same-txn audit/task re-sync; singleton change blocks publish only; contract/docs drop `pinned-schema-property`.
2. **PR2 (D-AG-03 / TD-047)** — drop `driverModule` with fail-closed migration; subject-only seeds/overlay/import.
3. **PR3 (D-AG-04 / TD-046)** — place auto units from registration default business category; curated frozen; auto replay + explicit operator replay.

## Non-goals

- Re-grilling or changing locked rows in the deferred-questions doc.
- Parameter-governance deferred D1–D8.
- Bundling PR2/PR3 into PR1 (keep migration blast radius isolated).
- Closing TD-046/TD-047 before the owning PR merges.

## Git & PR Workflow

| Role | Allowed |
| --- | --- |
| Implementation agent | One feature branch per PR below; commit only on that branch; do not open/merge GitHub PRs |
| Parent agent | Review, open/merge each PR, sync local `main` before the next branch |

This plan intentionally uses **three sequential branches/PRs** (exception to one-plan→one-branch). Each PR starts from latest `main` after the previous merge.

| PR | Branch | Scope |
| --- | --- | --- |
| PR1 | `feat/attribution-editable-nature-cardinality` | D-AG-01 + D-AG-02 docs/contract |
| PR2 | `feat/drop-parameter-spec-driver-module` | D-AG-03 / TD-047 |
| PR3 | `feat/attribution-registration-placement` | D-AG-04 / TD-046 |

## Success criteria

- [ ] Locked decision table remains the source of truth; no silent semantic drift in PRs.
- [ ] PR1: Org Admin cannot edit platform registrations; platform-admin can edit org registrations and those edits appear in org audit; singleton→publish blocked via tasks; save is one transaction; nature UI stays distinct from `node-type`.
- [ ] PR1: Public contract/docs no longer advertise `pinned-schema-property` as a supported claim kind.
- [ ] PR2: `driverModule` column and identity write paths gone; migration fails closed on unresolvable subjects; TD-047 closed.
- [ ] PR3: Auto placement uses registration default business category; curated frozen; auto replay + explicit replay op; TD-046 closed; keyword heuristic retired or demoted to non-product path.
- [ ] Acceptance IDs registered/updated; focused tests + `npm run build` green per PR; `npm run docs:check` green before marking this plan complete.
- [ ] Frontend-visible PR1/PR3: playwright-cli evidence at 1440×900 / 768×1024 / 390×844 with 0 console errors.

## Delivery batches

### PR1 — Editable nature/cardinality + D-AG-02 honesty

1. Mutate API + authz: org Admin → org registrations; platform-admin → platform **and** org; audit org history for platform-admin edits.
2. On change to `singleton-per-project`, open/refresh singleton-cardinality tasks; **do not** force topology rewrite; publish remains blocked while tasks open.
3. Persist update + audit + task re-sync in **one** transaction.
4. Admin UI: replace read-only display with edit controls; copy keeps nature orthogonal to `node-type`.
5. D-AG-02: remove/mark unsupported `pinned-schema-property` in schema/docs/examples; runtime stays overlay-only.
6. Register/extend acceptance IDs for edit authz, audit visibility, and singleton publish gate.

### PR2 — Drop `driverModule` (TD-047)

1. Migration drops `driverModule` (and any derived identity use). **Fail closed** if subject cannot be resolved for a row that still needs identity.
2. API/OpenAPI/types/seeds/overlay/import: subject-only; no string `driverModule` write path.
3. Update tests; close TD-047 in EN/ZH tech-debt trackers when merged.

### PR3 — Registration default placement (TD-046)

1. Replace keyword `businessCategoryForNodePath` product path with registration **default business category**.
2. Curated placements frozen; auto placements replay when registration default changes.
3. Explicit Admin/operator “replay from registration” action.
4. Close TD-046; update ADR-0010 / placement docs if they still call the heuristic authoritative.

## Key seams (starting points)

- Registrations / nature / cardinality: driver registry + Admin registration surfaces; ADR-0013.
- Singleton tasks: existing singleton-cardinality blocking task path.
- Coverage claims: `server/modules/parameter-specs/coverageClaim.ts` (overlay-only).
- `driverModule`: `parameter_specs` schema + seeds/overlay/import.
- Placement: `src/domain/parameter-topology/modulePlacement.ts` (`businessCategoryForNodePath`).

## Documentation Impact Matrix

| Area | Action | Paths |
| --- | --- | --- |
| Planning | Update | this plan; `docs/PLANS.md`; `docs/zh-CN/PLANS.md`; ZH companion plan |
| Deferred design | Update | EN/ZH `2026-07-31-attribution-governance-deferred-questions.md` (already locked) |
| Tech debt | Update | EN/ZH `tech-debt-tracker.md` (TD-046/047 next actions now; close on PR merge) |
| ADR / domain | Review | ADR-0010, ADR-0013; `docs/design-docs/domain-model.md` (+ ZH) for nature/cardinality/placement wording |
| API contract | Update | `docs/design-docs/api-contract.md` (+ ZH) when mutate/drop-column/replay endpoints land |
| Frontend | Update | `docs/FRONTEND.md` (+ ZH) if Admin registration/placement UX changes |
| Security / audit | Review | `docs/SECURITY.md` — platform-admin edits on org registrations must remain auditable |
| Quality / acceptance | Update | browser acceptance coverage map + user operation matrix (+ ZH); `e2e/acceptance/*` |
| Product specs | Review | `docs/product-specs/*` only if Admin operator workflows change copy |
| Reliability / runbooks | No change | expected |
| Generated artifacts | Update | schema summaries if migrations land |
| References | Review | productization API draft if it still lists `driverModule` / pinned claims |

## Documentation Update Gate

Before moving this plan to `completed/`:

1. Every Impact Matrix `Update`/`Review` row is updated or recorded unchanged with evidence.
2. TD-046 and TD-047 are closed (or remaining work is re-filed honestly).
3. EN/ZH deferred-questions stay **Locked** with links to the merged PRs.
4. `npm run docs:check` is green.
5. UI-interaction coverage for PR1/PR3 is registered with automation or supplemental evidence.

## Verification (per PR)

```bash
npm run docs:check
# PR-scoped unit/server tests for touched modules
npm run build
# When UI changes:
# playwright-cli evidence under work/ui-checks/attribution-deferred-pr{N}-*
```

## Out of order rule

Do not start PR2 or PR3 implementation until PR1 is merged to `main`, unless the parent agent explicitly resequences after a rebase conflict review. Do not start coding any PR until this plan exists on `main` (or the docs PR that lands it has merged).
