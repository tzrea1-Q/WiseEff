# Config-set snapshot loader (C6)

Architecture-review candidate C6 (2026-08-12 backend review): "the current content of
a config set" was assembled by hand at every consumer — a serial loop of list →
per-member file lookup (for the format) → membership lookup (for the role/sortOrder) →
version lookup (for the storage key) → storage read — even though the member-list query
already joins the current version and carries format/role/sortOrder. Three redundant
queries per member, per consumer, plus divergent entry/overlay derivation.

## Shape

`server/modules/parameter-files/configSetSnapshot.ts`:

- `loadConfigSetSnapshot(db, objectStore, configSetId)` → `ConfigSetSnapshot` with
  `members` (contents loaded, config-set order), `skipped` (no current version),
  `entryFile` (lowest-sortOrder base member, first-DTS fallback for legacy sets),
  `overlayOrder` (non-base roles by sortOrder then name), `dtsFiles` (validator input),
  and `toolchainFiles` (the Map the DTS toolchain consumes).
- One member query (`listConfigSetMemberFiles`, now also selecting the current
  version's `storage_key`) + parallel object-store reads.

## Consumers migrated

- `validationGate.runValidationGate`: both branches (injected legacy validator, DTS
  toolchain) — was two hand-rolled loops with 3 lookups per member.
- `exportService.exportConfigSet` — same loop shape, plus a redundant per-member
  membership query for data the row already carried.

Not migrated on purpose:

- `dts-reload` `loadBaseSource`: project-scoped entry (not config-set-scoped) with its
  own storage-failure error semantics (`reload-base-read-failed`); already single-query.
- `parameter-topology` `validateConfigRevision`: assembles from a config *revision*
  manifest, a different data source than the live config set.
- `baselineService` restore-preview metadata loops: no content reads; candidates for a
  metadata-only manifest variant if a third metadata consumer appears.

## Verification

- `configSetSnapshot.test.ts`: ordering, skipped members, entry/overlay derivation,
  legacy fallback.
- `modules/parameter-files` suite green (261) including the real-database repository
  test extended for `storage_key`.
- `npm run build`, `npm run docs:check`.

## Documentation Impact Matrix

| Area | File | Action | Note |
| --- | --- | --- | --- |
| Planning | `docs/PLANS.md` | Update | Plan registered |
| Architecture / domain / API / security / product | — | No change | Internal load-path refactor; no contract, schema, or behavior change (entry/overlay semantics preserved verbatim) |

## Documentation Update Gate

`npm run docs:check` passes; no bilingual developer docs affected.
