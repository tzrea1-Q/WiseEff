# Debug Node Catalog Transfer

> Chinese: [Chinese](../zh-CN/design-docs/debug-node-catalog-transfer.md)

Issue #846 replaces the narrow "export directory / import directory" pair with one
complete org-scoped catalog transfer: **export every node**, **preview the merge**, then
**import atomically**. This page is the durable specification behind
`server/modules/debugging/catalogTransfer.ts`; the route rows live in
[api-contract.md](api-contract.md).

## Scope

The transferred object is the current organization's saved debug-node library:
modules are its structure, nodes are its entries, and protocol bindings are node
configuration. Parameter-catalog definitions, DTS topology nodes, unsaved device
discovery results, device values, sessions, operation history, users and credentials are
out of scope. The target organization always comes from the authenticated identity; the
file's source organization is descriptive only.

## Document formats

`wiseeff.debug-node-catalog.v2` is what the service writes:

```jsonc
{
  "format": "wiseeff.debug-node-catalog.v2",
  "source": { "organizationId": "org-1", "organizationName": "ChargeLab", "exportedAt": "…" },
  "counts": { "modules": 3, "nodes": 6, "bindings": 5 },
  "modules": [{ "name": "Charging", "parentNamePath": ["Battery"], "description": "", "scope": "lab", "sortOrder": 2 }],
  "nodes": [{
    "sourceId": "…", "name": "Fast charge current", "moduleNamePath": ["Battery", "Charging"],
    "description": "", "detailedDescription": "", "writeFormatExample": "", "writeFormatHint": "",
    "valueKind": "scalar", "valueFormat": "raw", "normalizationMode": "trim", "maxValueBytes": 16,
    "enabled": true, "archived": false, "archiveReason": null,
    "bindings": [{ "protocol": "hdc", "nodePath": "/sys/hdc/current", "accessMode": "RW", "enabled": true }]
  }]
}
```

`wiseeff.debug-node-catalog.v1` documents stay importable and are normalized into the same
internal shape. Both formats are `.strict()`: an unknown top-level, module, node or binding
field is a located `VALIDATION_FAILED` error rather than silently dropped content.

### Field presence

v2 optionals are presence-aware and parsing never materializes a default:

| File state | Meaning when the node/module matches a target |
| --- | --- |
| field omitted | keep the target value |
| `""` | clear a clearable text field |
| `null` | clear a nullable field (`maxValueBytes`, `archiveReason`, binding `notes`) |
| value present | update to that value |

v1 keeps its schema defaults for legacy compatibility, so the normalizer reads presence
from the raw JSON instead of the parsed object. That is why a v1 file without `description`
preserves the target description even though the schema fills in `""`.

## One authoritative read path

Export and the import planner both call `loadCatalogTargetSnapshot`, which reads every
module, **every** persisted node (archived, disabled and unbound included) and every
binding for the organization through one consistent snapshot: on the production root pool
the reads run in a dedicated `READ ONLY REPEATABLE READ` transaction, and inside a
caller-owned transaction they join its snapshot. Nothing filters by the current table page,
search box, module selection, protocol filter or tree expansion state, and the response
`counts` are derived from the same object set.

The target's own integrity is part of that contract. A node whose `debug_node_module_id`
does not resolve inside the organization, a module with a missing or cyclic parent, or a
binding whose node is absent makes the catalog unrepresentable, so **export fails the whole
operation** with `VALIDATION_FAILED` and a located issue list instead of writing a file
that silently omits or misplaces a row. Preview and import report the same conditions as
located blocking conflicts.

## Export capacity

The contract limit is one document of **20 MiB counted in UTF-8 file bytes**
(`DEBUG_CATALOG_MAX_DOCUMENT_BYTES`). It replaces the former 500-module / 2,000-node count
caps, which let the service produce files it could not read back. The HTTP layer collects
at most 22 MiB for the two import routes (`resolveRouteBodyLimit`) so an oversized body is
rejected with `413 PAYLOAD_TOO_LARGE` during bounded collection rather than after the whole
payload is buffered, and the document-level check reports the exact byte limit. An export
whose serialized document would exceed the limit fails as a whole; no partial file is
returned.

## Preview and execute share one plan

`buildCatalogImportPlan` validates the file, matches it against the snapshot and
classifies every object exactly once. Node classification describes the **node row** (name
and the nine node fields); binding-only changes are classified and counted on the binding,
so a node whose attributes are untouched is reported `unchanged` next to its `updated`
binding rather than being counted twice:

- **modules** match by full parent-name path + name; only the fields the file declares are
  compared and written, so a round trip is not reported as an update;
- **nodes** match by source node id first, then by the unique full module-name path + node
  name; a missing match creates a new target id, and a match keeps the target id,
  historical references and creation identity;
- **bindings** match per target node + protocol; a protocol absent from the file is
  preserved, never deleted.

Blocking conflicts (the whole file is rejected, no automatic guessing) are: duplicate
module path, dangling module parent, dangling node module, duplicate source id, id and
name-path matching different targets, two file entries claiming the same target, two
otherwise-identical new nodes in one file, duplicate binding protocol, two persisted target
nodes sharing one module/name identity (an ambiguous match is never resolved by picking the
first row), a cyclic or dangling target module reference, an orphan target binding, and any
target node whose module reference does not resolve.

A v2 file whose `counts` contradict the objects it carries is equally blocking: the admin
cannot tell which half is authoritative, so the preview reports `count-conflicts` and
nothing may be submitted.

Archive state never silently changes: a newly created archived node stays archived and is
stamped with the current operator and time, while an existing target keeps its own archive
status and reason. A differing file value becomes an `archive-state-preserved` warning,
and archiving/restoring stays with the separate node action.

## Digest and concurrency guard

The preview returns a `previewDigest`: SHA-256 over the canonical file, the target
organization and the canonical state of every target object the plan touches. Execute
requires that digest and, inside one transaction:

1. takes `pg_advisory_xact_lock` on a key derived from the organization, so catalog
   transfer writers for that organization serialize;
2. reloads the target snapshot and rebuilds the plan;
3. rejects blocking conflicts with `409 CONFLICT`;
4. rejects a digest mismatch — including a changed file, an edited, moved or deleted
   approved target, or a node the file would create that now exists — with
   `409 CONFLICT` and `details.reason: "stale-preview"`;
5. applies every module, node and binding change plus the success audit event.

A preview is therefore evidence about concurrency, not an authorization token, and the UI
asks the server to re-preview whenever it reports a stale preview instead of retrying
blindly.

## Atomicity, permissions and audit

`debugging:admin` is required by all three routes and is enforced server-side. Every write,
including the `debug-node-catalog-import` audit event, shares one transaction, so an
injected mid-import failure rolls back all of it. Export and import audits record the
acting user, target organization, request correlation, format, byte size, result counts and
the preview digest — never raw node paths, the full file, or the source organization's
audit identity. Preview and cancel produce no catalog write and no import success event.

## Interface

The node library keeps one export button and one import button. Export downloads the full
v2 file and reports the exported node/module/binding counts; demo mode labels its file as
local demonstration data. Import reads the file, checks its byte size before upload, asks
the server for a preview and opens a dialog that shows the source and target scope, the
created/updated/unchanged/conflict counts, warnings and per-object field differences with
binding path, access mode and enabled state called out. Confirm is enabled only when the
server reports no blocking conflicts, and the dialog is disabled while a submit is in
flight.
