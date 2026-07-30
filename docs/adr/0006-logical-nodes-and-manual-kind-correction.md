# Logical nodes and manual kind correction

ADR-0004 gave every module an explicit `kind`, but DTS ingest collapsed three placement taxonomies into one product label. Nodes with a `compatible` string (U/N) and nodes without one (C — pure config blocks like `btb_check`, `cccv_para0`) all landed as `instance`. Admins could not tell hardware from logic on the tree, and the edit path could not change `kind` at all — contradicting ADR-0004's claim that "a wrong guess is corrected by editing the module."

We add a fifth kind, `logical`, for DTS nodes WiseEff cannot prove are devices (no compatible evidence). Real device instances keep `instance`. Manual reclassify among `{business, instance, logical}` is allowed on `PATCH`, promotes `origin` to `curated`, and survives re-ingest. Driver groups and the unclassified root stay out of that whitelist: their roles are defined by mappings and system fallback, not by an Admin dropdown.

## Considered Options

- **SQL bulk backfill of existing `instance` rows** — join bindings to the latest node revision and flip anything without a compatible string. Rejected: local data shows most "no compatible" rows are mixed — true logic nodes, hardware that simply never recorded compatible on the revision, and scaffolding mis-created by migration 0072's name regex. A post-hoc SQL guess recreates the problem ADR-0004 already called unfixable.
- **Orthogonal `instance_taxonomy` column (U/N/C)** — keeps `kind=instance` and adds a side label. Rejected: the Admin surface needs an independent filter and kind-scoped actions (`logical` can move; both still cannot delete). A fifth kind is the smaller change and matches how the UI already keys off `kind`.
- **Do nothing until a driver registry exists** — rejected: the name collision ("器件实例" on config blocks) is already confusing operators, and the missing edit path is a documented ADR hole.

## Consequences

- Migration `0075` only widens the check constraint. No bulk UPDATE. Kind is asserted at ingest for new and auto rows, or corrected by hand.
- Ingest `ensureNamedModule`: Type C (no compatible) writes `kind=logical`. On `source_key` hit, if `origin=auto` and the asserted kind differs, reassert kind; curated rows are never overwritten.
- `board` stays `instance` via the existing board special-case path.
- Edit dialog exposes kind only when `canReclassifyModule` is true. Leaving `business` while business children remain is rejected; becoming `business` requires a business (or null) parent.
- Scaffolding modules wrongly created by 0072 (`i2c@…`, `pmic@0`, `batt`) are deferred to tech debt — they are neither devices nor logical config nodes and should leave the product tree entirely.
- A proactive driver registry (declare supported compatibles before DTS upload) remains out of scope; see the follow-up plan note under deferred work.

## Follow-up

ADR-0007 settles the driver registry: registering a driver is creating or claiming a curated driver group, so the registry is a view over existing data rather than a new store.

## Supersession (ADR-0010)

Superseded by [ADR-0010](0010-attribution-tree-is-taxonomy-not-topology.md). The `logical` kind and its reading as **one unprovable device per DTS instance** are retired. Driverless configuration nodes become **`node-type` units** keyed by bare node name (not per-instance `source_key = node:{locator}`). Manual reclassify among `{business, instance, logical}` becomes `{business, node-type}`. Scaffolding modules deferred here (`i2c@…`, `pmic@0`, `batt`) leave the tree entirely in migration `0080` (closes TD-045).
