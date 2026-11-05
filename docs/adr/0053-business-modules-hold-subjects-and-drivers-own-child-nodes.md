# ADR-0053: Business modules hold subjects; drivers own their child nodes

> Chinese companion: [中文决策记录](../zh-CN/design-docs/adr-0053-business-modules-hold-subjects-and-drivers-own-child-nodes.md)

Date: 2026-11-02

## Status

Accepted for [#1479](https://github.com/tzrea1-Q/WiseEff/issues/1479). Implementation plan: [module subject structure](../exec-plans/completed/2026-11-02-issue-1479-module-subject-structure.md), delivered in slices S1–S5. This ADR amends [ADR-0042](0042-organizations-register-canonical-subjects-once.md); ADR-0040's identity, release and synchronizer rules stay in force.

[ADR-0054](0054-module-structure-transfer-is-explicit-organization-governance.md) adds the accepted design for organization structure transfer and retired-registration placement editing. Its implementation is pending; this ADR's Catalog ownership and child-lifecycle invariants remain in force.

## Context

ADR-0042 placed each Subject registration into a module whose kind mirrored the subject kind (`driver-group`, `node-type`, or `business` for configuration schemas), and the database allowed one placement per module. Users therefore had to create a technical module named after each driver inside a business category, the "adjust placement" picker hid business categories, and a module's tree position looked like, but was not, a structural relation between a driver and its child nodes. The Catalog also drops a driver schema's `childNodes`, and node types are globally unique by name, so an identically named child node under another driver can match the wrong subject.

## Decision

1. **Modules are business taxonomy only.** New placements and new modules use `business` or the reserved `unclassified` root. `driver-group` and `node-type` modules become read-only legacy rows until migrated and archived.
2. **A business module holds any number of root subjects** (drivers, standalone node types, configuration schemas) and may also have business child modules. The one-placement-per-module constraint is removed; each registration still owns exactly one retained placement (ADR-0042 invariant unchanged).
3. **Catalog ownership remains identity; organization ownership can be overridden explicitly.** A node type may have a permanent Catalog owner driver (`catalog_subjects.owner_subject_id`), with names scoped to that owner. The [#1509 clarification](https://github.com/tzrea1-Q/WiseEff/issues/1509) permits an administrator to change an owned node's driver **only in the current organization**, using a nullable owner override on its retained registration. Other organizations and published Catalog identities remain unchanged. The conditional, audited command validates the target driver, organization registration, current release and selector conflicts. Moving back to the Catalog owner clears the override. A change to the shared Catalog identity still requires a new subject and ADR-0044 definition replacement.
4. **Owned child subjects keep their own registration and placement**, so existing Bindings keep their registration identity. Their placement has no module; the organization shows them under the effective owner driver's placement. Effective ownership uses the organization override when present, otherwise the Catalog owner. The same rule governs recognition, lifecycle cascades, source-scope checks, and structure export/copy. An ownership adjustment preserves definitions, values, history and source bytes; it does not move DTS nodes. Later source edits retain the existing preview and approval requirements.
5. **Child registration follows the root, with independent organization retirement.** Registering a driver registers its active owned children in the same transaction; retiring it retires them as a cascade; restoring it restores only cascade-retired children. As clarified in [#1509](https://github.com/tzrea1-Q/WiseEff/issues/1509), administrators may independently retire and restore a child through the same conditional, audited registration lifecycle as a driver. Independently retired children remain retired when the driver is restored; restoring a child requires an active owner in both the Catalog and the organization. Registration, placement, definitions, bindings, values and history are retained. Children still have no independent registration action.
6. **Matching uses owner context.** A node's own compatible resolves a driver; otherwise the nearest ancestor driver's owned child of that node name; otherwise a standalone (owner-less) node type. An owned node type is never matched without its owner context.
7. **One read seam** derives each registration's effective business module (directly or through its owner) for the module tree, counts, definition library and project workbench.
8. **Names are not identity.** A legacy technical module's name may survive as an organization display alias on a root registration; it never replaces subject, definition, binding or value identity.

## Consequences

- Organization recognition overrides move from module-keyed rows to registration-keyed rows.
- Single, batch and review registration stop creating technical wrapper modules; #1447's "create same-kind module / pick a free module" options are superseded.
- Existing technical modules are migrated by a preflighted, idempotent, audited per-organization migration that reports conflicts (shared or unproven child ownership, wrong-name modules, unregistered owners) instead of guessing, and archives rather than deletes the old modules.
- Children whose ownership evidence is inconsistent remain standalone node types and are reported.

## Considered options

- **Hide the wrapper layer in the UI only.** Rejected: the database constraint, registration writer and matcher would still encode the old relation.
- **Make the driver registration the only registration and re-point child Bindings.** Rejected: it rewrites retained Binding identity and audit history.
- **Version the parent relation per release.** Rejected: re-parenting a node changes its meaning, so it is modelled as a new subject instead.
