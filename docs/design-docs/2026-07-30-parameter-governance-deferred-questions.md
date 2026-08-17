# Parameter governance — deferred questions

> Planning input, not a plan. Written 2026-07-30 alongside `docs/exec-plans/completed/2026-07-30-parameter-governance-state-machine-completion.md`.
> Status: **Locked 2026-08-18**. Do not reopen semantics in implementation PRs without a new grilling note.
> Governing ADRs: [0032](../adr/0032-semantic-edits-on-active-definitions-mint-a-successor.md), [0033](../adr/0033-identity-mapping-uses-protected-re-resolve.md), [0034](../adr/0034-referenced-property-key-rename-is-a-source-cutover.md), [0035](../adr/0035-debug-value-promotion-stages-drafts.md). ADR numbers are merge-time claims ([fleet coordination](../agents/fleet-coordination.md)); renumber on conflict with `origin/main`.

This document was the agenda for the next planning session. The 2026-08-18 lock records **which option won**, **which option lost**, and **what an implementation session may write**. It is not a license to implement TD-063 as reload → change request, and it does not edit the tech-debt tracker.

## Locked decision table

| ID | Chosen | Rejected | ADR / note |
| --- | --- | --- | --- |
| **D1** | ADR-0014 stands. Definition lifecycle stays definition-level. Activation of changed content on an **active** spec inserts a successor version + cutover run; historical binding revisions stay pinned. Mock must follow the API. | Per-version definition lifecycle (`deprecate v1, keep v2` as a definition fact). In-place activate as the semantic path. Mock-only version bumps. | ADR-0014; remaining hole is D2 / [ADR-0032](../adr/0032-semantic-edits-on-active-definitions-mint-a-successor.md) |
| **D2** | Semantic fields (`value_shape`, `constraints`, `units`) on active/deprecated specs change **only** via activate → successor. PATCH is documentation-class only. | Forbid all active edits (deprecate + create). PATCH minting a successor. PATCH remaining a full in-place editor. | [ADR-0032](../adr/0032-semantic-edits-on-active-definitions-mint-a-successor.md) |
| **D3** | Protected **re-resolve** on the same resolved task. No inverse undo. Reopen stays `dismissed` / `new_identity` only. Downstream usage or missing continuity → `409` `identity-mapping-migration-required`. | Inverse of `applyReviewedIdentityMapping`. Reopening `resolved`. New DTS upload as the *only* remedy. | [ADR-0033](../adr/0033-identity-mapping-uses-protected-re-resolve.md) (server path already exists; mock/UI/contract still lag) |
| **D4** | Tree shows **定义数** (distinct specs in the subtree) and **实测处数** (bindings, node × project). Library **引用数** is 实测处数 scoped to one definition — the same fact as the deprecation reference count. No third tree metric. | One rolled `parameterCount` meaning both facts. Treating 引用数 as a separate tree count. | ADR-0010 already required the split; the tree UI still rolls one number |
| **D5** | Overlay 停用解析 does **not** require a successor. Coverage-loss acknowledgement (`confirmCoverageLoss`) is required when `coverageLoss` is true. Withdrawing untrusted knowledge is legitimate. | Hard-block retirement until a platform/vendor/org successor exists. Silent retire without impact preview. | Ratifies the shipped impact dialog + server gate |
| **D6** | Classify each ranking site: **pin** to the binding/CR version when one exists; otherwise rank `version_status` active → superseded → draft. Cross-spec match ranks `definition_lifecycle` active → deprecated → draft, then version status, then version desc. Draft must never beat the deprecated definition a binding actually uses. | Keep `active vs else` (deprecated and draft in one bucket). Using rank on writeback instead of the pinned version. | Implementation audit list below |
| **D7** | **No** new lifecycle. Structural keys are not parameters (ADR-0003). Migration `0081` deleted the 0068 `status` cohort and CHECK-prevents re-entry. The next structural property is added to `STRUCTURAL_PROPERTY_KEYS` + that CHECK — never by borrowing `deprecated`. | A `not-a-parameter` lifecycle marker. Reusing deprecation for structural properties. | Closed by existing work |
| **D8** | Organization overlay list shows superseded rows as **已提升至平台层** plus successor source. They do not disappear. | Hide superseded org rows. | Ratifies ADR-0009 + shipped `ModuleEditDialog` |
| **D9** | Closed 2026-08-01 as TD-054. | — | Historical |
| **TD-117** | Referenced `property_key` rename is a **staged source-rewriting cutover**. Zero-ref rename stays on the existing route. No inline editor field. Do not reopen ADR-0017. | Stay forbidden forever. Confirm-and-rename in the editor. Catalog alias. Deprecate + recreate. Fold into version cutover. | [ADR-0034](../adr/0034-referenced-property-key-rename-is-a-source-cutover.md) |
| **TD-063** | Promotion creates **parameter drafts** from selected reload targets, then stops. Reload write paths stay library-read-only (ADR-0019). Do not create change requests from deploy. | Write debug values into bindings. Birth a CR without a draft. Use knowledge distillation as the library path. Auto-submit. Promote `restore-baseline` / `contradicted` / `failed`. | [ADR-0035](../adr/0035-debug-value-promotion-stages-drafts.md) |

