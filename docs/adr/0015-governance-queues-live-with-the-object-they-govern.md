# Governance queues live with the object they govern

ADR-0001 made **governance scope** the primary axis of the parameter admin: organization-scoped governance and project-scoped operations are peer top-level areas. It did not say how the organization area subdivides. That subdivision then accumulated one sub-route per execution plan, and by 2026-08-03 the organization area exposed four peer sub-navigation entries: 参数定义库, 定义匹配审核, 模块归属, 节点对应确认.

Two of those four are not objects. They are **work queues over an object that already has its own page**:

- 定义匹配审核 (spec review) decides which parameter definition an unmatched occurrence belongs to. Approving binds the occurrence to a library definition; the create decision writes a new draft definition. Both outcomes land in the definition library, and the implementation reflects this — `OrganizationSpecGovernancePanel` renders both surfaces and is split into two routes only by a `focus` prop, while `ParameterSpecLibrary` already accepts a `reviewQueueSlot`. Presenting the queue as a peer of the library forces an Admin to leave the queue to look up the definition the decision is about.
- 节点对应确认 (identity mapping) decides whether a logical node in a new DTS is the same node as one in the previous revision. Its object is the logical node, and its copy states its own scope: 确认迁移期未能自动对齐的参数节点对应关系. It is migration-era work whose steady-state queue length is zero.

Meanwhile the module area already demonstrates the pattern the other areas lack: `/parameter-admin/modules` is the attribution tree, `/parameter-admin/modules/queue` is the unclassified-driver queue nested beneath it, and the nested sub-navigation hides itself when discovery is empty.

We decided that the organization area subdivides by **governance object**, not by work item. The organization area has exactly two entries — 参数定义管理 and 模块管理 — and every queue nests under the object it governs. A queue whose backlog is structurally temporary is rendered conditionally rather than reserving permanent navigation.

## Considered Options

- **Keep four peers, improve labels only.** Rejected: the labels are not the problem. Two entries name work and two name objects, so no naming scheme makes them read as peers, and the spec-review split still costs a navigation round trip per decision.
- **Fold identity mapping into 模块管理.** Rejected: the module tree is taxonomy (ADR-0010), while identity mapping is topology continuity. Co-locating them would restate exactly the confusion ADR-0010 removed.
- **Add a third 治理待办 page merging both queues.** Rejected on the same grounds as ADR-0001's "job as the primary axis" option: it groups by activity, so the object being governed is split across two pages and the queue page owns no object.
- **Render identity mapping unconditionally as a nested tab.** Rejected as a weaker form of the chosen option — permanent navigation weight for a backlog that is expected to reach and stay at zero. The conditional form degrades to the unconditional one for as long as tasks exist, so nothing is lost.

## Consequences

- Organization sub-navigation is 参数定义管理 (`/parameter-admin/specs`) and 模块管理 (`/parameter-admin/modules`). The spec review queue renders inside the definition management page; identity mapping becomes a nested route under it, shown only while open tasks exist.
- Two routes are retired as navigation targets but kept as redirects, because they are referenced by acceptance operation IDs, coverage matrices, and bookmarks: `/parameter-admin/spec-review` → `/parameter-admin/specs`, `/parameter-admin/identity-mapping` → `/parameter-admin/specs/identity-mapping`.
- Removing two top-level entries removes two places a pending count was implicitly visible. Queue counts already tracked in `ParameterAdminState.queueCounts` must surface on the surviving navigation instead, or the consolidation trades clarity for missed work.
- A conditionally rendered queue can hide unresolved work if its count fails to load. The count load failure path must not render as "no tasks"; it renders the entry with an error state.
- ADR-0001 is unchanged. Scope remains the primary axis; this ADR only states how the organization side of that axis subdivides.
