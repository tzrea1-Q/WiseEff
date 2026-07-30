# Parameter definitions are versioned subjects with soft retirement

Parameter definitions already had a `parameter_spec_versions` table, but activation rewrote the single version row in place and soft retirement was never a complete product path. Semantic edits on live definitions therefore had no version boundary, and historical bindings could not honestly say which meaning they used.

We decided:

1. **`ParameterSpec` is a stable identity** keyed by owner scope + `attribution_subject_id` + `property_key` (ADR-0013). Definition-level lifecycle is `draft | active | deprecated`.
2. **`ParameterSpecVersion` holds all definition content**: display name, description, value shape, units, constraints, defaults, examples, reference rules, and documentation. Version status is `draft | active | superseded`.
3. Soft retirement (ADR-0011) applies to the **definition**. Deprecated definitions remain releasable for parsing through their current active or last-active version; they leave the default library and cannot be selected in open review.
4. Activating a successor version does not rewrite history. Cutover to the new active version is a staged migration job (separate batch): prepare successor binding revisions, then atomically switch once incompatibilities are resolved.
5. Organization definitions override platform definitions for the same subject + property key; platform remains the fallback.

## Considered Options

- **Keep single-version in-place edits with audit only** — rejected because audit does not give bindings a durable semantic pointer, and deprecate-then-create would mint a second identity for the same subject+key.
- **Mint a new ParameterSpec identity on every semantic change** — rejected because identity would churn and reference counts / continuity would break.
- **Bulk rewrite historical binding revisions to the new version id** — rejected because it falsifies the historical meaning of recorded values.

## Consequences

- Migration `0083` separates definition lifecycle from version status, copies content fields onto versions, and adds `attribution_subject_id` to `parameter_specs`.
- Ranking queries prefer `active` versions over `superseded` / `draft`, and definition `deprecated` stays below `active` for selection while remaining releasable for loaders that already accept non-draft versions.
- Soft deprecate/restore APIs land with platform-admin ownership of platform-global rows.
- Staged binding cutover and the mature create wizard belong to the following implementation batches.

## Follow-up

- Staged atomic version cutover jobs.
- Mature library create entry requiring coverage claims before activate.
- Lifecycle ranking audit of the eight historical SQL sites.