## What the 2026-07-30 round settled (unchanged)

The boundary matters, because several locked items only make sense against it.

| Settled | Where |
| --- | --- |
| Parameter definition lifecycle closes as `draft → active`, `draft\|active → deprecated`, and `deprecated →` whichever state it had reached before. No `active → draft`, no delete | ADR-0011, plan Batch 1–2 |
| Deprecation is **soft retirement**: the definition keeps parsing, and loses only review-task selectability and default library visibility | ADR-0011 |
| Deprecation is stated for the definition as a whole | ADR-0011; **not** reopened by D1 |
| Identity mapping `dismissed` splits into "reject this candidate" (ambiguity stands) and "confirm as new identity" (ambiguity cleared) | plan Batch 3 |
| Config revision `published` retires; releasing happens at the file layer through release baselines | ADR-0012 |
| The overlay act is named 停用解析 and the definition act is named 废弃, because they have opposite consequences | ADR-0011 |
| Module tree gains a `sortOrder` affordance only | plan Batch 5 |

## Suggested implementation split (later sessions)

Do not bundle these into one PR. Do not implement TD-063 as reload → CR.

1. **ADR-0032 / D2 (+ D1 mock parity)** — PATCH `409 semantic-edit-requires-successor`; `guardActivateParameterSpec` allows active; mock activate follows API successor/cutover. Closes the TD-048 residual once mock and API agree.
2. **D6 ranking audit** — retarget the sites listed below; no new ADR.
3. **D4 / TD-052** — module DTO + tree UI: 定义数 and 实测处数; keep library 引用数 as the per-definition binding count.
4. **ADR-0033 honesty** — API contract + mock + resolved-task UI for protected re-resolve. Server already implements it.
5. **ADR-0034 / TD-117** — property-key source cutover (large; own plan). Keep `rename-property-key` refused while `referenceCount > 0` until that plan ships.
6. **ADR-0035 / TD-063** — `promote-to-drafts` command only. Out of scope: writing change requests, mutating bindings, touching deploy.

**Already shipped — no implementation session:** D5, D7, D8 (ratify). Session 0 may close the matching tracker rows against this lock; this change does not edit the tracker.

## D1 — Versioned parameter definitions

**2026-07-30 fact base (stale in one respect):** `parameter_spec_versions` existed but activate was described as in-place. **2026-08-18:** `POST .../activate` on an active spec with changed content already inserts a successor and a `parameter_spec_version_cutover_run` (API contract; `activateParameterSpec` in `parameter-specs/service.ts`). Draft activate still updates the single version in place, which is correct because there is no predecessor to preserve.

**Locked:**

1. Do not make definition lifecycle per-version. "Deprecate v1, keep v2" is expressed as version_status `superseded` + a new `active` version under one `ParameterSpec`, not as two definition lifecycles.
2. Bindings stay pinned to `parameter_spec_version_id` on the revision they were written against. Cutover finalize moves **tip** revisions only (ADR-0014).
3. Mock must not refuse activate on active specs, and must not invent a different version history than the API.

**Rejected:** turning lifecycle into a per-version fact; keeping in-place activate as the way to change live meaning.

## D2 — Constraining semantic edits to active definitions

Depends on D1. The 2026-07-30 round added audit + save-confirm diff only (SE-D5). PATCH still rewrites semantic fields on the current version.

**Locked:** [ADR-0032](../adr/0032-semantic-edits-on-active-definitions-mint-a-successor.md). Semantic change → activate successor. PATCH documentation-class only. `409` `semantic-edit-requires-successor` when PATCH would change `value_shape` / `constraints` / `units`.

