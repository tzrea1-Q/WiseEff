# Semantic edits on an active definition mint a successor version

ADR-0014 already made `ParameterSpecVersion` the content subject and said activating a successor must not rewrite history. The activate path now inserts a draft successor and a `parameter_spec_version_cutover_run` when an **active** definition's content changes. `PATCH /api/v2/parameter-specs/:specId` still rewrites `value_shape`, `constraints`, and `units` on the current version row. That second door makes versioning optional in practice: an Admin who saves the editor never mints a version, never pins historical bindings, and never enters cutover.

We decided that **semantic fields on an active (or deprecated) definition change only through activate → successor → staged cutover**. PATCH stays for documentation-class fields. Definition lifecycle stays definition-level (ADR-0011); version status stays `draft | active | superseded`. Bindings remain pinned to the version they were written against until cutover finalize moves the tip.

## Considered Options

- **Keep PATCH as a full in-place editor; activate-successor is optional.** Rejected. Two doors for the same act means the cheaper one wins, and ADR-0014's historical pointer becomes a suggestion.
- **Forbid every field change on an active definition (deprecate + create).** Rejected. ADR-0014 already rejected minting a new identity for a semantic change, and documentation fixes should not force deprecation.
- **Let PATCH mint the successor itself.** Rejected. One semantic door keeps the cutover run, audit action (`spec-activated` / cutover events), and coverage-claim rules on the path that already owns them.

## Semantic vs documentation fields

| Class | Fields | Active / deprecated write |
| --- | --- | --- |
| Semantic | `value_shape`, `constraints`, `units` | `POST .../activate` only. Changed content inserts a successor version and a cutover run (already specified in the API contract). Auto-finalize when no tip bindings reference the current version. |
| Documentation | `displayName`, `description`, `documentation`, `exampleValue` | `PATCH` in place on the current version row, still audited as `spec-updated`. |

A PATCH that would change a semantic field returns `409` with `details.code = semantic-edit-requires-successor`. Equality is `stableJson` against the stored version; omitted keys are not changes. Drafts still cannot PATCH (existing `409`; use activate).

## Consequences

- Close the remaining D1/D2 hole: versioning is no longer bypassable from the editor save path.
- `guardActivateParameterSpec` and the mock runtime must accept activate on **active** specs and follow the API successor/cutover rules. Today's mock still refuses with "Only draft parameter specs can be activated."
- Mock/API version histories must match in the same implementation round (TD-048 residual). Seeded `currentVersion: 3` fixtures are not a substitute for the successor path.
- D6 ranking sites must not treat a draft successor as the binding's meaning; see the locked ranking contract in [`2026-07-30-parameter-governance-deferred-questions.md`](../design-docs/2026-07-30-parameter-governance-deferred-questions.md).
