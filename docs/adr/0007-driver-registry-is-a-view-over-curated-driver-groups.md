# The driver registry is a view over curated driver groups

WiseEff already declares which drivers it supports, twice, and neither declaration is reachable from the product. Parsing support is pinned in `schemas/dts/catalog.json`, loaded by `loadSchemaRegistry` and matched at ingest by `matchDriver`, which understands prefix patterns such as `vendor,sc85*`. Attribution support is a curated driver-group module plus its exact-match `compatible` rules in `parameter_module_mappings`. Because neither is visible before a DTS upload, operators experience the platform as having no way to declare a supported device up front, and the unclassified queue reads as post-hoc discovery rather than as a gap against a declared scope.

We decided the driver registry is a **read view over data that already exists** — a curated driver group plus its compatible rules *is* the registration — rather than a new registration entity. Registering a driver creates or claims that module up front, so declaring support and attributing parameters become one act, parse coverage and observed coverage become derived columns, and the compatible rule remains the only attribution lever ADR-0005 left standing.

## Considered Options

- **A `parameter_driver_registrations` table that records intent without participating in matching** — rejected because every field it would hold is already held elsewhere: display name and target business category by the module, claimed compatibles by the mappings, authorship by the audit log, and "declared but never seen" by a binding count of zero. Two stores describing one fact require permanent two-way sync, and the failure mode (a registration whose driver group was moved or deleted) is silent.
- **Extend `driver_schemas` with `organization_id` and an attribution target** — rejected because that table is a shadow of the file registry, written only by `upsertMatchedDriverSchema` when a node actually matches. It structurally cannot hold a declaration for a driver no DTS has ever contained, which is the entire point of registering one. It also forces a globally shared parsing contract into an organization-scoped row.
- **Platform-authored schema documents** — letting Admins write property definitions in the product. Rejected for scope, not for merit: unmatched properties already have a human path through the spec review queue (`collectOpenReviewTasks` → accept, dismiss, or create a spec), so a registry that re-authored property definitions would duplicate a working queue.
- **Give attribution the same prefix matching parsing has** — a `match_mode` column on `parameter_module_mappings`. Rejected for this decision: it rewrites the binding write hot path, needs a new precedence rule for overlapping prefixes, and buys nothing a set of exact rules on one driver group does not already buy.

## Consequences

- Registration is organization-scoped, because the target business category is an organization asset and the same compatible may legitimately belong to different categories in different organizations. The file layer stays global; a registration references a parsing contract it does not own.
- Registering a compatible that already has a mapping **claims** the existing driver group: it is reused, moved to the declared business category when they differ, and promoted to `origin = curated`. Registration and adoption are therefore the same operation, consistent with ADR-0004's rule that adoption has no separate button.
- Registered compatibles are exact values only. A driver that parses through a prefix pattern but was never registered by exact value is genuinely "parseable, unregistered"; the coverage column must say so, or it will be read as a bug.
- The unclassified queue changes meaning without changing its query. Registered drivers already have a mapping and so never enter it, which leaves precisely "observed but not registered".
- A registered driver that no DTS has produced yet appears in the tree as a driver group with zero parameters. It is marked as not yet observed rather than hidden, because being visible before the DTS arrives is the reason it exists.
- Platform-authored drivers land as `source = 'manual'`, whose existing precedence is "fill gaps only when no linux or vendor driver matches". Nothing an operator adds can shadow a released vendor schema.
- `loadSchemaRegistry` is synchronous, uncached, and called inside the ingest transaction (`ingestService.ts`). Serving a parse-coverage column requires exposing and caching the registry outside ingest; this is the largest implementation cost the decision carries.
- The registry read view no longer has its own product route. Parse and observed coverage surface on the attribution tree (row chips, uncovered filter, and per-compatible detail in `ModuleEditDialog`). `/parameter-admin/modules/registry` bookmarks redirect to the tree; the `GET/POST .../driver-registry` API remains the data seam.

## Follow-up

Rejecting platform-authored schema documents left "parseable, unregistered" reportable but not fixable from the product. ADR-0008 settles that: an organization-scoped manual driver overlay closes the coverage gap, while `schemas/dts` stays repository-managed.
