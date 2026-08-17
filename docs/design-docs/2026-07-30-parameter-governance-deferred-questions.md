# Parameter governance — deferred questions for the next round

> Planning input, not a plan. Written 2026-07-30 alongside `docs/exec-plans/completed/2026-07-30-parameter-governance-state-machine-completion.md`.

This document exists because auditing the six governance state machines behind `/parameter-admin` surfaced more open questions than one round should absorb. Each item below was found with evidence, deliberately left out of the current plan, and is recorded here with its fact base so the next round starts from a decision rather than from another investigation.

Read it as the agenda for the next planning session. Nothing here is scheduled.

## What the current round settled

The boundary matters, because several deferred items only make sense against it.

| Settled | Where |
| --- | --- |
| Parameter definition lifecycle closes as `draft → active`, `draft\|active → deprecated`, and `deprecated →` whichever state it had reached before. No `active → draft`, no delete | ADR-0011, plan Batch 1–2 |
| Deprecation is **soft retirement**: the definition keeps parsing, and loses only review-task selectability and default library visibility | ADR-0011 |
| Deprecation is stated for the definition as a whole; no multi-version model is introduced | ADR-0011 |
| Identity mapping `dismissed` splits into "reject this candidate" (ambiguity stands) and "confirm as new identity" (ambiguity cleared) | plan Batch 3 |
| Config revision `published` retires; releasing happens at the file layer through release baselines | ADR-0012 |
| The overlay act is named 停用解析 and the definition act is named 废弃, because they have opposite consequences | ADR-0011 |
| Module tree gains a `sortOrder` affordance only | plan Batch 5 |

## Deferred items

### D1 — Versioned parameter definitions

`parameter_spec_versions` carries a `version` integer that is unique per definition (`server/migrations/0048_parameter_topology_schema_shadow.sql:28`), and bindings reference a **version row** through `project_parameter_binding_revisions.parameter_spec_version_id`. The machinery for versioning is therefore already in the schema. It is unused: `activateParameterSpec` updates the existing row in place rather than inserting a successor (`server/modules/parameter-specs/service.ts:574-591`), and "current version" is simply the highest `version` (`server/modules/parameter-specs/repository.ts:1016-1021`). Every definition in practice has exactly one version row, numbered 1.

The current round decided not to change this, because soft retirement does not need versioning and turning it on reaches into binding pointers, writeback, and every ranking query listed in D6.

What a decision needs to settle: whether lifecycle becomes a per-version fact (so "deprecate v1, keep v2" becomes expressible), whether activation inserts a successor row, and what happens to bindings pinned to a superseded version — do they follow the definition forward, or stay pinned as a historical record of what the value meant when it was written?

Note that the mock runtime already bumps `version` on activate (`src/infrastructure/mock/mockParameterTopologyRepository.ts:528-533`), so mock and API disagree on this point today. Whichever way D1 goes, that divergence should be closed in the same round.

### D2 — Constraining semantic edits to active definitions

Depends on D1.

`PATCH /api/v2/parameter-specs/:specId` rewrites an active definition in place, including `value_shape`, `constraints`, `units`, and `documentation` (`server/modules/parameter-specs/service.ts:687-720`). No version changes, no review is re-run, and before this round no before/after record was kept. Changing the value shape of a live definition is the most consequential act available in parameter governance, and it is the one act with no state transition protecting it.

The current round adds non-repudiation only: before/after `value_shape` and `constraints` go into the governance audit, and the spec-editor save-confirm step shows that JSON diff when either field changed, plus the reference count (`usageCount`) with an extra acknowledgement checkbox when the count is greater than zero. Constraint-key removal on PATCH/activate is replace-not-merge (SE-2); that is write honesty, not a decision that semantic edits on active definitions should be forbidden.

What a decision needs to settle: whether a semantic change should be forbidden on an active definition altogether — forcing "deprecate the old, create the new", which is now a complete path — or whether it should mint a new version under D1. The audit trail added this round makes either choice measurable first: once the audit shows how often semantic fields actually change on active definitions, the constraint can be argued from data instead of from principle.

### D3 — Inverse remap for resolved identity mapping tasks

Resolving an identity mapping task calls `applyReviewedIdentityMapping`, which rewrites binding identity (`server/modules/parameter-topology/service.ts:447-453`). The current round allows reopening only the outcomes that changed no data — rejected candidates and confirmed-new-identity — and protects `resolved` with a confirmation step instead.

That leaves one unrecoverable mistake: resolving to the wrong logical node. Today the only remedy is uploading a new DTS to produce a fresh revision.

What a decision needs to settle: whether the inverse of `applyReviewedIdentityMapping` is safe to build. It is not obviously symmetric, because bindings may have accumulated drafts or submissions against the remapped identity after the resolve. An alternative worth weighing is idempotent re-resolution — allowing a resolved task to be pointed at a different node and re-applied — which avoids modelling an undo at all.

### D4 — 定义数 versus 实测处数

`aggregateSubtreeParameterCounts` rolls a single `parameterCount` up the attribution tree (`src/components/parameter-topology/moduleAttributionTreeUtils.ts`). ADR-0010 already recorded that one number can no longer mean both things once driver groups hold definitions directly: the number of distinct definitions attributed to a unit and the number of measured occurrences (bindings, i.e. node × project) are different facts that now diverge.

This was listed as out of scope in the ADR-0010 plan and stayed out of this one. It becomes more visible after this round, because the deprecated-definition reference count introduces a third count on the same surfaces.

