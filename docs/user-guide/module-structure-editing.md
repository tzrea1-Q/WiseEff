# Editing a module structure package

Import can combine module creation, hierarchy moves, deletion and metadata updates with root Subject registration, lifecycle, placement, aliases and recognition settings. It can also publish new driver declarations before applying their organization registration. Copy mode carries modules and complete retained Subject snapshots to another organization in the same deployment. Moving a retired registration does not activate it. Invalid or unsupported combinations are rejected before that stage is applied.

Keep the original export as a backup. Edit the JSON as data: do not execute text in it. A person must review and confirm the import in WiseEff. The package contains organization taxonomy and Subject settings, not project values, Bindings, source files, credentials, permissions, or audit history.

## Identity and references

Keep `format`, `version`, source information, `exportId`, existing `sourceId` values, Subject IDs, and Catalog ownership facts unchanged. An export ID is not permission to read another organization's baseline. Each module has a unique package-local `ref` of at most 512 characters; `parentRef` and module placements refer to that value, not to a name or database path. Keep existing refs stable when renaming or moving a module. To add a module, give it a new unique ref, omit `sourceId`, and supply all required module fields. New parents and children may appear in the same package.

In update mode, the top-level `source`, `counts`, `limits`, and `references` must match the original export. `counts` records the exported snapshot; do not recalculate it after adding or deleting modules or registering Subjects. Do not change `limits` to relax a limit or edit `references` to create destination modules. These changes reject the entire import.

For example, an existing module can be renamed without changing its identity, while a new child refers to it by ref:

```json
[
  { "ref": "power", "sourceId": "pmod_example", "operation": "upsert", "name": "Power systems", "parentRef": null },
  { "ref": "battery", "operation": "upsert", "name": "Battery", "parentRef": "power", "description": "", "scope": "", "sortOrder": 0, "importance": "medium" }
]
```

This example is a fragment, not a complete package. Do not change a module's `reference` facts, the reserved unclassified root, Catalog ownership, owned-child lifecycle facts, or legacy technical and archived references. They explain the source structure and are read-only. A placement with `kind: "reference"` describes an existing legacy reference; it is not a destination to recreate.

The module fields `name`, `parentRef`, `description`, `scope`, `sortOrder` and `importance` are editable. Use an empty string to clear description or scope, null for a root `parentRef`, an integer for `sortOrder`, and `high`, `medium` or `low` for importance. A new module supplies all six fields, `ref` and `operation: "upsert"`. Its `sourceId` and read-only `reference` are assigned by WiseEff later.

For a root Subject, use `{ "kind": "module", "moduleRef": "power" }`, `{ "kind": "unclassified" }`, or `{ "kind": "unset" }` for placement. Set `displayAlias` to null to clear it. The exported `state` is `active` or `retired`. For driver and node-type recognition, `mode` is `inherit` or `override`; `override` has `compatibles`, `nodeTypeName`, `driverNature` and `instanceCardinality`, with fields not applicable to the Subject kind left as exported. Keep `effective` unchanged. Configuration-schema recognition is null. Catalog IDs and child `cascadeRetired` are read-only. `kind` normally remains unchanged; the organization recognition correction below permits a root node type to become a driver in this organization.

`ownerSubjectId` records the effective owner driver in the exporting organization: the registration's owner takes precedence, with Catalog ownership as the fallback. It can differ from the fixed `parent` in definition-import Markdown; organization ownership changes do not change Catalog identity. Keep `ownerSubjectId` unchanged in update mode. To change it, use Module management → Edit node → Placement to select an active registered driver in the organization, confirm, and export again. Copy mode handles source and target ownership differences as described below.

## Changes

- Change a module's editable name, description, scope, sort order, importance, or `parentRef` to edit or move it. Moving a parent moves its subtree. Parent references must resolve, and the final tree must be acyclic with unique sibling names.
- Removing an existing entry or omitting an editable field does not delete or clear it. Use `operation: "delete"` to request deletion. Move or explicitly delete every child and give each affected root Subject, including retired registrations, an explicit placement disposition. Deletion does not delete Subject registrations, parameters, or history.
- In update mode, add `{ "subjectId": "catalog-id", "state": "active", "placement": { "kind": "module", "moduleRef": "power" } }` to register an eligible Catalog root under an existing or newly created business module. For an existing root, edit `state` to `retired` or `active` to retire or restore it; an unchanged or omitted state preserves the current state. Omitting a Subject does not retire it. An owned child is not an independent lifecycle or placement command; preserve its exported status and cascade-retirement fact so a later restore retains its meaning.
- A root placement can name a business module ref, the reserved unclassified category, or an explicit unset placement. Unset and unclassified have different meanings. Do not use an archived or technical module as a destination.
- Edit or explicitly clear a root display alias using the field's defined clear value. Omitting it leaves the existing alias unchanged. Aliases do not change Catalog identity.
- Preserve recognition mode. Inherited recognition uses Catalog defaults and has `override: null`; an explicit override has editable values in `override`. The `effective` values are read-only. Do not copy them into an override merely to preserve inheritance. To request a reset, set the mode to `inherit` and `override` to null. Recognition arrays are treated as a single value when conflicts are reviewed.
- Omitting a recognition field preserves its current value. A singleton rule is checked against current target-project instances; an incompatible capacity blocks the whole import.

