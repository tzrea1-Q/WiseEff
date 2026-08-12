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
| [0011](0011-spec-deprecation-is-soft-retirement.md) | Spec deprecation is soft retirement |
| [0012](0012-releasing-happens-at-the-file-layer.md) | Releasing happens at the file layer |
| [0013](0013-attribution-subjects-are-stable-catalog-entities.md) | Attribution subjects are stable catalog entities |
| [0014](0014-parameter-definitions-are-versioned-subjects.md) | Parameter definitions are versioned subjects with soft retirement |
| [0015](0015-governance-queues-live-with-the-object-they-govern.md) | Governance queues live with the object they govern |
| [0016](0016-cell-arrays-are-governed-by-column-width-only.md) | Cell arrays are governed by column width only; row count is not a governed fact |
| [0017](0017-definition-identity-is-correctable.md) | Definition identity is correctable and `parameter_specs.id` is a surrogate |
| [0018](0018-uploaded-file-versions-are-staged-before-activation.md) | Uploaded file versions are staged before activation |
| [0019](0019-debug-values-never-mutate-the-parameter-library.md) | Debug values never mutate the parameter library |
| [0020](0020-reload-runs-execute-in-request-on-bridge-holding-process.md) | Reload runs execute in-request on the bridge-holding process |
| [0021](0021-reload-snapshot-satisfies-device-write-snapshot-non-negotiable.md) | Reload snapshot satisfies the device-write snapshot non-negotiable |
| [0022](0022-log-analysis-agent-runs-outside-the-xiaoze-stack.md) | Log analysis agent runs outside the Xiaoze stack |
| [0023](0023-app-state-transitions-live-in-application-state.md) | Frontend app state transitions live in application/state, not App.tsx |
| [0024](0024-agent-approval-state-is-db-backed.md) | Agent approval state is DB-backed; request context flows through invocation config |
| [0025](0025-knowledge-retrieval-lives-in-postgres.md) | Knowledge retrieval lives in PostgreSQL |
| [0026](0026-design-tokens-are-the-single-visual-source.md) | Design tokens are the single visual source |
