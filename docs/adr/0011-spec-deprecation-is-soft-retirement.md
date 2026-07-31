# ADR-0011: Spec deprecation is soft retirement

- Status: Accepted (amended 2026-07-30)
- Date: 2026-07-30
- Plan: `docs/exec-plans/active/2026-07-30-parameter-governance-state-machine-completion.md`

## Context

`parameter_spec_versions.lifecycle` already allowed `deprecated`, but nothing in the product could reach that state except migration `0068`, and the schema loader treated `deprecated` as releasable — identical to `active` for parsing. The definition library could filter by the label, but Admins had no deprecate or restore action. Calling both definition retirement and overlay retirement 「废弃」 would also invite operators to expect the same consequence from two acts with opposite effects.

The first cut additionally refused to deprecate platform-global definitions (`organization_id IS NULL`) outright, on the grounds that they "stay catalog-owned". That conflated two separate questions: **what** deprecation does to a definition (soft retirement, answered below) and **who** may perform it on a global row. The former is unchanged; the latter was revisited after the platform tier shipped.

## Decision

1. **Deprecation is soft retirement of a parameter definition.** A deprecated definition stays releasable for DTS parsing so no project loses parse coverage because of a governance click. It loses only review-task selectability and presence in the default library view.
2. **Deprecation is stated for the definition as a whole**, not per version. Every version row is set to `deprecated`. No multi-version model is introduced in this ADR.
3. **There is no `active → draft`.** Demoting an active definition would strip parse coverage through `isReleasableProperty`, which is hard retirement by another name. Mis-activation is corrected by deprecating.
4. **`draft` and `active` may both be deprecated.** Restore lands on `active` when `activated_at` is non-null, otherwise on `draft`. Activation stamps `activated_at`.
5. **Ingest keeps binding new occurrences to deprecated definitions** and surfaces a reference count so Admins can see impact without changing parse determinism.
6. **The overlay act is named 停用解析**, not 废弃. Overlay retirement withdraws parsing capability; definition deprecation does not.
7. **Who may deprecate / restore follows row ownership (amended).** An organization Admin governs only that organization's definitions (`organization_id` matches the caller). A `platform-admin` — already the cross-organization role introduced by ADR-0009 — may additionally deprecate and restore **platform-global** definitions (`organization_id IS NULL`). Organization Admins still cannot touch global rows, and no role may deprecate another tenant's org-owned rows. This amends the earlier "platform-global definitions stay non-deprecatable" stance: the correct invariant is tenant ownership, not global immutability.

## Consequences

- Routes: `POST /api/v2/parameter-specs/:specId/deprecate` and `.../restore`. Both `admin:access`; the deprecate/restore service resolves via `requireOrgOrGlobalSpec` only when the caller holds `platform-admin`, otherwise `requireOrgOwnedSpec`.
- Migration `0083` (ADR-0014 versioning) adds `parameter_spec_versions.activated_at` and definition-level soft retirement; the earlier planned `0081_spec_lifecycle_closure` migration was superseded and not shipped as a separate file.
- Audit actions: `spec-deprecated`, `spec-restored`; `spec-updated` records before/after `value_shape` and `constraints`. Global-row governance writes `organization_id`-nullable audit entries (ADR-0009 fan-out).
- Hard retirement, versioned definitions, and delete remain out of scope (see deferred-questions D1–D2, D7).

## Alternatives considered

- **Hard retirement** (filter deprecated out of the schema loader): rejected — governance would silently break parse coverage for existing projects.
- **Require a successor definition before deprecating**: deferred; soft retirement does not need it.
- **`active → draft` for corrections**: rejected — equivalent to hard retirement under the current releasability rule.
- **Keep platform-global rows undeleteable by anyone** (original stance): rejected — the platform tier already owns global rows end-to-end (promotion, revert, overlay materialization); lifecycle governance belongs with that owner, not frozen behind a blanket refusal.