**Rejected:** deprecate-and-create as the only path; PATCH as a second successor door; leaving PATCH as the live semantic editor.

The audit trail remains: documentation PATCHes still record before/after when those fields change; successor activation keeps `spec-activated` / cutover audits.

## D3 — Inverse remap for resolved identity mapping tasks

**Locked:** [ADR-0033](../adr/0033-identity-mapping-uses-protected-re-resolve.md). `resolveIdentityMappingTask` already re-resolves a `resolved` identity-ambiguity task when continuity evidence exists and downstream usage is zero (`reResolveReviewedIdentityMapping`).

**Rejected:** building an inverse undo; reopening `resolved`.

**Still to implement:** mock second-resolve currently CONFLICT; API contract line for resolve does not yet spell out the resolved-task branch; Admin UI should expose the candidate picker when re-resolve is legal.

## D4 — 定义数 versus 实测处数

`aggregateSubtreeParameterCounts` still rolls a single `parameterCount` (`moduleAttributionTreeUtils.ts`) with a TODO pointing at ADR-0010. `ModuleAttributionTree` still renders `{parameterCount} 参数`. Chinese `FRONTEND.md` already claims the split — that is doc drift, not a shipped split.

**Locked:**

| Surface | Count | Meaning |
| --- | --- | --- |
| Attribution tree (node + subtree) | 定义数 | Distinct `parameter_spec_id` attributed to the unit and its descendants |
| Attribution tree (node + subtree) | 实测处数 | Bindings (node × project). Today's registry `parameterCount` **is** this fact; rename the label, do not invent a third rollup |
| Definition library / spec detail | 引用数 (`referenceCount` / UI `usageCount`) | Bindings pointing at **that** definition (org-wide). Same fact used to gate property-key rename and deprecation impact |

**Rejected:** one number for both tree facts; showing 引用数 as a third tree column.

Module list DTO today exposes `parameterCount` only (`GET /api/v2/parameter-modules`). Implementation adds a sibling `definitionCount` (or equivalent) and updates the tree labels. Do not change binding uniqueness or ingest to make the numbers coincide.

## D5 — Successor requirement before overlay retirement

Shipped: `GET .../deprecation-impact` plus `POST .../deprecate` with `confirmCoverageLoss` required when `coverageLoss` is true (`driverSchemaOverlayService.ts`). The dialog states 无后继解析来源 as high risk, not as a hard stop.

**Locked:** do **not** require a successor. Acknowledgement stays mandatory on coverage loss. Successor (platform tier, vendor schema, another overlay) is displayed when present and makes `coverageLoss` false.

**Rejected:** fail-closed retirement until a successor exists (would turn 停用解析 into a blocked act with no workaround for knowledge you no longer trust).

## D6 — Lifecycle ranking in name and value resolution

ADR-0014 already asked for this audit. The `active vs else` expression is still live. Current sites (re-check at implementation time; line numbers move):

| Site | Role | Locked behaviour |
| --- | --- | --- |
| `parameters/semanticParameterReads.ts` (lateral) | Binding list display | **Pin** to the tip binding revision's `parameter_spec_version_id`. Do not rank. |
| `parameters/repository.ts` (lateral ~456) | Binding list | **Pin** the same way. |
| `parameters/semanticParameterIdentityNames.ts` (`SEMANTIC_ACTIVE_SPEC_VERSION_LATERAL`) | Dashboard / identity names | **Pin** when a binding revision is in scope; otherwise `version_status` active → superseded → draft. |
| `parameter-files/writebackService.ts` | Merge writeback | **Pin** to the change-request / binding-revision version. Ranking on this path is a defect. |
| `parameters/reviewWorkflowRepository.ts` (four laterals) | Change-request display | **Pin** when `binding_revision_id` (or equivalent) is present; else `version_status` rank, never `active vs else`. |
| `parameter-topology/migration.ts` | Candidate spec match | **Rank** `definition_lifecycle` active → deprecated → draft, then `version_status`, then `version desc`. A draft must not outrank the deprecated definition that still parses. |

**Rejected:** leaving deprecated and draft in one SQL bucket; using rank to pick a writeback version.

Prefer `version_status` over `psv.lifecycle` at version-row sites once both columns are present. Definition-level `deprecated` is a spec fact, not a version tie-break.

## D7 — The migration 0068 cohort: deprecated but still parsing

