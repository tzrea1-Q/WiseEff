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
| Project configuration workbench | The project-scoped operational surface where Admins manage source files, configuration composition, release state, and file conflicts in one project context. Distinct from the everyday parameter workbench, which is organized around reading and proposing parameter changes |
| Config set | A project-scoped, buildable composition of a primary DTS and any supporting parameter files. It is the working context of the project configuration workbench; a release baseline snapshots its member file versions |
| Working configuration | The current member-file versions of a config set. It is the mutable source state inspected and changed in the project configuration workbench and becomes releasable only after a release baseline snapshots it |
| Candidate file version | An uploaded file version that has been parsed and compared but has not been activated into a config set's working configuration. Uploading creates a candidate; explicit activation changes the working configuration |
| Structured DTS edit | A property-level source change addressed through parsed DTS identity and submitted through the governed change-request flow. It is distinct from replacing or freely rewriting an entire source file |
| Release readiness | The derived blocking-and-warning state that says whether a config set's working configuration can be snapshotted or released. It summarizes member/version completeness, local edits, file conflicts, validation diagnostics, and publish-blocking governance tasks |
| Release baseline | The only release unit in WiseEff: a snapshot pinning every config-set member to a file version, moved `draft → released` by an Admin. Builds and devices consume DTS files, so releasing happens at the file layer. Releasing, rolling back, and removing a config-set member each require an explicit confirmation stating the blast radius |
| Conflict arbitration | Deciding which side wins when a file sync and a UI draft changed the same parameter. The workbench Conflicts dock compares the shared base with the file/candidate and pending UI values (source-located); both outcomes carry equal weight, confirmation may record an audit reason, eligible bulk resolve needs an impact preview, and open conflicts block Candidate activation |
| Config revision | A derived read model of one parsed file version, never a releasable artifact. Its statuses describe ingest, identity mapping, validation, and review readiness only; a revision is never published |
| Identity mapping task | Governance queue item for a migration-time parameter identity that could not be resolved automatically. Admins decide under parameter definition management in `/parameter-admin` (`/parameter-admin/specs/identity-mapping`; ADR-0015): **resolve** (remap to a candidate), **dismiss** (reject candidates; ambiguity stands), or **new identity** (confirm no predecessor; clears that task). Only dismiss and new-identity may reopen; resolve is terminal because bindings were remapped |
| Spec review task | Governance queue item asking an Admin to accept, dismiss, or create a parameter spec |
| Parameter spec lifecycle | A parameter definition's governance state: `draft`, `active`, or `deprecated`. Stated for the definition as a whole, never per version. Edges are activate (`draft → active`), deprecate (`draft` or `active` → `deprecated`), and restore (`deprecated` → whichever state the definition had reached before it was deprecated) |
| Spec deprecation | Soft retirement of a parameter definition. It stops being selectable when resolving a spec review task and leaves the default library view, but stays releasable for DTS parsing so no project loses parse coverage as a result of a governance action. Deprecating never rewrites project data. Contrast with overlay retirement |
| Overlay retirement | Withdrawing a driver schema overlay from the schema registry. Unlike spec deprecation this does remove parsing capability, so compatibles that relied on the overlay become parse uncovered. Surfaced as 停用解析, never as 废弃, because the two governance acts have opposite consequences |
| Deprecated-definition reference | A binding pointing at a deprecated definition. A reported state rather than an error: parsing is unchanged, and the product shows the reference count so an Admin can decide whether a successor definition is needed |
| Node enablement | Whether a logical node instance is itself enabled, derived only from that node's own DTS `status`: absent, `ok`, or `okay` means enabled; anything else means disabled. The subject is the node instance, never the driver module — two instances of one driver are enabled and disabled independently. Not a parameter: it never enters the spec library or the spec review queue |
| Node reachability | Whether an enabled node can actually be probed, which additionally requires every ancestor to be enabled. A node can be enabled but unreachable because an ancestor bus is disabled; the product reports the blocking ancestor rather than restating the node as disabled |
| Enablement override | An overlay's explicit statement about one node's enablement. Three states: inherit from base, force enabled, force disabled. Inherit means the overlay carries no `status` for that node |
| Non-standard enablement value | A DTS `status` value that is neither `ok`/`okay` nor `disabled`, such as `reserved` or `fail`. Treated as not enabled, but its original text is preserved and one-click toggling is refused so the author's intent is not silently overwritten |
| Runtime mode | Whether the frontend reads live APIs or mock fixtures. Both serve the same semantic model; mock is a data-source substitution, never a different product |
| Workbench session | A recoverable client-side state machine inside the project configuration workbench for one domain act (structured DTS edit, candidate file version flow, release baseline, conflict locate, config-set ops, navigation/selection, workspace load, canvas history, or activity timeline). It is not a server artifact and must not be confused with a candidate file version or a config revision |
| Module kind | A module's role in the attribution taxonomy: business category, driver group, node-type unit, or unclassified root. Stated on the module, orthogonal to origin — adopting a node-type unit makes it curated but never makes it a business category (ADR-0010) |
| Business category | A module humans reason in, such as 充电策略 or 电池安全. Holds driver groups and node-type units; never receives bindings |
| Driver group | The binding target a `compatible` resolves to. Holds parameter definitions for every device instance sharing that compatible; instance identity on bindings is `logical_node_id`, not a per-instance module |
| Node-type unit | The binding target a driverless configuration node resolves to via the `node-type` lever. Keyed by bare node name (`nodetype:{name}`); may nest under a business category or another node-type unit. Not one row per topology instance (ADR-0010) |
| Module origin | Who authored a business module: curated (a human made it a business concept), auto-discovered (DTS ingest created it from a device instance or driver group), or unclassified (the fallback bucket for bindings nothing else claimed). A stated fact about the module, never inferred from its name |
| Curated module | A business module a human owns. Ingest may file bindings into it but never renames, moves, or deletes it |
| Auto-discovered module | A module ingest created to hold bindings it could place but no human has claimed. Ingest still owns its name and position |
| Module adoption | The moment an Admin renames, moves, or re-weights an auto-discovered module. The module becomes curated from then on; there is no separate "adopt" action |
| Unclassified queue | Observed-but-unregistered compatibles plus node types ingest could not place. Scaffolding compatibles never enter it; an Admin can dismiss a compatible entry. Bindings with no attribution match park on the unclassified root module (ADR-0010) |
| Dismissed compatible | A compatible an Admin declared out of scope for the module tree. It leaves the unclassified queue without gaining a driver group, and the decision is reversible |
| Driver registration | Stable catalog subject (`DriverRegistration`) declaring a device or logical service is in scope, with `driverNature` and `instanceCardinality`. A taxonomy `driver-group` module places it in the tree but is not the registration itself (ADR-0013) |
| Attribution subject | Stable catalog identity for where a parameter definition belongs: `DriverRegistration` or `NodeTypeDefinition`. Specs bind to subjects + `property_key`; never to a project `logical_node_id` (ADR-0013). Mis-authored subjects are correctable in place (ADR-0017); placement in the module tree is a separate fact |
| Identity correction | Audited governance act that rewrites a definition's `attribution_subject_id` and/or `property_key` while keeping `parameter_specs.id` as a surrogate key. Re-attribution is allowed in any lifecycle; property-key rename only while `referenceCount = 0` (ADR-0017) |
| ParameterSpecVersion | Versioned content of a parameter definition (shape, constraints, docs). Definition lifecycle is draft/active/deprecated; version status is draft/active/superseded. Soft retirement is definition-level (ADR-0014) |
| Parse coverage | Whether a compatible is matched by a releasable schema — a pinned `schemas/dts` document (including prefix patterns) or an active organization overlay (exact compatible only). The chip distinguishes platform vs organization coverage |
| Organization driver schema overlay | An org-owned manual driver schema (exact compatible + property definitions) that merges into the schema registry as the lowest releasable tier. Closes "parse uncovered" without editing repository files (ADR-0008) |
| Platform driver schema tier | A promoted overlay row scoped to no organization (`driver_schema_overlays.organization_id IS NULL`), readable by every tenant, matched ahead of org overlays and behind vendor (ADR-0009) |
| Overlay promotion | The reviewed platform act (`platform-admin` / `platform:schema-promote`) that lifts organization overlays into the platform tier, superseding contributing org rows instead of deleting them |
| Platform super admin | Cross-organization role `platform-admin`. Home organization stays required on AuthContext; does not widen tenant business-data access; unlocks platform rows and promotion |
| Observed coverage | Whether a registered driver has produced parameters in at least one project. None means declared but not yet seen, which is a normal state rather than a misconfiguration |
| Not-yet-observed driver group | A registered driver group holding no parameters. Shown in the tree rather than hidden, because being visible before the DTS arrives is why it was registered |
| DTS reload debugging | Product UI title 「参数调试」 on `/dts-reload` — validating candidate parameter values on real hardware by generating a device-tree overlay from library parameters, compiling it, deploying it, and triggering a kernel reload. The unit of work is a batch of parameters reloaded together, never one property at a time. Distinct from node debugging, which reads and writes individual runtime node paths. Distinct from the product-offline legacy `/debugging` route (TD-032) |
| Debug overlay | The generated artifact of one reload run: a `/plugin/` DTS document addressing nodes by absolute `target-path` (never by `&label`), plus the `dtbo` compiled from it. Authored entirely by the platform from resolved bindings; never hand-edited by users |
| Reload run | One attempt to put a set of debug values onto one device: generate, compile, pre-flight against the project base DTB, deploy, trigger, verify. The run is the audit and evidence subject, and it either lands as a whole or fails as a whole |
| Debug value | A candidate value carried by a reload run. Transient and run-scoped: it never mutates a binding revision, working configuration, draft, or release baseline. Promoting a debug value into the library is a separate governed change request |
| Reload configuration | The device-side contract a reload run must obey: where the overlay file lands, which kernel node triggers the reload, what payload that node expects, and which command reads the kernel log. Stated as organization defaults (with seeded fallbacks when none are saved), editable only by a debugging admin and resolved server-side from stored records — never accepted from the client, because a client-supplied kernel path or log command is a privileged-execution primitive. Kernel log commands are validated on save against the closed exact allowlist in `@wiseeff/device-command-core/kernelLogCommand` (`dmesg`, `dmesg -T`, `hilog`, `hilog -x`, `cat /proc/kmsg`); the bridge re-validates independently before execution |
| Kernel log evidence | The raw kernel-log excerpt a reload run captures and stores verbatim. Filtering by parameter name happens server-side after capture, so no parameter name is ever interpolated into a device command. Presented to humans as unjudged evidence: the platform never infers success or failure from its text |
| Reload snapshot | The evidence a reload run captures instead of an undoable snapshot: each parameter's library baseline value, the deployed artifact digest verified against the on-device copy, whatever kernel-side signal the platform could obtain, and per-parameter behavioural verification outcomes when debug-node bindings exist. It deliberately makes no device-tree value claim from kernel logs alone |
| Unverifiable reload | The honest default outcome of a reload run: every command succeeded and the artifact landed intact, yet the platform cannot confirm the driver observed the new values — either no selected parameter has a readable debug-node binding, or bound reads failed without a contradiction. Reported as a distinct state from success, never collapsed into it |
| Behaviourally verified | A stronger terminal than unverifiable: every selected parameter that has a readable debug-node binding was read through the existing node-read path and matched the debug value under the parameter's declared value shape |
| Contradicted reload | A terminal where at least one bound debug-node read disagreed with the debug value. Never reported as verified |
| Reload residue | The platform's own bookkeeping that a device was last left carrying debug values rather than baseline. Derived from run history, not from the device, so it goes stale on reboot, reflash, or any manual change made outside the platform, and must be presented with that limitation stated |
| Restore-baseline | A reload run with `purpose: restore-baseline` whose debug values are the current library baselines for the residue parameter set. It reuses the normal start + deploy path (no shortcut) and clears residue only when it reaches a post-device-write terminal while still targeting the recorded source run |
| Reload purpose | `ordinary` (put debug values on the device) or `restore-baseline` (compensating reload toward library baselines). Stored on `dts_reload_runs.purpose` and surfaced in history / last-reload projections |
| Sensitive reload | The sensitive-node extension of reload start: matching `dts_sensitive_node_rules` additionally requires `parameter:edit-critical`, and critical-tier matches also require `confirmationToken: "confirm-sensitive-reload"`. Distinct from the deploy token `confirm-dts-reload` |
| Parameter reload (retired) | The 2026 M1-era concept binding one parameter definition to one device node path and writing it through sysfs, which also wrote the accepted value back into project parameter values. Never shipped, HTTP surface returned `410` from its first commit, and its binding table was dropped in migration `0037`. Retained here only so the term is not confused with DTS reload debugging |
| Agent approval chain | The orchestrator-owned path every mutating Agent tool call must cross: `beginApproval` persists `agent_tool_calls` + `agent_approvals` rows and raises the interrupt; `resolveApproval` carries the human decision, applies `editedArgs` as a full payload replacement, re-authorizes transactionally, and executes. Its only state is those database rows — never process memory — so begin and resolve may land on different processes (ADR-0024) |
| Knowledge base | The in-product, organization-scoped home for enterprise engineering knowledge: tuning experience, fault cases, hardware manuals, and process norms. A fourth workflow peer to parameter management, log analysis, and debugging. Never means the repository `docs/` developer documentation, which is a development artifact rather than a product surface. Xiaoze reads it through registered tools; agent-authored knowledge always lands as a draft that a human must publish |
| Knowledge entry | The unit of knowledge in the knowledge base. Its content form is exactly one of markdown (created and edited in product) or file (an uploaded binary whose extracted text is searchable while the binary itself is only replaceable). Organization is flat: multi-tags including project tags, never a hierarchy. Lifecycle is `draft → published → archived` |
| Knowledge revision | The immutable snapshot produced by every save of a knowledge entry. Published entries edit in place wiki-style — there is no pending-changes state — and any prior revision can be restored, which itself produces a new revision |
| Agent knowledge draft | A knowledge entry Xiaoze creates through its approval-gated draft tool. Always born `draft`, never modifies an existing entry, and stays invisible to retrieval until a human publishes it; whoever publishes takes responsibility for the content |
| Knowledge distillation | Turning a structured analysis outcome into a pre-filled knowledge draft carrying references to its evidence. MVP distils log-analysis conclusions; DTS reload runs are a planned later source |
| Published-only retrieval | Search, RAG, and Xiaoze only ever see `published` knowledge entries. Draft and archived entries never enter the retrieval index, which makes publishing the single trust gate for knowledge |

