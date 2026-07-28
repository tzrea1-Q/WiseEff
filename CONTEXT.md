# WiseEff domain context (index)

> Chinese developer onboarding: [`docs/zh-CN/README.md`](docs/zh-CN/README.md)

Short index for agents and skills. **Authoritative product and architecture truth lives in the linked docs below** — not in this file.

## Read first

| Topic | Document |
| --- | --- |
| System map | [`ARCHITECTURE.md`](ARCHITECTURE.md) |
| Domain model | [`docs/design-docs/domain-model.md`](docs/design-docs/domain-model.md) |
| Full-stack architecture | [`docs/design-docs/full-stack-architecture.md`](docs/design-docs/full-stack-architecture.md) |
| Product intent | [`docs/product-specs/product-spec.md`](docs/product-specs/product-spec.md) |
| API contract | [`docs/design-docs/api-contract.md`](docs/design-docs/api-contract.md) |
| Agent harness | [`AGENTS.md`](AGENTS.md), [`docs/agents/`](docs/agents/) |
| Active work | [`docs/PLANS.md`](docs/PLANS.md), [`docs/exec-plans/active/`](docs/exec-plans/active/) |

## Glossary (stub)

Expand lazily via `/domain-modeling` when terms are resolved. Prefer terms from `docs/design-docs/domain-model.md`.

| Term | Meaning |
| --- | --- |
| DTS | Device tree / parameter topology source format in the parameter workbench |
| Parameter surface | Manageable parameter rows bound to topology, not raw DTS paths alone |
| Project-primary DTS | One uploaded DTS per project; merges update that file |
| Binding | Stable link between a parameter row and topology/schema identity |
| Xiaoze | WiseEff Agent assistant surface in the product |
| Parameter admin | Governance surface for parameter specs, review queues, module/driver mappings, project files, config sets, and baselines. Does not own everyday binding edits |
| Parameter workbench | Everyday surface where users read topology and propose binding changes. Does not own governance queues or catalog upkeep |
| Organization-scoped governance | Parameter assets governed independently of any single project: specs, module trees, business categories, policy targets |
| Project-scoped operations | Parameter assets owned by one project: files, config sets, release baselines, bindings |
| Identity mapping task | Governance queue item for a migration-time parameter identity that could not be resolved automatically; Admins resolve it in `/parameter-admin`, while the workbench only surfaces publish blockers |
| Spec review task | Governance queue item asking an Admin to accept, dismiss, or create a parameter spec |
| Node enablement | Whether a logical node instance is itself enabled, derived only from that node's own DTS `status`: absent, `ok`, or `okay` means enabled; anything else means disabled. The subject is the node instance, never the driver module — two instances of one driver are enabled and disabled independently. Not a parameter: it never enters the spec library or the spec review queue |
| Node reachability | Whether an enabled node can actually be probed, which additionally requires every ancestor to be enabled. A node can be enabled but unreachable because an ancestor bus is disabled; the product reports the blocking ancestor rather than restating the node as disabled |
| Enablement override | An overlay's explicit statement about one node's enablement. Three states: inherit from base, force enabled, force disabled. Inherit means the overlay carries no `status` for that node |
| Non-standard enablement value | A DTS `status` value that is neither `ok`/`okay` nor `disabled`, such as `reserved` or `fail`. Treated as not enabled, but its original text is preserved and one-click toggling is refused so the author's intent is not silently overwritten |
| Runtime mode | Whether the frontend reads live APIs or mock fixtures. Both serve the same semantic model; mock is a data-source substitution, never a different product |
| Module kind | A module's role in the three-layer attribution tree: business category, driver group, or device instance. Stated on the module, orthogonal to origin — adopting an instance module makes it curated but never makes it a business category |
| Business category | A module humans reason in, such as 充电策略 or 电池安全. Holds driver groups, never holds parameters of its own device |
| Driver group | The module a compatible resolves to. Gathers every device instance sharing that compatible under one business category |
| Device instance module | The module for one DTS node instance. The leaf that parameters actually hang from |
| Module origin | Who authored a business module: curated (a human made it a business concept), auto-discovered (DTS ingest created it from a device instance or driver group), or unclassified (the fallback bucket for bindings nothing else claimed). A stated fact about the module, never inferred from its name |
| Curated module | A business module a human owns. Ingest may file bindings into it but never renames, moves, or deletes it |
| Auto-discovered module | A module ingest created to hold bindings it could place but no human has claimed. Ingest still owns its name and position |
| Module adoption | The moment an Admin renames, moves, or re-weights an auto-discovered module. The module becomes curated from then on; there is no separate "adopt" action |
| Unclassified queue | The compatibles observed on project parameters that no driver group claims yet. Scaffolding compatibles never enter it, and an Admin can dismiss an entry, so the queue is expected to reach empty |
| Dismissed compatible | A compatible an Admin declared out of scope for the module tree. It leaves the unclassified queue without gaining a driver group, and the decision is reversible |
| Driver registration | An organization's declaration that a device is in scope, stated as a curated driver group naming its business category and the exact compatibles it claims. Not a separate record: the driver group is the registration |
| Parse coverage | Whether a compatible is matched by a pinned schema document, including through a prefix pattern. A fact about the platform's schema catalog, never about one organization |
| Observed coverage | Whether a registered driver has produced parameters in at least one project. None means declared but not yet seen, which is a normal state rather than a misconfiguration |
| Not-yet-observed driver group | A registered driver group holding no parameters. Shown in the tree rather than hidden, because being visible before the DTS arrives is why it was registered |

## ADRs

Architectural decisions: [`docs/adr/`](docs/adr/) (created lazily). Feature-scoped decisions usually live in [`docs/design-docs/`](docs/design-docs/).

- [`0001`](docs/adr/0001-parameter-admin-organized-by-governance-scope.md) — parameter admin is organized by governance scope
- [`0002`](docs/adr/0002-mock-runtime-serves-the-semantic-parameter-model.md) — mock runtime serves the semantic parameter model through the same ports
- [`0003`](docs/adr/0003-node-enablement-is-not-a-parameter.md) — node enablement is not a parameter, but rides the parameter draft pipeline
- [`0004`](docs/adr/0004-module-tree-states-kind-and-origin.md) — the module tree states kind and origin instead of inferring them
- [`0005`](docs/adr/0005-compatible-and-instance-are-the-only-attribution-levers.md) — compatible and instance are the only attribution levers
- [`0006`](docs/adr/0006-logical-nodes-and-manual-kind-correction.md) — logical nodes and manual kind correction
- [`0007`](docs/adr/0007-driver-registry-is-a-view-over-curated-driver-groups.md) — the driver registry is a view over curated driver groups
