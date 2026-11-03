# DTS editing and managed parameter scope

> Chinese: [DTS 源码编辑与参数纳管范围](../../zh-CN/exec-plans/active/2026-11-03-dts-managed-source-scope.md)

Status: implementation and verification in progress. [PR #1492](https://github.com/tzrea1-Q/WiseEff/pull/1492) owns executable evidence and final merge status; this plan does not claim a PostgreSQL, browser or production pass.

## Problem and accepted behavior

The source editor currently rejects a whole DTS save when a retained parameter's Organization registration is retired and its source changes. Retirement is a management decision, while project source files are allowed to contain unmanaged content. Requiring restoration merely to edit those bytes conflates the two responsibilities.

| Source item | Whole-source editing | Parameter synchronization | Current parameter reads |
| --- | --- | --- | --- |
| Eligible current subject and definition, active registration and required owner | Allowed after normal source validation and authorization | Append values and exact source pins, including ordinary deletion receipts | Current synchronized value |
| Inactive registration, current subject, required owner or current definition | Allow modification, removal and origin movement | Freeze an exclusion; retain the prior value, pin and history | Excluded |
| Unknown or unregistered property | Preserve as valid source content | No implicit definition, registration or Binding creation | Excluded |
| Restored eligibility with a historical pin | Allow source editing | Reconcile the same Binding from latest effective source during the next authorized save | Hidden until reconciliation |
| Restored eligibility whose property is still absent | Allow source editing | Keep the historical Binding and exclusion; do not write the old value into source | Excluded |

A `deprecated` Definition remains eligible for synchronization and current reads; only `retired` leaves the managed definition scope. A subject requiring an owning subject is eligible only while that owner and its Organization registration are active. An inactive owner yields `owner-inactive`, even if the child's own registration remains active.

This implements the retirement interpretation in [ADR-0042](../../adr/0042-organizations-register-canonical-subjects-once.md). It changes whole DTS revisions and their unchanged JSON companions, plus how adjacent source workflows retain an already-proven suspension. It does not authorize production deployment, a raw-file save bypass, or arbitrary JSON mutation.

## Implementation

1. Determine management eligibility from the current Catalog subject and definition, any required owning subject, and their Organization registrations. Exclude ineligible Bindings before validating whether their pins belong to the current source revision, because historical pins are intentional during suspension.
2. Freeze `excludedBindings` alongside the ordinary managed cohort, including exact Binding, value, pin, definition, registration, source identity and exclusion reason. Reinspect under existing governance and source locks at apply time; any lifecycle, Catalog, source or value race invalidates the preview. On approved commit, retain an immutable suspension receipt and an independent audit event for each Binding. Each audit contains only that Binding's exact identity, applied configuration and proof digest; it does not contain other definitions or a shared request/audit reference that could couple their erasure.
3. Keep excluded rows outside the synchronization cohort. A source save advances file/configuration versions without appending values, pins or Binding history for those rows. Existing receipt cardinality and whole-file authorization remain strict.
4. Use a separate managed-current read predicate. Preserve the existing retained owner projection for writes and historical reads. Current list, pagination, comparison, import/copy candidates and default parameter export require active governance and exact current source provenance. A full source package still contains its actual file bytes; unmanaged JSON receives no misleading current mapping.
5. Restore eligibility without modifying source. For an exact historical Binding, require the independently retained receipt of its prior approved exclusion before resuming. Match the complete identity and audit evidence and the revision ordering within the same configuration. Reconcile a present DTS property as an explicit set from the new parsed source, even when its value equals the old value. Reconcile an unchanged JSON companion only after verifying its exact bytes and locator. Keep absent properties historical. Recover historical logical-node continuity when a removed node returns, preventing a duplicate Binding.
6. Single and batch parameter edits, member addition/removal, JSON adoption, baseline capture and baseline restore skip only exact historical Bindings with a prior approved suspension receipt. They continue operating on active parameters and real source files without repinning suspended values. A stale pin alone never grants an exception. These adjacent operations do not resume a suspended Binding after governance restoration; whole-source save owns that reconciliation. If an original source member is removed after its suspended property moves elsewhere, keep the retained owner discoverable internally so a later whole-source save can reuse its identity. The member tombstone must not pretend to delete a suspended Binding absent from its managed removal manifest.
7. Add a forward-only database migration for narrow exclusion/resumption receipt validation. Preserve existing tenant, owner, current-value CAS, absence-pin, origin-transfer, audit and request-result constraints. Do not edit previously applied migrations.

## Independent retention evidence

Retirement retains evidence; destructive definition erasure remains a separately authorized operation. When X and Y were suspended in the same source revision, purging X may erase X's own receipt and the shared source request, but Y's independent receipt and audit must survive. Y can then regain management eligibility and reconcile from the latest DTS with its original Binding identity. No X-specific content is retained in Y's evidence to achieve this.

The receipt is created by the trusted database commit path, not by a caller-supplied exception. It proves continuity only: restoration still requires current subject/owner/registration eligibility, exact current-value and source-pin identity, correct configuration ordering, normal source authorization and a new committed audit. Missing or forged evidence still fails closed. Preserving Y's proof neither authorizes the purge nor enlarges permission to restore a Binding.

## Verification and delivery

The coordinator owns the impact selector, affected TypeScript/build/static gates, full PR CI, one independent review and the final required Merge bar. Changed database behavior requires real PostgreSQL under the restricted API role. Compiler-stub integration tests qualify database behavior only; existing native DTS suites remain required for compiler acceptance. Actual local availability, commands, PostgreSQL results and CI results belong in the PR; selection or test implementation alone is not execution evidence.

Required cases include:

- Retired value, property removal, whole-node removal, subject change and origin movement; repeated saves preserve exact history.
- Active, retired and unknown properties in the same configuration; new managed properties remain materializable while retained historical pins exist.
- Registration, required owner and current Catalog retirement/restoration between preview and apply; no partial file/value/audit mutation. Deprecated definitions remain managed.
- Restore after source modification, absence and whole-node removal/reappearance; original Binding identity, latest source value, idempotent retry and no historical writeback.
- Unchanged JSON companion retention and restoration, current-read filtering and exact historical access.
- Single/batch edits, member addition/removal, JSON adoption and baseline capture/restore with an exact prior suspension; active parameters remain usable and suspended values/pins stay unchanged. Remove an old source member after a suspended origin move, then restore governance and reconcile the original Binding from the surviving source.
- Forged exclusions, wrong owner/pin, unapproved resumption and a derived DTS resumption are refused by database constraints.
- X and Y suspended by one real source request; the authorized definition-purge service removes X and the shared request, while Y retains its value/pin/history and resumes from the latest DTS with the same Binding. The test must perform real purge rather than manually deleting the request.
- Existing authorization, tenant isolation, raw-save fences, current-value CAS, deletion provenance, audit rollback and native DTS validation remain green.

Open one PR against current `main`, update that PR for findings, and merge only when every task-required check for its exact head succeeds. Deployment and production data repair are separate work.

## Documentation Impact Matrix

| Document | Change |
| --- | --- |
| This plan and Chinese companion | Scope, design, acceptance and delivery boundaries |
| ADR-0042 and Chinese companion | Retirement retains history while source editing remains independent; restoration reconciles latest source |
| Generated database schema | Forward migration inventory and actual schema representation |
| PR description | Current candidate, commands/results, independent review and merge state |

## Documentation Update Gate

Keep both language versions and ADR-0042 aligned with the final behavior. Run documentation governance and generated-schema checks for the candidate. Update verification claims only from observed current-head results; CI, merge and deployment remain unclaimed until their own evidence exists.
