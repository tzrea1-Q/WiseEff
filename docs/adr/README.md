# Architecture Decision Records

ADRs capture durable architectural decisions that are not already recorded in `docs/design-docs/`.

- Prefer updating the closest feature design or RFC when the decision is scoped to one area.
- Use numbered ADRs here when the decision is cross-cutting or needs a stable ID for agent skills (`docs/agents/domain.md`).
- Created lazily via `/domain-modeling` when decisions are actually resolved — do not pre-populate.

See also: [`CONTEXT.md`](../../CONTEXT.md), [`docs/design-docs/domain-model.md`](../design-docs/domain-model.md).

| ADR | Title |
| --- | --- |
| [0001](0001-parameter-admin-organized-by-governance-scope.md) | Parameter admin organized by governance scope |
| [0002](0002-mock-runtime-serves-the-semantic-parameter-model.md) | Mock runtime serves the semantic parameter model |
| [0003](0003-node-enablement-is-not-a-parameter.md) | Node enablement is not a parameter |
| [0004](0004-module-tree-states-kind-and-origin.md) | Module tree states kind and origin |
| [0005](0005-compatible-and-instance-are-the-only-attribution-levers.md) | Compatible and instance are the only attribution levers |
| [0006](0006-logical-nodes-and-manual-kind-correction.md) | Logical nodes and manual kind correction |
| [0007](0007-driver-registry-is-a-view-over-curated-driver-groups.md) | Driver registry is a view over curated driver groups |
| [0008](0008-platform-authored-parsing-is-an-org-scoped-overlay.md) | Platform-authored parsing is an org-scoped overlay |
| [0009](0009-overlay-parsing-knowledge-promotes-into-a-platform-tier.md) | Overlay parsing knowledge promotes into a platform tier |
| [0010](0010-attribution-tree-is-taxonomy-not-topology.md) | Attribution tree is taxonomy, not topology |
| [0013](0013-attribution-subjects-are-stable-catalog-entities.md) | Attribution subjects are stable catalog entities |
| [0014](0014-parameter-definitions-are-versioned-subjects.md) | Parameter definitions are versioned subjects with soft retirement |