What a decision needs to settle: which counts appear in the tree, which in the definition library, and whether the reference count added for deprecation is the same fact as 实测处数 or a separate one scoped to a single definition.

### D5 — Successor requirement before overlay retirement

Retiring a driver schema overlay withdraws it from the schema registry, because overlays are loaded filtered to `lifecycle = 'active'` (`server/modules/parameter-specs/driverSchemaOverlayRepository.ts:220,235`). Compatibles that relied on it become parse uncovered. This round surfaces the impact before the act but does not prevent it.

What a decision needs to settle: whether retirement should require a successor schema — a platform-tier promotion, a vendor schema now covering the compatible, or another org overlay — so that parse coverage cannot be dropped by a single governance click. The counter-argument is that withdrawing knowledge you no longer trust is legitimate even when nothing replaces it, and that forcing a successor turns retirement into a blocked action with no workaround.

### D6 — Lifecycle ranking in name and value resolution

At least eight queries order candidate spec versions with `case when psv.lifecycle = 'active' then 0 else 1 end, psv.version desc`:

- `server/modules/parameters/semanticParameterReads.ts:95`
- `server/modules/parameters/semanticParameterIdentityNames.ts:49`
- `server/modules/parameter-files/writebackService.ts:256`
- `server/modules/parameters/repository.ts:3131`, `:3459`, `:3574`, `:3708`, `:4531`, `:5063`

The expression puts `deprecated` and `draft` in the same bucket. Before this round that was defensible, because deprecation had no meaning at all. Under soft retirement it is questionable: a deprecated definition is releasable and may be what a binding actually points at, while a draft is by construction not releasable (`server/modules/parameter-specs/schemaLoader.ts:189-195`). Ranking them equally means a draft can outrank the deprecated definition a binding is really using, purely on version order.

The current round does not touch these queries, because each one needs to be read in context to know whether the ordering is a tie-break or a selection.

What a decision needs to settle: whether the ordering should become `active` → `deprecated` → `draft`, and whether any of these call sites should be selecting on releasability rather than ordering on lifecycle at all.

### D7 — The migration 0068 cohort: deprecated but still parsing

Migration `0068_dismiss_structural_spec_reviews.sql:47-59` bulk-deprecated every definition whose property key is `status`, to get node enablement out of the definition library after ADR-0003 established that enablement is not a parameter. Those definitions are still releasable and still parsing, because the loader excludes only `draft`.

Under this round's semantics that is now the documented behaviour rather than an accident, which makes the underlying question sharper: this cohort was never meant to be "a definition we no longer recommend". It was meant to be "not a definition at all". `deprecated` was borrowed as the nearest available state.

What a decision needs to settle: whether the product needs a distinct "not a parameter" marker separate from deprecation, and if so whether it applies to more than the `status` cohort. Reusing deprecation for this hides a modelling gap, and the gap will resurface for the next property that turns out to be structural rather than semantic.

### D8 — Visibility of superseded overlays

`driver_schema_overlays.lifecycle` includes `superseded` (`server/migrations/0079_driver_schema_platform_tier.sql:33-34`), set when platform promotion supersedes the contributing organization rows, and restored to `active` when a promotion is reverted (`server/modules/parameter-specs/driverSchemaOverlayRepository.ts:593-597`). This round places overlay management inside the driver group detail and keeps promotion in `PlatformConsolePage`, but does not decide how a superseded organization row should present itself to the organization that authored it.

What a decision needs to settle: whether an organization sees "your overlay was promoted to the platform tier and is now served from there" as a first-class state on its own governance surface, or whether superseded rows simply disappear from the organization view. The former makes promotion legible to the contributor; the latter keeps the organization surface simple at the cost of an unexplained disappearance.

### D9 — `openapi.test.ts` missing `listPromotionCandidates`

**Closed 2026-08-01** as TD-054: `parameterSpecs.listPromotionCandidates` is in `schemaRegistry.ts` and `openapi.test.ts` passes. Kept here only as historical note from the governance audit.

## Explicitly out of the domain — do not re-open without new evidence

These were considered this round and rejected on modelling grounds rather than deferred. Re-opening them should require a new fact, not a new preference.

**`curated → auto` on modules.** `CONTEXT.md` defines module adoption as a one-way stated fact: an Admin who renames, moves, or re-weights an auto-discovered module makes it curated from then on, and there is no separate adopt action. Adding an un-adopt would let a human decision disguise itself as an ingest decision, which is exactly what ADR-0004 set out to prevent by stating origin instead of inferring it.

**Re-kinding a driver group.** A driver group is defined by the compatibles mapped to it, and the driver registry is a view over curated driver groups (ADR-0007). Changing its kind would either orphan the mappings or leave a business category holding compatible rules, which ADR-0010 forbids.

**Config revision `published`.** Retired by ADR-0012. A config revision is a derived read model of a parsed file version, not a releasable artifact. Anyone tempted to restore the enum value should first read why the release unit is the baseline.

## Suggested framing for the next round

D1 is the root: D2 depends on it, D6 partly depends on it, and D4 changes shape depending on whether counts are per definition or per version. D7 is independent and cheap to decide but touches the domain model rather than code. D3, D5, and D8 are each self-contained and could ride along with unrelated work.

A defensible next round is D1 plus D2 plus D6 as one coherent "definitions have versions and the ranking says so" theme, with D7 settled first because it may remove a cohort from the definition library entirely and therefore changes what D1 has to version.