## ADRs

Architectural decisions: [`docs/adr/`](docs/adr/) (created lazily). Feature-scoped decisions usually live in [`docs/design-docs/`](docs/design-docs/).

- [`0001`](docs/adr/0001-parameter-admin-organized-by-governance-scope.md) — parameter admin is organized by governance scope
- [`0002`](docs/adr/0002-mock-runtime-serves-the-semantic-parameter-model.md) — mock runtime serves the semantic parameter model through the same ports
- [`0003`](docs/adr/0003-node-enablement-is-not-a-parameter.md) — node enablement is not a parameter, but rides the parameter draft pipeline
- [`0004`](docs/adr/0004-module-tree-states-kind-and-origin.md) — the module tree states kind and origin instead of inferring them
- [`0005`](docs/adr/0005-compatible-and-instance-are-the-only-attribution-levers.md) — compatible and instance are the only attribution levers
- [`0006`](docs/adr/0006-logical-nodes-and-manual-kind-correction.md) — logical nodes and manual kind correction
- [`0007`](docs/adr/0007-driver-registry-is-a-view-over-curated-driver-groups.md) — the driver registry is a view over curated driver groups
- [`0008`](docs/adr/0008-platform-authored-parsing-is-an-org-scoped-overlay.md) — platform-authored parsing is an org-scoped overlay, not repository editing
- [`0009`](docs/adr/0009-overlay-parsing-knowledge-promotes-into-a-platform-tier.md) — overlay parsing knowledge promotes into a platform tier
- [`0010`](docs/adr/0010-attribution-tree-is-taxonomy-not-topology.md) — attribution tree is taxonomy, not topology
- [`0011`](docs/adr/0011-spec-deprecation-is-soft-retirement.md) — parameter definition deprecation is soft retirement
- [`0012`](docs/adr/0012-releasing-happens-at-the-file-layer.md) — releasing happens at the file layer
- [`0013`](docs/adr/0013-attribution-subjects-are-stable-catalog-entities.md) — attribution subjects are stable catalog entities
- [`0014`](docs/adr/0014-parameter-definitions-are-versioned-subjects.md) — parameter definitions are versioned subjects with soft retirement
- [`0015`](docs/adr/0015-governance-queues-live-with-the-object-they-govern.md) — organization admin subdivides by governance object; queues nest under the object they govern
- [`0016`](docs/adr/0016-cell-arrays-are-governed-by-column-width-only.md) — cell arrays are governed by column width only; row count is not a governed fact
- [`0017`](docs/adr/0017-definition-identity-is-correctable.md) — definition identity is correctable and `parameter_specs.id` is a surrogate
- [`0018`](docs/adr/0018-uploaded-file-versions-are-staged-before-activation.md) — uploaded file versions are staged before activation
- [`0019`](docs/adr/0019-debug-values-never-mutate-the-parameter-library.md) — debug values never mutate the parameter library
- [`0020`](docs/adr/0020-reload-runs-execute-in-request-on-bridge-holding-process.md) — reload runs execute in-request on the bridge-holding process
- [`0021`](docs/adr/0021-reload-snapshot-satisfies-device-write-snapshot-non-negotiable.md) — reload snapshot satisfies the device-write snapshot non-negotiable
- [`0022`](docs/adr/0022-knowledge-retrieval-lives-in-postgres.md) — knowledge retrieval lives in PostgreSQL (pgvector + FTS degradation)
- [`0023`](docs/adr/0023-app-state-transitions-live-in-application-state.md) — frontend app state transitions live in application/state, not App.tsx
- [`0024`](docs/adr/0024-agent-approval-state-is-db-backed.md) — Agent approval state is DB-backed; request context flows through invocation config
