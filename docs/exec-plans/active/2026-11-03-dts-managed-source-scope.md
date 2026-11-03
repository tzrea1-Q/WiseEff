# DTS editing and managed parameter scope

> Chinese: [DTS 源码编辑与参数纳管范围](../../zh-CN/exec-plans/active/2026-11-03-dts-managed-source-scope.md)

Status: implementation and verification in progress. The current PR owns executable evidence and final merge status; this plan does not claim a PostgreSQL, browser or production pass.

## Problem and accepted behavior

The source editor currently rejects a whole DTS save when a retained parameter's Organization registration is retired and its source changes. Retirement is a management decision, while project source files are allowed to contain unmanaged content. Requiring restoration merely to edit those bytes conflates the two responsibilities.

| Source item | Whole-source editing | Parameter synchronization | Current parameter reads |
| --- | --- | --- | --- |
| Current active subject and definition, active registration | Allowed after normal source validation and authorization | Append values and exact source pins, including ordinary deletion receipts | Current synchronized value |
| Retired registration, current subject or current definition | Allow modification, removal and origin movement | Freeze an exclusion; retain the prior value, pin and history | Excluded |
| Unknown or unregistered property | Preserve as valid source content | No implicit definition, registration or Binding creation | Excluded |
| Restored eligibility with a historical pin | Allow source editing | Reconcile the same Binding from latest effective source during the next authorized save | Hidden until reconciliation |
| Restored eligibility whose property is still absent | Allow source editing | Keep the historical Binding and exclusion; do not write the old value into source | Excluded |

A `deprecated` Definition remains eligible for synchronization and current reads; only `retired` leaves the managed definition scope.

This implements the retirement interpretation in [ADR-0042](../../adr/0042-organizations-register-canonical-subjects-once.md). It changes whole DTS revisions and their unchanged JSON companions. It does not authorize production deployment, a raw-file save bypass, or arbitrary JSON mutation.

## Implementation

1. Determine management eligibility from the current Catalog subject and definition plus the Organization's current registration. Exclude ineligible Bindings before validating whether their pins belong to the current source revision, because historical pins are intentional during suspension.
2. Freeze `excludedBindings` alongside the ordinary managed cohort, including exact Binding, value, pin, definition, registration, source identity and exclusion reason. Reinspect under existing governance and source locks at apply time; any lifecycle, Catalog, source or value race invalidates the preview.
3. Keep excluded rows outside the synchronization cohort. A source save advances file/configuration versions without appending values, pins or Binding history for those rows. Existing receipt cardinality and whole-file authorization remain strict.
4. Use a separate managed-current read predicate. Preserve the existing retained owner projection for writes and historical reads. Current list, pagination, comparison, import/copy candidates and default parameter export require active governance and exact current source provenance. A full source package still contains its actual file bytes; unmanaged JSON receives no misleading current mapping.
5. Restore eligibility without modifying source. For an exact historical Binding, require a prior approved source request containing the same exclusion identity before resuming. Reconcile a present DTS property as an explicit set from the new parsed source, even when its value equals the old value. Reconcile an unchanged JSON companion only after verifying its exact bytes and locator. Keep absent properties historical. Recover historical logical-node continuity when a removed node returns, preventing a duplicate Binding.
6. Add a forward-only database migration for narrow exclusion/resumption receipt validation. Preserve existing tenant, owner, current-value CAS, absence-pin, origin-transfer, audit and request-result constraints. Do not edit previously applied migrations.

## Verification and delivery

The coordinator owns the impact selector, affected TypeScript/build/static gates, full PR CI, one independent review and the final required Merge bar. Changed database behavior requires real PostgreSQL under the restricted API role. Compiler-stub integration tests qualify database behavior only; existing native DTS suites remain required for compiler acceptance. Local PostgreSQL is unavailable in this execution environment, so database acceptance is CI-owned and remains pending until it actually runs.

Required cases include:

- Retired value, property removal, whole-node removal, subject change and origin movement; repeated saves preserve exact history.
- Active, retired and unknown properties in the same configuration; new managed properties remain materializable while retained historical pins exist.
- Registration and current Catalog retirement/restoration between preview and apply; no partial file/value/audit mutation.
- Restore after source modification, absence and whole-node removal/reappearance; original Binding identity, latest source value, idempotent retry and no historical writeback.
- Unchanged JSON companion retention and restoration, current-read filtering and exact historical access.
- Forged exclusions, wrong owner/pin, unapproved resumption and a derived DTS resumption are refused by database constraints.
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