**Locked:** no distinct "not a parameter" lifecycle. ADR-0003 + migration `0081_remove_structural_parameter_specs.sql` already removed the structural cohort (including `status`) and added a database check so those keys cannot re-enter `dts_property_specs`. Ingest still short-circuits `STRUCTURAL_PROPERTY_KEYS` before matching.

**Rejected:** a new lifecycle value; using `deprecated` for the next structural property.

If another property turns out to be structural, extend `STRUCTURAL_PROPERTY_KEYS` and the `0081` CHECK literals together (the alignment test in `parameterSurface.test.ts` already exists).

## D8 — Visibility of superseded overlays

**Locked:** the organization governance surface keeps superseded rows and labels them 已提升至平台层 with 后继来源 (shipped in `ModuleEditDialog`). Promotion remains a platform act (ADR-0009).

**Rejected:** dropping superseded rows from the org list (reads as unexplained deletion).

## TD-117 — Referenced `property_key` rename

**Locked:** [ADR-0034](../adr/0034-referenced-property-key-rename-is-a-source-cutover.md). Source rewrite through existing draft/CR machinery, then catalog triple switch on finalize. Zero-ref rename unchanged.

**Rejected:** forever-forbidden, inline field, alias, deprecate+recreate, folding into version cutover.

**Implementation session input:** new run/item tables (do not overload `parameter_spec_version_cutover_*`); refuse start when a version cutover is open on the same spec; no skip that leaves the old key in source; do not enable 修正属性键 while `referenceCount > 0` until finalize exists.

## TD-063 — Promote a proven debug value into the library

**Locked:** [ADR-0035](../adr/0035-debug-value-promotion-stages-drafts.md). Command creates drafts only. ADR-0019 holds.

**Rejected:** reload write path mutation; CR-without-draft; knowledge distillation as the library path; auto-submit; promoting restore-baseline / contradicted / failed.

**Implementation session input:** `POST` on the reload run resource → `promote-to-drafts`; reuse `createBindingDraft`; require reload read gate **and** `parameter:edit`; keep the run-skeleton library-fingerprint assertion; do **not** insert into `parameter_change_requests` from this command.

## Explicitly out of the domain — do not re-open without new evidence

These were considered in the 2026-07-30 round and rejected on modelling grounds rather than deferred. Re-opening them should require a new fact, not a new preference.

**`curated → auto` on modules.** `CONTEXT.md` defines module adoption as a one-way stated fact: an Admin who renames, moves, or re-weights an auto-discovered module makes it curated from then on, and there is no separate adopt action. Adding an un-adopt would let a human decision disguise itself as an ingest decision, which is exactly what ADR-0004 set out to prevent by stating origin instead of inferring it.

**Re-kinding a driver group.** A driver group is defined by the compatibles mapped to it, and the driver registry is a view over curated driver groups (ADR-0007). Changing its kind would either orphan the mappings or leave a business category holding compatible rules, which ADR-0010 forbids.

**Config revision `published`.** Retired by ADR-0012. A config revision is a derived read model of a parsed file version, not a releasable artifact. Anyone tempted to restore the enum value should first read why the release unit is the baseline.

## Tracker note for session 0

This change does **not** edit `docs/exec-plans/tech-debt-tracker.md` or `docs/PLANS.md`. Session 0 should record:

| TD | After this lock | Decision link |
| --- | --- | --- |
| TD-048 | **Stays Open** until ADR-0032 (PATCH door + mock activate/cutover parity) lands. Tracker text about "activate always in-place / mock bumps version" is stale. | ADR-0032, D1/D2 |
| TD-049 | **Stays Open** until the D6 site table is applied. | D6 |
| TD-050 | **Closeable** — D7 locked as already shipped (ADR-0003 + migration `0081`). | D7 |
| TD-051 | **Stays Open** until mock/UI/API-contract honesty for re-resolve. Server behaviour is ADR-0033. | ADR-0033, D3 |
| TD-052 | **Stays Open** until the tree DTO/UI split. | D4 |
| TD-053 | **Closeable** — D5 and D8 locked as the shipped confirm-and-show behaviour. | D5, D8 |
| TD-117 | **Stays Open**; the missing decision is made. Next action is the ADR-0034 cutover plan/implementation, not an inline editor. | ADR-0034 |
| TD-063 | **Stays Open**; the missing design is made. Next action is ADR-0035 `promote-to-drafts`, **not** reload → CR. | ADR-0035 |
