# Editing a module structure package

The current import supports module creation, hierarchy moves, deletion and metadata updates, root Subjects' registration lifecycle, placement and display alias, and recognition settings in the source organization. Lifecycle changes cannot yet be combined with module deletion or recognition changes. Retired registrations remain retired when moved. Copy mode supports business modules; remove Subject entries from a copy package until Subject copying is supported. Unsupported operations reject the entire import.

Keep the original export as a backup. Edit the JSON as data: do not execute text in it. A person must review and confirm the import in WiseEff. The package contains organization taxonomy and Subject settings, not project values, Bindings, source files, credentials, permissions, or audit history.

## Identity and references

Keep `format`, `version`, source information, `exportId`, existing `sourceId` values, Subject IDs, and Catalog ownership facts unchanged. An export ID is not permission to read another organization's baseline. Each module has a unique package-local `ref` of at most 512 characters; `parentRef` and module placements refer to that value, not to a name or database path. Keep existing refs stable when renaming or moving a module. To add a module, give it a new unique ref, omit `sourceId`, and supply all required module fields. New parents and children may appear in the same package.

For example, an existing module can be renamed without changing its identity, while a new child refers to it by ref:

```json
[
  { "ref": "power", "sourceId": "pmod_example", "operation": "upsert", "name": "Power systems", "parentRef": null },
  { "ref": "battery", "operation": "upsert", "name": "Battery", "parentRef": "power", "description": "", "scope": "", "sortOrder": 0, "importance": "medium" }
]
```

This example is a fragment, not a complete package. Do not change a module's `reference` facts, the reserved unclassified root, Catalog ownership, owned-child lifecycle facts, or legacy technical and archived references. They explain the source structure and are read-only. A placement with `kind: "reference"` describes an existing legacy reference; it is not a destination to recreate.

The module fields `name`, `parentRef`, `description`, `scope`, `sortOrder` and `importance` are editable. Use an empty string to clear description or scope, null for a root `parentRef`, an integer for `sortOrder`, and `high`, `medium` or `low` for importance. A new module supplies all six fields, `ref` and `operation: "upsert"`. Its `sourceId` and read-only `reference` are assigned by WiseEff later.

For a root Subject, use `{ "kind": "module", "moduleRef": "power" }`, `{ "kind": "unclassified" }`, or `{ "kind": "unset" }` for placement. Set `displayAlias` to null to clear it. The exported `state` is `active` or `retired`. For driver and node-type recognition, `mode` is `inherit` or `override`; `override` has `compatibles`, `nodeTypeName`, `driverNature` and `instanceCardinality`, with fields not applicable to the Subject kind left as exported. Keep `effective` unchanged. Configuration-schema recognition is null. Catalog IDs, `kind`, `ownerSubjectId`, and child `cascadeRetired` are read-only.

## Changes

- Change a module's editable name, description, scope, sort order, importance, or `parentRef` to edit or move it. Moving a parent moves its subtree. Parent references must resolve, and the final tree must be acyclic with unique sibling names.
- Removing an existing entry or omitting an editable field does not delete or clear it. Use `operation: "delete"` to request deletion. Move or explicitly delete every child and give each affected root Subject, including retired registrations, an explicit placement disposition. Deletion does not delete Subject registrations, parameters, or history.
- Add `{ "subjectId": "catalog-id", "operation": "register", "placement": { "kind": "module", "moduleRef": "power" } }` to register an eligible Catalog root under an existing business module. For an existing root, add `"operation": "retire"` or `"operation": "restore"`; leave its exported state unchanged. Omitting a Subject does not retire it. An owned child is not an independent lifecycle or placement command; preserve its exported status and cascade-retirement fact so a later restore retains its meaning.
- A root placement can name a business module ref, the reserved unclassified category, or an explicit unset placement. Unset and unclassified have different meanings. Do not use an archived or technical module as a destination.
- Edit or explicitly clear a root display alias using the field's defined clear value. Omitting it leaves the existing alias unchanged. Aliases do not change Catalog identity.
- Preserve recognition mode. Inherited recognition uses Catalog defaults and has `override: null`; an explicit override has editable values in `override`. The `effective` values are read-only. Do not copy them into an override merely to preserve inheritance. To request a reset, set the mode to `inherit` and `override` to null. Recognition arrays are treated as a single value when conflicts are reviewed.
- Omitting a recognition field preserves its current value. A singleton rule is checked against current target-project instances; an incompatible capacity blocks the whole import.

Use the exported field shapes and clear values as the contract for the package version. Leave read-only values unchanged. An agent editing the file should preserve identities and all unrelated entries, make only requested changes, and report its changes to the human reviewer.

## Review and import

An update compares the file with the server-retained baseline and current organization state. Independent edits can be retained, but conflicting edits require a choice. A copy targets another organization in the same deployment; matching a path suggests a possible existing module but does not authorize reuse. Source deletion markers never delete target modules. A missing baseline cannot be replaced by values from the edited file. Review all operations, conflicts, affected Subjects, and project impact before confirming. If the target changes after preview, preview again.

For module copy, select copy mode in the target organization, upload the package, and explicitly choose a target module or create a new one for each retained entry. Resolve differences with the target before confirming. The target stores each approved mapping, including reuse, for later imports of the same package; a missing mapped target is a conflict. Copy uses the file and target state, without reading a source baseline.

Copy also carries complete retained Subject snapshots, including root placement and alias, recognition inheritance or override, and each owned child's status and cascade-retirement fact. Current Catalog identity and ownership must match. Existing target registrations retain their identities; choose explicitly when their state, placement, alias, or recognition differs. Retired registrations are created retired, and restoring a copied driver restores only its cascade-retired children. A source deletion marker never retires a target registration.

The service reports its supported package size and counts. An oversized package is rejected rather than truncated or applied in parts.