Use the exported field shapes and clear values as the contract for the package version. Leave read-only values unchanged. An agent editing the file should preserve identities and all unrelated entries, make only requested changes, and report its changes to the human reviewer.

### Correct a node type that is actually a compatible driver

For a standalone `node-type` Subject that should match a DTS `compatible`, set `recognition.mode` to `override` and provide a nonempty exact `recognition.override.compatibles` array. For example, use `["fdw,fm1230_swi"]` only when that is the actual source compatible. The import infers an organization-local driver correction; keeping the original `kind: "node-type"` is supported, and explicitly setting `kind: "driver"` with this override is also supported. A `kind` edit alone is not sufficient.

The original node name may remain in `override` when it was copied from the export; preview explicitly clears it to null. A newly changed node name cannot accompany a driver correction. Omitted or null driver attributes use `physical-device` and `multiple`; provide `driverNature` or `instanceCardinality` explicitly to choose another supported value. Leave `recognition.effective` and other read-only export information unchanged.

Preview lists **current organization Subject type: node type → driver**, the exact compatible, cleared node name, and affected projects. Confirmation retains Subject, registration, placement, Definition, Binding, value and history identities. It changes current organization recognition and display only; shared Catalog identity, pinned Catalog history, other organizations and DTS source bytes are unchanged. Existing bindings remain recorded; later source synchronization uses the corrected matcher. The corrected Subject does not acquire the shared Catalog capability to own newly published child Subjects.

Re-export reflects `kind: "driver"` and the effective driver rule. Reimporting the same corrected package is a no-op. Copying this export carries the organization-local correction; existing target rules require an explicit conflict choice. To undo the correction, set `recognition.mode: "inherit"` and `override: null`; preview shows the return to the Catalog node type. A concurrent recognition edit or a change after preview requires conflict review or a new preview.

This correction is limited to standalone roots. Owned child nodes and configuration schemas cannot be converted by importing a compatible. Their ownership and Catalog authoring need a separate explicit change.

## Create modules and new drivers together

In **Update current organization** mode, add a top-level `newDrivers` array to an exported document. These entries create previously nonexistent root drivers; use `subjects` with a real `subjectId` to register an existing Catalog subject. No parameter definition is required. Copy mode does not accept new-driver declarations.

| Field | Meaning |
| --- | --- |
| `ref` | Unique, stable reference for the new driver in this export package; not a database ID. |
| `compatible` | One exact DTS compatible string. Do not use `compatibles`, wildcards or invented IDs. |
| `driverNature` | Required: `physical-device` or `logical-service`. |
| `instanceCardinality` | Required: `multiple` or `singleton-per-project`. |
| `displayAlias` | Optional organization display alias; omit or use null when no alias is needed. |
| `placement` | `{ "kind": "module", "moduleRef": "battery-auth" }`, referring to an existing or newly declared business module. |

Append these entries to the corresponding arrays in your actual export. This fragment is not a complete upload: retain all original metadata and unrelated entries. Replace the fictional compatible with verified source information.

```json
{
  "modules": [
    { "ref": "battery-auth", "operation": "upsert", "name": "Battery authentication", "parentRef": null, "description": "", "scope": "", "sortOrder": 0, "importance": "medium" }
  ],
  "newDrivers": [
    { "ref": "auth-chip", "compatible": "acme,auth-chip", "driverNature": "physical-device", "instanceCardinality": "multiple", "displayAlias": "Authentication chip", "placement": { "kind": "module", "moduleRef": "battery-auth" } }
  ]
}
```

At most 128 new drivers can be declared in one file. Existing module/subject and byte limits still apply. Keep `source`, `exportId`, `counts`, `limits` and `references` unchanged, and preserve new-driver refs when retrying.

Preview lists new declarations and destination paths alongside module changes. Publishing requires existing Catalog authoring/publication permissions and the instance publication policy. Review the shared-directory scope and confirm **Publish new drivers**. The publication manager processes the job; the dialog shows progress and supports refreshing it. A frozen or unavailable publisher does not create organization modules or registrations.

After publication, review the fresh module/registration preview and choose **Confirm submit**. Drivers are shared Catalog identities; their registration, alias and placement belong to the current organization. Parameters, DTS files and project instances are not created.

If the window closes or the browser reloads, upload the same edited file and preview again to resume. Keep each driver's `ref`, `compatible`, nature and cardinality unchanged; the order of declarations may change. Before final submission you may correct the target module or organization alias and preview again. Do not forge `subjectId` values or switch modes to bypass a conflict. If publication succeeded but organization submission failed, the drivers remain published and the interface reports that modules and registration are pending. Resolve the diagnostic and retry that stage without publishing duplicate drivers. A blocked publication requires a fresh preview and explicit **Republish drivers** confirmation; it is never silently resubmitted. Only the final import receipt confirms completion. After completion, re-export before editing these drivers through ordinary `subjects` entries.

