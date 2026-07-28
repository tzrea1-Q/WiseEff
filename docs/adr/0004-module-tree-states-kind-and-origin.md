# The module tree states kind and origin instead of inferring them

One `parameter_modules` tree carries three different things at once: business groupings a human curated (`Power`, `Thermal Control`), driver groups and device-instance modules that DTS ingest created on its own (`sc8562`, `sc8562@6E`, `i2c@FDF5E000`), and the `未分类 · {driver}` buckets the write path parks a binding in when nothing else claims it. Nothing on a module said which of those it was, so the admin surface guessed from the name: `src/domain/parameter-topology/moduleProvenance.ts` matched `@{hex}` and a hard-coded `i2c|spi|pmic|batt|scharger` list, hid whatever matched behind a "显示自动发现" checkbox, and let everything else — including machine-created modules like `cccv_para0` — sit in the tree labelled "业务模块". The guess is unfixable in principle: a driver group named after a compatible tail is indistinguishable by name from a business category someone typed.

We decided the tree keeps one shape but every module **states** two orthogonal facts. `kind` is the module's role in the three-layer attribution model — business category holds driver groups, a driver group holds the device instances sharing one compatible, and a device instance is the leaf parameters hang from. `origin` is who authored it — curated, auto-discovered, or the unclassified fallback. They are orthogonal because adopting a machine-created instance module makes it curated without making it a business category.

## Considered Options

- **Split into two trees** — a curated business tree and a read-only machine tree, with each binding referencing both. Faithful to the distinction, and rejected on cost: `project_parameter_bindings.module_id` is a single FK that the workbench navigation, the unique key `(project_id, logical_node_id, parameter_spec_id, module_id)`, and every module-scoped query already build on. Two trees means two FKs and a second traversal everywhere, to express something one field expresses.
- **Derive kind on the server instead of storing it** — a module targeted by a compatible mapping is a driver group, its descendants are instances, the rest are business categories. Cheaper (no migration) but it is the same guess moved one layer down, and it breaks on exactly the cases that matter: a driver group whose mapping was deleted silently becomes a business category, and an instance module that predates its group has no derivable role.
- **Backfill everything as curated** — safe in that nothing gets wrongly hidden, rejected because the several hundred machine-created modules already in the tree would be permanently indistinguishable from business categories, which is the state we are trying to leave.

## Consequences

- Backfill is a one-time heuristic and is accepted as imperfect: modules targeted by a compatible mapping become driver groups, their instance-shaped descendants become instances, the `未分类` family becomes unclassified, and the rest become curated business categories. A wrong guess is corrected by editing the module, because editing is what promotes it to curated anyway.
- Adoption has no button. Renaming, moving, or re-weighting an auto-discovered module makes it curated, and ingest must never rename or move a curated module afterwards.
- That forces ingest off name-based lookup. `ensureNamedModule` currently finds a module by `(organization_id, parent_id, name)`, so the first human rename makes ingest miss and create a duplicate. Modules gain a stable `source_key` (the compatible for a driver group, the node path for an instance) that ingest matches on instead.
- The admin UI shows kind-scoped actions rather than the same three buttons on every row, which also stops users from hitting the `RESTRICT` foreign key by trying to delete a module that still has bindings.
- Importance becomes a property of business categories only; driver groups and instances inherit from the nearest ancestor business category. Before this, every machine-created module kept the `medium` default, so the workbench importance filter partitioned almost nothing.

## Follow-up

ADR-0006 splits nodes without compatible evidence into `kind=logical`, and opens controlled kind correction on the edit path so the "edit to fix a wrong guess" consequence above is actually reachable.
