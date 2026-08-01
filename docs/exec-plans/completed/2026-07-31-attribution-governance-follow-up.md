# Attribution governance follow-up (cutover, identity UI, honesty)

> Status: **Completed (implementation merged).** PR7–PR9 landed via #215 (`feat/attribution-subject-versioned-specs`). Deferred D-AG-01–04 remain in `docs/design-docs/2026-07-31-attribution-governance-deferred-questions.md`. **Residuals** (identity-mapping viewport evidence, acceptance surface) owned by [`2026-08-01-governance-platform-closeout.md`](../active/2026-08-01-governance-platform-closeout.md).  
> Date: 2026-07-31  
> Continues: [`2026-07-30-attribution-subjects-and-versioned-specs.md`](../active/2026-07-30-attribution-subjects-and-versioned-specs.md) (PR0–PR6)  
> Chinese: [`docs/zh-CN/exec-plans/completed/2026-07-31-attribution-governance-follow-up.md`](../../zh-CN/exec-plans/completed/2026-07-31-attribution-governance-follow-up.md)

## Goal

Close the **already-decided** product gaps left after PR0–PR6, without reopening items that still need design grilling.

## Git & PR Workflow

Implementation agents commit on the feature branch only; parent opens/merges GitHub PRs.

| Batch | Commit theme | Status |
| --- | --- | --- |
| PR7 | Spec version cutover finalize HTTP + Admin confirm flow | done |
| PR8 | Identity-mapping UI for `new_identity` / singleton guidance | done |
| PR9 | Honesty & UX polish (toast, deprecate defaults, overlay-only claim, subject-primary display, nature/cardinality read-only) | done |

## Locked decisions (this grilling)

Carried from ADR-0013/0014 and the parent plan unless noted:

1. **PR7 — staged cutover with tip bindings:** Expose finalize (and status/impact read if needed) over HTTP at org-Admin parity with activate. Admin UI: when a cutover run is `preparing`, show impact → confirm switch. No new cutover semantics — wire the existing `finalizeParameterSpecVersionCutover` service.
2. **PR8 — identity mapping UI:** Surface `taskKind`. For identity ambiguity: add `new_identity` + multi-candidate `confirmAllCandidates`. For `singleton-cardinality`: explain + guide to registration/topology fix; do **not** resolve by picking a logical node (matches API `409`). Workbench stays publish-blocker only.
3. **PR9 — success feedback (D7):** Short toast for create / activate / deprecate / restore success; failures stay in-form. Audit banner prose stays gone.
4. **PR9 — soft deprecate defaults (ADR-0014):** Default spec library excludes `deprecated`; open review selection allows `active` (and activatable `draft` if already allowed), never `deprecated`. Detail remains open for restore.
5. **PR9 — coverage claim honesty:** Public contract and UI expose **only** `overlay-property`. Remove or mark `pinned-schema-property` as unsupported in this release.
6. **PR9 — library display:** **参数定义** = `property_key`; **驱动模块** = attribution taxonomy path (fallback `driverModule` / 未归类). Compat `driverModule` string remains on detail as a secondary field.
7. **PR9 — driver nature / cardinality:** **Read-only** display on registration/module governance + singleton task copy. Editing authority and post-edit remediation stay deferred.

## Out of scope (this plan)

- Editing `driverNature` / `instanceCardinality` and multi-instance remediation policy → deferred doc.
- Implementing `pinned-schema-property` claims → deferred doc.
- Forcing/backfilling `driverModule` ↔ subject consistency (TD-047 body) → deferred doc.
- Replacing `businessCategoryForNodePath` with Admin placement rules (TD-046) → deferred / tech debt.
- Large-only refactors of `parameter-specs/service.ts` unless touched by PR7–PR9.
- Opening/merging the GitHub PR for PR0–PR6 (parent release process; list under Verification).

## Tasks

### PR7 — Cutover finalize

- [x] HTTP route(s) for cutover status/impact + `finalizeParameterSpecVersionCutover` (authz/audit aligned with activate).
- [x] OpenAPI + api-contract EN/ZH.
- [x] Admin UI on spec detail/activate path when run is `preparing`.
- [x] Integration tests: tip bindings → preparing → finalize → successor active / old superseded.

### PR8 — Identity mapping UI

- [x] `IdentityMappingReview` (or successor): `taskKind` badges; `new_identity` + `confirmAllCandidates`; singleton guidance (no false resolve).
- [x] Port/client types for existing resolve decisions.
- [x] Browser check `/parameter-admin/identity-mapping` at 1440/768/390. **Done in closeout:** `work/ui-checks/governance-closeout-param-identity-{desktop,tablet,mobile}.png` (0 console errors).

### PR9 — Honesty & polish

- [x] Toast for governance success paths listed above.
- [x] Default library + review selection filters per ADR-0014.
- [x] Schema/UI/docs: overlay-only coverage claim.
- [x] Spec library/detail: subject-primary display.
- [x] Read-only `driverNature` / `instanceCardinality` on driver registry / module governance surfaces (API DTO exposure if missing).

## Documentation Impact Matrix

| Area | Action | Paths |
| --- | --- | --- |
| Plans | Update | this file; parent attribution plan status; `docs/PLANS.md` + ZH |
| Deferred questions | Update | `docs/design-docs/2026-07-31-attribution-governance-deferred-questions.md` + ZH |
| API | Update | `docs/design-docs/api-contract.md` + ZH (as PR7 routes land) |
| Frontend | Update | `docs/FRONTEND.md` + ZH (cutover UI, identity UI, toast, defaults) |
| ADR | Review | ADR-0013/0014 — no new ADR unless edit policy is later locked |
| Tech debt | Review | TD-046 / TD-047 remain open; link deferred doc |
| CONTEXT | No change | glossary already has Driver registration / Attribution subject / ParameterSpecVersion |
| Product specs | Review | only if copy for cutover/identity changes operator-facing product truth |
| Quality / e2e | Review | acceptance IDs if UI gates change; else record N/A |

## Documentation Update Gate

Block completion until: api-contract + FRONTEND EN/ZH updated for shipped batches; deferred doc still accurate; `npm run docs:check` green; TD-046/047 still point at deferred discussion (not falsely closed).

## Verification

```bash
npm run test:server -- server/modules/parameter-specs/
npm run test:server -- server/modules/parameter-topology/resolveIdentityMapping.test.ts
npm test -- src/components/parameter-topology/
npm run build
npm run docs:check
```

Browser: `/parameter-admin/specs`, `/parameter-admin/identity-mapping`, `/parameter-admin/modules` at 1440/768/390 after UI batches.

Release process (parent): open/merge PR for PR0–PR6 stack; run acceptance evidence if UI-interaction IDs are extended.
