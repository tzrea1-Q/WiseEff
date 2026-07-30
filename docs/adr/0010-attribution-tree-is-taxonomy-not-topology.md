# Attribution tree is taxonomy, not topology

ADR-0004 made every module state `kind` and `origin` instead of inferring them from the name. ADR-0005 retired the inert `driver` match kind and left `compatible` and `instance` as the only attribution levers. ADR-0006 added `logical` for DTS nodes without compatible evidence and opened controlled kind correction. Together they produced a three-layer tree — business category → driver group → instance / logical module — where parameters hung from per-instance leaves and device identity was duplicated between `module_id` and `logical_node_id`.

Measured against the live seeded database, that model mostly mirrored topology instead of classifying it. Driver groups — the layer that expresses "which device model is this" — held zero parameters. Seventy-six percent of bindings sat on `logical` modules whose defining property was that ingest could not classify them, not that they represented a product concept. Eighty-seven percent of `instance` match rules matched on a bare node name (`middle_cpu`, `direct_charger`) rather than a unit address, because the product was already attributing config blocks by node type while calling the lever "instance". The spec library's 预测模块 column then re-ran that matcher without binding-scoped evidence (`instanceName: null`, `compatiblePatterns` on four of 252 specs), so almost every row falsely read as 未分类 · {driver}（预测） even when bindings were correct.

We decided the parameter module tree expresses **classification only** — business category, driver group, node type — and stops mirroring DTS topology inside it. Module kinds become `business | driver-group | node-type | unclassified`; `instance` is removed and `logical` is renamed to `node-type` so the old per-instance reading cannot survive silently. Attribution levers are `compatible` (device model → driver group) and `node-type` (driverless config node → node-type unit; match value is the bare node name, unit address stripped, normalized through `normalizeMatchToken`). Bindings attach to driver groups and node-type units only; device instance identity lives solely in `logical_node_id`. A parameter definition's attribution is the distinct set of attribution units its bindings resolve to, returned server-side as `attributionModules` — the spec layer never re-runs compatible or node-type matching.

### Supersedes (partial)

| Prior ADR | Superseded claim | Replacement |
| --- | --- | --- |
| ADR-0004 | A device instance is the leaf parameters hang from | Driver groups and node-type units receive bindings; per-instance modules are gone |
| ADR-0004 | Three-layer tree is business → driver group → instance | Taxonomy is business → {driver group \| node-type} → node-type\*; per-instance browsing uses the workbench `groupByDevice` layer, not registry rows |
| ADR-0005 | Compatible and instance are the only attribution levers | Compatible and **node-type** are the only levers; `instance` match kind is removed |
| ADR-0006 | `logical` means a DTS node instance WiseEff cannot prove is a device | `node-type` means a **class** of driverless configuration node, keyed by bare node name — not one row per topology instance |
| ADR-0006 | Scaffolding modules (`i2c@…`, `pmic@0`, `batt`) deferred to tech debt | Scaffolding leaves the tree; their bindings park on the unclassified root (closes TD-045) |

### Why `node-type` is not a revival of the retired `driver` lever

ADR-0005 retired `driver` because it was **inert**: every binding write path consulted instance and compatible first, and DTS-parsed bindings essentially always carry an instance name, so a driver-name rule decided nothing while still clearing queue items. The `node-type` lever is the opposite — it is how 416 of 548 bindings are attributed today, only mislabelled as `instance`. It matches on **node name without unit address** for nodes that have no `compatible` string, not on a driver-module display name. It resolves to a taxonomy unit (`nodetype:{name}`), not a catch-all bucket. Retiring `driver` removed a queue that could never be productively worked; adding `node-type` names the lever the product was already using and makes spec attribution a stated fact from bindings instead of a doomed re-prediction.

## Considered Options

- **Keep instance modules and fix the spec prediction inputs** — pass `instanceName` and fuller compatible evidence into `deriveModuleAssignment`. Rejected: the defect is the model conflating topology instance with taxonomy type, not missing columns on the prediction call. Feeding better inputs still leaves driver groups empty and duplicates instance identity across `module_id` and `logical_node_id`.
- **Rename `logical` in place without dropping `instance`** — cheaper migration, rejected because keeping the name `logical` while changing it from per-instance to per-type would let the old reading survive silently in code, docs, and operator mental models.
- **Dual-read compatibility layer for old kinds and match kinds** — rejected on cost: seeded data is reproducible and simulation shows coarsening `module_id` does not violate the binding unique key; a compatibility layer would cost more than it protects (same precedent as Phase 2 binding cutover).

## Consequences

- Migration `0080` widens then narrows kind and `match_kind` checks; repoints instance bindings to parent driver groups; converts `logical` and bare-name `instance` mappings to `node-type`; deletes scaffolding units; records row counts before and after each step.
- `resolveModuleForBinding` becomes the single write-path resolver (compatible → node-type → unclassified). `ensureAttributionModuleForBinding` replaces per-instance materialization; `resolveBindingInstanceModuleId` and provisional `未分类 · {label}` buckets go away.
- `GET /api/v2/parameter-specs` returns `attributionModules: Array<{ id, name, kind }>` per spec. The definition library column becomes 归属模块 (no `（预测）` suffix). Registered-but-not-yet-observed driver groups show 未实测; `deriveModuleAssignment` survives only as remap tooling.
- Attribution tree kind badges become `business` / `driver-group` / `node-type` / `unclassified`. Reclassify whitelist becomes `{business, node-type}`. Parameter counts split into **定义数** (distinct specs) and **实测处数** (bindings). `DtsParameterWorkbench` enables `groupByDevice` so per-instance navigation survives without per-instance modules.
- Unclassified queue gains a second population: node types that could not be placed, alongside observed-but-unregistered compatibles. Dismiss/restore semantics unchanged.

## Follow-up

- `businessCategoryForNodePath` remains a demo-grade keyword router for auto node-type placement — filed as tech debt, not replaced here.
- Spec `driverModule` string can disagree with node evidence on the same property; attribution from bindings sidesteps that split but does not reconcile it — filed as tech debt.
- Removing `module_id` from the binding unique key is separable cleanup; simulation shows it is currently redundant rather than harmful.
