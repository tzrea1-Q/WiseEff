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
| Runtime mode | Whether the frontend reads live APIs or mock fixtures. Both serve the same semantic model; mock is a data-source substitution, never a different product |

## ADRs

Architectural decisions: [`docs/adr/`](docs/adr/) (created lazily). Feature-scoped decisions usually live in [`docs/design-docs/`](docs/design-docs/).

- [`0001`](docs/adr/0001-parameter-admin-organized-by-governance-scope.md) — parameter admin is organized by governance scope
- [`0002`](docs/adr/0002-mock-runtime-serves-the-semantic-parameter-model.md) — mock runtime serves the semantic parameter model through the same ports