## Review and import

If preview or submission fails, the import dialog shows the server's reason and field paths instead of only a generic validation message. For changed read-only export information, it lists the original export value, the imported value, and a repair hint. Paths beginning with `document.` refer to the uploaded JSON root; numeric path segments are zero-based array indexes, and `.length` describes an array's entry count.

Subject errors also include the Subject ID, kind, available display alias, and array index; module errors include the module reference and name. `jsonPointer` locates the value directly in the uploaded file: `/subjects/32/recognition/override/nodeTypeName` identifies the 33rd Subject's overridden node name. Recognition errors point to the specific field or compatible array element, with the submitted value, violated rule, repair hint, and applicable allowed values or format example. Kind mismatches and identifier syntax failures have distinct explanations.

| Example error | Repair |
| --- | --- |
| `nodeTypeName: "battery_checker@0"` | A node-type name excludes its unit address; after confirming the actual type, use `battery_checker`. |
| `compatibles: ["acme,*"]` | Wildcards are unsupported; use exact source compatibles, one array element per value. |
| `compatibles: "acme,power"` | This field requires an array, such as `["acme,power"]`. |
| `driverNature: "physical"` | Choose `physical-device` or `logical-service` according to the intended behavior. |
| A driver has a node name in `nodeTypeName` | Restore the inapplicable field to its exported `null`, or omit it in an update fragment; do not change the Subject kind. |

Examples illustrate syntax and must not replace actual device identifiers blindly. Locate the Subject by `subjectId`, repair the field identified by `jsonPointer`, and retain other business edits and read-only export information. Validation proceeds in stages: preview again after each repair; a report does not imply every problem in the package has already been scanned.

Use **Copy diagnostics** (复制诊断信息) to pass the report to your coding agent along with the original export and edited file. It includes the file name, import mode, source/target organization, error code, request ID when available, and field diagnostics; it does not include the complete uploaded package or login credentials. If clipboard access is unavailable on HTTP or denied by the browser, select the diagnostic text and copy it manually. Field diagnostics are limited to 50 issues per response and long values are marked as truncated previews, not usable replacement values. Restore read-only differences from the same original export; repair other fields according to their specific rules, preserve intended editable changes, upload the repaired file, and preview again. Do not change the server baseline or switch import modes to bypass validation.

An update compares the file with the server-retained baseline and current organization state. Independent edits can be retained, but conflicting edits require a choice. A copy targets another organization in the same deployment; matching a path suggests a possible existing module but does not authorize reuse. Source deletion markers never delete target modules. A missing baseline cannot be replaced by values from the edited file. Review all operations, conflicts, affected Subjects, and project impact before confirming. If the target changes after preview, preview again.

For module copy, select copy mode in the target organization, upload the package, and explicitly choose a target module or create a new one for each retained entry. Resolve differences with the target before confirming. The target stores each approved mapping, including reuse, for later imports of the same package; a missing mapped target is a conflict. Copy uses the file and target state, without reading a source baseline.

Copy requires complete retained Subject snapshots, including root placement and alias, recognition inheritance or override, and each owned child's status and cascade-retirement fact. Set the desired `state` in the snapshot; Subject `operation` commands are optional in update mode, must agree with any supplied state, and are not accepted in copy mode. Subject identities and root or owned-child classification must be compatible with the current Catalog. Existing target registrations retain their identities; choose explicitly when their state, placement, alias, or recognition differs. Retired registrations are created retired, and restoring a copied driver restores only its cascade-retired children. A source deletion marker never retires a target registration.

Copy carries the source organization's `ownerSubjectId`. If the same child is already registered under a different driver in the target, preview shows an owner-driver conflict. Choose “Keep current” to retain the target owner, or “Use file” and confirm to apply the source owner. This changes only the target organization's registration, not the fixed Catalog owner. The owner and child in the source snapshot must still satisfy current Catalog and target-organization validity checks.

Modules and Subjects each have a limit of 10,000 entries. An uploaded JSON file may be at most 32 MiB; its content, measured as UTF-8 bytes after parsing and serializing as compact JSON, may be at most 4 MiB. Exports use two-space indentation. Formatting whitespace does not count toward the 4 MiB content limit, but whitespace inside strings does. Exceeding any limit rejects the entire package without truncation or partial application.

New or moved module paths must also fit a conservative 2,560-byte budget for the target organization ID, encoded path and 32 bytes of index overhead. New module IDs use 36 bytes per path segment; existing IDs use their UTF-8 byte lengths. This leaves margin below the database index limit without relying on compression, so some paths the database could physically store are intentionally rejected at preview. Unchanged historical paths remain valid for no-op and metadata-only imports.
