# Governance + Platform closeout (archive, evidence, acceptance surface)

> Status: **Completed (implementation merged).** #216 (`feat/governance-platform-closeout`). Attribution deferred D-AG-01–04 locked and owned by [`2026-08-01-attribution-deferred-implementation.md`](../active/2026-08-01-attribution-deferred-implementation.md).  
> Date: 2026-08-01  
> Chinese: [`docs/zh-CN/exec-plans/completed/2026-08-01-governance-platform-closeout.md`](../../zh-CN/exec-plans/completed/2026-08-01-governance-platform-closeout.md)  
> Supersedes residual closeout work from:
> - [`2026-07-30-parameter-governance-state-machine-completion.md`](../completed/2026-07-30-parameter-governance-state-machine-completion.md) (PR1–PR3 merged #212–#214)
> - [`2026-07-31-attribution-governance-follow-up.md`](../completed/2026-07-31-attribution-governance-follow-up.md) (PR7–PR9 merged via #215)
> - [`2026-07-30-platform-tier-and-super-admin.md`](../completed/2026-07-30-platform-tier-and-super-admin.md) (merged #209–#210)

## Goal

Close the three merged governance/platform workstreams without shipping new product semantics. Deliver:

1. **Housekeeping** — archive the three source plans with honest Status + residual lists; close TD-054 if OpenAPI schema is present.
2. **Platform cross-tenant evidence** — advance `PLAT-ROLE-*` / `DRV-PROMOTE-*` from “registered, No automation” to runnable acceptance and/or archived Playwright evidence.
3. **Parameter-governance acceptance surface** — register and land the planned Admin acceptance IDs; browser-smoke the Admin paths; do **not** implement deferred D1–D8 / D-AG-* before grilling.

## Non-goals

- Grilling or implementing `docs/design-docs/2026-07-30-parameter-governance-deferred-questions.md` (D1–D8).
- Grilling or implementing `docs/design-docs/2026-07-31-attribution-governance-deferred-questions.md` (D-AG-01–04 / TD-046 / TD-047).
- New governance capabilities, schema migrations, or role model changes.
- Full M6 target-environment evidence (OIDC / backup / capacity) — out of scope.

## Git & PR Workflow

| Role | Allowed |
| --- | --- |
| Implementation agent | Commit on `feat/governance-platform-closeout` only |
| Parent agent | Open/merge GitHub PR; sync local `main` |

Branch from latest `main`. One plan → one branch → one PR.

## Success criteria

- [x] Three source plans live under `docs/exec-plans/completed/` (and ZH companions where they exist) with Status = merged + residual pointer to this plan.
- [x] TD-054 closed in EN/ZH tech-debt trackers (`schemaRegistry` has `listPromotionCandidates`; `openapi.test.ts` 10/10).
- [x] `PLAT-ROLE-001..003` automated in `permissions-matrix.acceptance.spec.ts`; `DRV-PROMOTE-*` documented with supplemental screenshots (promote confirm captured).
- [x] Governance IDs registered in coverage map + requirements + operation matrix.
- [x] `playwright-cli` evidence at 1440×900 / 768×1024 / 390×844 for the listed Admin/platform routes (0 console errors).
- [x] `npm run docs:check` green; focused unit/acceptance tests green; `npm run build` green.

## Supplemental Manual Evidence

Archived under `work/ui-checks/` (API mode, Xu Yun / Platform Super Admin session, 2026-08-01):

| Route / act | Files |
| --- | --- |
| `/platform-console` | `governance-closeout-platform-console-{desktop,tablet,mobile}.png` |
| Promote blast-radius confirm | `governance-closeout-promote-confirm-desktop.png` |
| `/user-permissions` | `governance-closeout-user-permissions-{desktop,tablet,mobile}.png` |
| `/parameter-admin/modules` | `governance-closeout-param-modules-{desktop,tablet,mobile}.png` |
| `/parameter-admin/identity-mapping` | `governance-closeout-param-identity-{desktop,tablet,mobile}.png` |
| `/parameter-admin/specs` | `governance-closeout-param-specs-{desktop,tablet,mobile}.png` |
| `/parameter-admin/spec-review` | `governance-closeout-param-spec-review-{desktop,tablet,mobile}.png` |

Console: `playwright-cli console error` → 0 errors on the closeout session.

`DRV-PROMOTE-001..004` remain non-blocking / manual until a multi-org promote seed can drive shadowed/promoted chips deterministically. `DRV-PROMOTE-005` blast-radius dialog is evidenced by the promote-confirm screenshot above.

## Delivery batches

### Batch A — Housekeeping

1. Move the three EN plans (and ZH attribution follow-up) to `completed/`.
2. Rewrite each plan header Status to: implementation merged (PR links) + residual owned by this closeout plan.
3. Verify `server/modules/contracts/schemaRegistry.ts` has `parameterSpecs.listPromotionCandidates`; run `openapi.test.ts`; close TD-054 in both tech-debt trackers.
4. Update `docs/PLANS.md` + `docs/zh-CN/PLANS.md` active/completed lists.

### Batch B — Platform evidence & automation

Priority regressions (must prove):

| Check | Seam |
| --- | --- |
| Org Admin cannot self-grant `platform-admin`; grant control hidden | UI `/user-permissions` + API `replaceUserRoles` |
| Platform admin denied other-tenant business data | API negative authz (parameters/logs/users) |
| Promote/revert shows cross-tenant blast-radius confirmation | UI `/platform-console` |

Tasks:

1. Mark `PLAT-ROLE-001` covered by extending `permissions-matrix.acceptance.spec.ts` with `@acceptance PLAT-ROLE-001` (route access already asserted).
2. Add browser/API acceptance for `PLAT-ROLE-002` (grant control hidden for Admin; API refuse) and `PLAT-ROLE-003` (cross-org denial) — prefer extending existing permissions/platform fixtures over a new project.
3. For `DRV-PROMOTE-001..005`: automate what the seed can prove; archive `playwright-cli` screenshots + notes for blast-radius / shadowed / promoted chips when seed lacks multi-tenant promote data.
4. Flip coverage-map `Blocking` / operation-matrix `coverage` from No/manual to Yes/automated **or** document Supplemental Manual Evidence in this plan (same pattern as Xiaoze P2).

### Batch C — Governance acceptance surface

1. Register the nine governance IDs in:
   - `docs/developer/browser-acceptance-coverage-map.md` (+ ZH)
   - `docs/developer/user-operation-coverage-matrix.md` (+ ZH)
   - `e2e/acceptance/requirements.ts`
   - `e2e/acceptance/operationMatrix.ts`
2. Wire automated markers where existing Admin acceptance already covers the behavior (e.g. identity mapping admin path → `IDMAP-*`); otherwise `coverage: "future"` / `Blocking: No` with honest deferral — **no fake green**.
3. Browser smoke (playwright-cli): deprecate/restore affordances on `/parameter-admin/specs`, identity-mapping three-state UI, unclassified restore entry, overlay retire impact entry, module sort affordances.
4. Explicitly leave D1–D8 and D-AG-* untouched.

### Batch D — Docs gate & verification

1. Documentation Impact Matrix rows below updated or marked unchanged with evidence.
2. Run verification commands; archive screenshots under `work/ui-checks/governance-closeout-*`.
3. Move **this** plan to `completed/` only after Batch A–C success criteria are checked. **Done** — archived after #216.

## Documentation Impact Matrix

| Area | Action | Paths |
| --- | --- | --- |
| Planning | Update | this plan; `docs/PLANS.md`; `docs/zh-CN/PLANS.md`; archive three source plans + ZH follow-up |
| Tech debt | Update | `docs/exec-plans/tech-debt-tracker.md`; `docs/zh-CN/exec-plans/tech-debt-tracker.md` (TD-054) |
| Quality / acceptance | Update | `docs/developer/browser-acceptance-coverage-map.md`; `docs/developer/user-operation-coverage-matrix.md`; Chinese companions |
| Frontend | Review | `docs/FRONTEND.md` / ZH — only if acceptance copy or route labels change |
| API contract | Review | `docs/design-docs/api-contract.md` / ZH — no change expected (no new endpoints) |
| Security | Review | `docs/SECURITY.md` — confirm platform grant/cross-tenant wording still accurate |
| Deferred design | Review | both deferred-questions docs — confirm still open, not falsely closed |
| ADR / domain / product specs | No change | — |
| Generated artifacts | No change | — |

## Documentation Update Gate

Blocking. Do not move this plan to `completed/` until every Update/Review row is done or recorded unchanged, TD-054 disposition is honest, acceptance maps list the new governance IDs, and `npm run docs:check` passes.

## UI Interaction Automation

| ID | Behavior | Target |
| --- | --- | --- |
| `PLAT-ROLE-001` | Platform console access vs deny | Extend `permissions-matrix.acceptance.spec.ts` |
| `PLAT-ROLE-002` | Org Admin cannot grant platform-admin | New assertion in permissions/users acceptance |
| `PLAT-ROLE-003` | Platform admin cross-org denial | API/browser negative path |
| `DRV-PROMOTE-001..005` | Shadowed/promoted/refuse/blast-radius/revert | Automate or supplemental manual evidence |
| `SPEC-DEPRECATE-001` … `MOD-ATTR-SORT-001` | Admin governance affordances | Register; automate where fixtures allow |

## Verification

```bash
npm run test:server -- server/modules/contracts/openapi.test.ts --run
npx vitest run server/modules/auth server/modules/users src/app/permissions.test.ts
npm run acceptance:coverage
npm run acceptance:operations
# targeted when DB available:
# npm run acceptance:browser -- e2e/acceptance/permissions-matrix.acceptance.spec.ts
npm run build
npm run docs:check
```

playwright-cli (API mode, authenticated demo admin / platform-admin as needed):

```bash
playwright-cli -s=gov-closeout open http://127.0.0.1:5173/platform-console
# resize 1440 900 / 768 1024 / 390 844 → snapshot + screenshot → console error
# repeat for /user-permissions, /parameter-admin/modules, /parameter-admin/identity-mapping,
# /parameter-admin/specs, /parameter-admin/spec-review
```

## Residual after this plan (intentionally open)

- Deferred grilling: parameter-governance D1–D8; attribution D-AG-01–04 (TD-046, TD-047).
- Any `DRV-PROMOTE-*` still manual because seed lacks multi-org promote fixtures — keep as Supplemental Manual Evidence or `coverage: "future"`, not silently closed.
- M6 target evidence / TD-042 cutover rehearsal — separate programs.
