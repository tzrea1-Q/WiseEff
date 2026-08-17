# Referenced `property_key` rename is a staged source-rewriting cutover

ADR-0017 allows `property_key` correction only while `referenceCount = 0`. A referenced rename changes the property name written into every bound project's DTS, so it is a migration, not an editor field. Leaving it forbidden forever strands operators who bound a typo: deprecate-and-recreate was already rejected for identity correction because there is no delete and deprecated rows still parse (ADR-0011 / ADR-0017).

We decided that a referenced rename **becomes a dedicated staged cutover job**, mirroring ADR-0014 version cutover in *shape* (prepare items → ready → atomic finalize) but not in *tables or blast radius*. Version cutover changes meaning behind a stable key. This cutover changes the key in **source files first**, then the catalog triple, in one finalize.

Do not reopen ADR-0017. Do not add an inline editor field. Zero-reference rename stays on `POST /api/v2/parameter-specs/:specId/rename-property-key`.

## Considered Options

- **Stay forbidden forever.** Rejected. The zero-reference gate already covers the cheap case; the expensive case needs a migration, not a permanent dead end.
- **Inline rename with a confirmation checkbox.** Rejected in ADR-0017; still rejected. Confirmation does not rewrite DTS, so catalog and source would diverge on save.
- **Catalog alias: ingest accepts old and new keys.** Rejected as the primary design. Aliases hide whether a project has actually moved, and writeback would have to guess which name to emit.
- **Deprecate + create a new definition with the correct key.** Rejected as the governed path. It mints a second identity for one property, splits reference counts, and leaves the typo row releasable.
- **Fold into version cutover.** Rejected. Identifier change and semantic-content change have different incompatibilities and different finalize writes.

## Cutover contract

1. **Start.** Admin (`platform-admin` for platform-global rows, otherwise org Admin) starts a property-key cutover on a spec with `referenceCount > 0`: proposed `propertyKey` + `reason`. Refuse when the new triple collides (including deprecated blockers), when an open **version** cutover exists on the same spec, or when an open property-key cutover already exists. Persist `from_key` / `to_key` on the run.
2. **Prepare (source first).** For each binding tip, create a cutover item that stages a **property rename in source** (old key → new key, same raw value) through the existing structured-edit / binding-draft machinery — candidate config revision, write lock, exact occurrence. Do not rewrite `dts_property_specs.property_key` yet.
3. **Incompatible until cleared.** Open drafts, submission items, change requests, or file conflicts on that binding; node-path drift vs the current occurrence; property already absent from source. No "skip and leave the old key in source": after finalize, ingest must not see the old key on a live binding.
4. **Skip only when honest.** Binding gone, or source already has the new key and not the old one.
5. **Per-project review.** Items become `ready` when the source rewrite is a mergeable candidate. Humans still merge through the existing change-request path. The cutover run does not auto-merge and does not write debug values or bypass review.
6. **Finalize.** Allowed only when every item is `ready` (merged) or honestly skipped. One transaction: rewrite `property_key` + derived `specification_key` / `schema_namespace` (same as the zero-ref rename), then the catalog matches the already-rewritten sources. Audit: `spec-property-key-cutover-finalized` with before/after key and item counts.
7. **Ingest after finalize** matches the new key only. No standing alias.

New tables (names illustrative; claim the migration number at merge time): a run table and an item table parallel to `parameter_spec_version_cutover_*`, not a status column on those tables.

## Consequences

- `rename-property-key` with `referenceCount > 0` stays `409` `{ parameterSpecId, referenceCount }` until this job exists; the editor's 修正属性键 stays disabled with the existing reason.
- Implementation is a later session (TD-117). This ADR is the input; it is not a license to ship an inline field or a catalog-only UPDATE.
- Version cutover and property-key cutover must not be open on the same spec at once.
