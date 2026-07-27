# DTS node enablement — execution plan

> Chinese: [`docs/zh-CN/exec-plans/active/2026-07-27-dts-node-enablement.md`](../../zh-CN/exec-plans/active/2026-07-27-dts-node-enablement.md)  
> ADR: [`docs/adr/0003-node-enablement-is-not-a-parameter.md`](../../adr/0003-node-enablement-is-not-a-parameter.md)  
> Branch: `feat/dts-node-enablement`

## Goal

Make the DTS `status` property behave as what it actually is — a per-node enable/disable switch — instead of being processed by three contradictory code paths at once. Stop structural properties from blocking publish gates, then give node enablement a visible and editable first-class surface.

## Problem

`status` is not unhandled; it is handled three incompatible ways simultaneously.

| Door | Path | Effect today |
| --- | --- | --- |
| Matched | Node has `compatible` and hits one of the 35 vendor schemas that define `status` | `upsertMatchedPropertySpec` creates a spec plus binding — `status` is an ordinary parameter in the spec library |
| Unmatched | Overlay fragments such as `&direct_charge_ic { status = "ok"; };` carry no `compatible`, so driver matching fails; `isParameterSurfaceRow` returns false for structural keys, so the provisional-surface shortcut is skipped | Falls through to `reviewDrafts.push(...)` and becomes an open spec review task |
| Mock runtime | `mockParameterTopologyRepository.ts` hard-codes `spec-sc8562-status` and `binding-sc8562-status` | Mock models `status` as a parameter whose description already reads "Node enablement status" |

The second door is actively expensive. `evaluateCandidateSemanticGate` fail-closes on both `openSpecReviews > 0` and `unmatchedOccurrences > 0`, and `migration.ts` finalize throws on any open spec review task. `editService.ts` keeps a *second* structural-key list for gate exclusion that omits `status`, `#gpio-cells`, `interrupt-controller`, and `gpio-controller`, while `parameterSurface.ts` omits `phandle`, `linux,phandle`, and `device_type`. Neither list contains the other. The observable symptom is 50 open review tasks all named `status`, blocking candidate promotion and migration finalize, resolvable today only by dismissing 50 tasks one at a time.

Meanwhile no UI anywhere renders node enablement: `TopologyTree.tsx`, `DtsNodeTreeView.tsx`, and `DtsStructureBrowserPanel.tsx` contain no reference to it, even though the resolver already lifts it onto `ResolvedNode.status` and persists it in the `dts_nodes.status` column.

## Domain decisions

Recorded in [`CONTEXT.md`](../../../CONTEXT.md) and [ADR-0003](../../adr/0003-node-enablement-is-not-a-parameter.md).

- **Node enablement** is a first-class concept, never a parameter. Subject is the **logical node instance**, not the driver module: `&fm1230` and `&fm1230_1` are enabled and disabled independently. Enabled means the node's own `status` is absent, `ok`, or `okay`; anything else means disabled. This matches `of_device_is_available()`, including the "absent means enabled" default.
- **Node reachability** additionally requires every ancestor to be enabled. A node whose own `status` is `ok` under a disabled `i2c@FDF5E000` reports the blocking ancestor rather than being restated as disabled. Child nodes are never rewritten.
- **Non-standard enablement values** (`reserved`, `fail`, unknown text) count as not enabled, keep their original text, and refuse one-click toggling.
- **Three observable states, two toggle positions.** Unstated / explicitly enabled / explicitly disabled are all observable, but only enabled and disabled are directly selectable; returning to unstated is a separate low-emphasis action that writes `/delete-property/ status;`. This keeps single-file projects (the mainstream `BindingDraftWriteTarget.role === "base"` case) and legacy base+overlay config sets on one model.
- **Spelling on new writes** follows the project's own convention, measured from the current config revision (`ok` currently leads `okay` 264 to 4 across seed DTS). Ties and empty measurements fall back to `ok`. The measured result is shown in the confirmation dialog and can be overridden for that write.
- **Reuse the pipeline, not the concept.** A draft's subject generalizes from "a binding" to "an edit target" that is either a binding or a node's enablement, so enablement shares working tips, candidate revisions, toolchain validation, publish gates, and audit. A parallel pipeline would make a mixed round fail with `mixed-working-tips` (HTTP 409).
- **No new permission tier.** Reuse `canEditParameters` and the existing `SensitiveNodeRule` matching, which is already keyed by node path and `compatible`. Disabling additionally requires a reason and a confirmation step, and emits its own audit event type. Nodes needing elevation are handled by operations adding sensitive rules.
- **Xiaoze is read-only in v1.** It may explain why a node is not enabled and name the blocking ancestor; it gets no enablement write tool.

## Git & PR Workflow

| Role | Allowed |
| --- | --- |
| Implementation | Work on `feat/dts-node-enablement` from `main`; commit on the feature branch |
| Implementation | Must not push to `main`, open/merge PRs, or fast-forward local `main` |
| Parent / session owner | Review, open PR, merge, sync local `main` |

The four batches below are independently mergeable. Batch 1 ships first and alone, because it unblocks publishing and depends on nothing that follows.

## Batch 1 — Stop the bleeding

- [x] Make `src/domain/parameter-topology/parameterSurface.ts` the single source of truth for structural-key classification. `STRUCTURAL_PROPERTY_KEYS` takes the union of both existing lists: `compatible`, `reg`, `status`, `ranges`, `interrupt-controller`, `gpio-controller`, `phandle`, `linux,phandle`, `device_type`, plus the `#`-prefixed rule already in place.
- [x] Delete the inline `structuralKeys` array in `server/modules/parameter-topology/editService.ts` (~line 1372) and have `loadCandidateSemanticGateCounts` consume the shared predicate.
- [x] Short-circuit structural keys in `matchBindAndQueueReviews` **before** `matchProperty` runs, so the matched door closes together with the unmatched one and no new `status` spec or binding is ever created.
- [x] Apply the same exclusion to the `migration.ts` finalize check, which currently counts every open spec review task with no structural filter at all.
- [x] Migration: mark existing open review tasks for structural keys as `dismissed` with a machine-readable systemic reason. Keep the rows for audit continuity; do not delete.
- [x] Migration: deprecate and hide existing `status` specs and bindings rather than deleting them; their values are re-derived by the enablement model in Batch 2.
- [x] Regression test asserting the two lists cannot drift again — a single exported constant with a test that the gate query and the surface predicate consume the same source.

## Batch 2 — Make enablement visible

- [x] Add the enablement derivation to `src/domain/parameter-topology/`: self-enablement from the node's own `status`, reachability from the ancestor chain, and classification of non-standard values. Vocabulary is hard-coded here; it comes from the Devicetree specification, not from vendor YAML.
- [x] Surface enablement and reachability through the topology port and API response so mock and API modes serve the same semantic model (ADR-0002).
- [x] `TopologyTree.tsx` / `DtsTopologyNavigator.tsx`: enabled/disabled badge per node row, plus an "unreachable" marker naming the blocking ancestor with navigation to it.
- [x] `DtsParameterWorkbenchTable.tsx`: row-level notice that the owning node is disabled and the parameter therefore has no effect, with a link to the node.
- [x] Mock parity: remove `spec-sc8562-status` and `binding-sc8562-status` from `mockParameterTopologyRepository.ts` and express enablement as a field on the mock topology nodes.

## Batch 3 — Make enablement editable

- [x] Generalize the draft subject in `server/modules/parameter-topology/editService.ts` from `bindingId` to an edit target discriminated union (`binding` | `node-enablement`), keeping working-tip coordination, candidate revision creation, toolchain validation, and gate evaluation shared.
- [x] Writeback through the existing `ensureOverlayProperty` mechanics: `set` for enable/disable, `delete` for returning to unstated. Preserve existing spelling on an existing property; use the measured project convention for new ones.
- [x] Toggle UI in the node detail surface: two positions plus a low-emphasis "return to unstated" action, disabled-path reason field, and confirmation step.
- [x] Non-standard values render read-only with the reason shown, behind a secondary "change anyway" entry point that displays the original text, requires a reason, and states that the original intent will be overwritten.
- [x] Authorization via `canEditParameters` plus existing `SensitiveNodeRule` evaluation; distinct audit event type for enablement changes carrying previous value, new value, and reason.

## Batch 4 — Close out

- [ ] Stop generating `status` in `scripts/lib/vendorDtSchemaGenerator.ts` (line ~54) and regenerate the 35 affected files under `schemas/dts/vendor/wiseeff/`; retire `common-status.yaml` or reduce it to documentation that no longer feeds matching.
- [ ] Verify `PARAM-CONFIG-PUBLISH-GATE-001` still passes — its fixture depends on `status=okay` and must not silently start relying on a spec that no longer exists.
- [ ] Documentation updates per the matrix below, plus `npm run docs:check`.

## UI Interaction Automation

New requirement IDs to add to `docs/developer/browser-acceptance-coverage-map.md` and operation IDs to `docs/developer/user-operation-coverage-matrix.md`, all in `e2e/acceptance/parameter-topology.acceptance.spec.ts`:

| ID | Batch | Behavior |
| --- | --- | --- |
| `PARAM-ENABLE-GATE-001` | 1 | Structural properties produce no spec review task and do not block candidate promotion or migration finalize; pre-existing structural tasks are dismissed with a systemic reason |
| `PARAM-ENABLE-VISIBLE-001` | 2 | Topology tree shows enabled/disabled state and names the blocking ancestor for an unreachable node; the workbench row for a parameter under a disabled node shows the no-effect notice |
| `PARAM-ENABLE-TOGGLE-001` | 3 | Disabling a node requires a reason and confirmation, submits in the same round as a parameter edit without `mixed-working-tips`, writes the project's spelling convention, and records a distinct audit event |
| `PARAM-ENABLE-GUARD-001` | 3 | A node with `status = "reserved"` renders read-only; the secondary entry point requires an explicit acknowledgement before writing |

Existing IDs to re-verify: `PARAM-SPEC-GOVERN-001` (queue contents change), `PARAM-CONFIG-PUBLISH-GATE-001` (fixture depends on `status=okay`), `PARAM-TOPOLOGY-BROWSE-001` (tree rows gain badges).

## Documentation Impact Matrix

| Area | Action | Paths |
| --- | --- | --- |
| Domain glossary | Update | `CONTEXT.md` (done: node enablement, node reachability, enablement override, non-standard enablement value) |
| ADR | Update | `docs/adr/0003-node-enablement-is-not-a-parameter.md` (done), `CONTEXT.md` ADR index |
| Planning | Update | `docs/PLANS.md`, `docs/zh-CN/PLANS.md`, this plan + zh companion |
| Domain model | Update | `docs/design-docs/domain-model.md`, `docs/zh-CN/design-docs/domain-model.md` |
| Parameter surface RFC | Update | `docs/design-docs/2026-07-21-dts-parameter-surface-boundary-rfc.md` §3.3 and zh companion — structural exclusion must now say "excluded from the parameter surface *and* routed to node enablement", not merely excluded |
| DTS assessment | Review | `docs/design-docs/2026-07-14-dts-parameter-management-assessment.md` §4.1 already records the missing node-level enable/disable capability; mark it addressed |
| Schema management design | Update | `docs/design-docs/2026-07-16-parameter-topology-schema-management-design.md` — `status` no longer participates in matching |
| Frontend | Update | `docs/FRONTEND.md`, `docs/zh-CN/frontend.md` — topology tree badges, workbench no-effect notice |
| Security / governance | Update | `docs/SECURITY.md` — enablement audit event type and sensitive-node reuse |
| API contract | Update | `docs/design-docs/api-contract.md`, `docs/zh-CN/design-docs/api-contract.md` — enablement fields on the topology response, enablement edit target on draft creation |
| Acceptance coverage | Update | `docs/developer/browser-acceptance-coverage-map.md`, `docs/developer/user-operation-coverage-matrix.md` |
| Generated schemas | Update | `schemas/dts/vendor/wiseeff/*.yaml` (35 files regenerated), `scripts/lib/vendorDtSchemaGenerator.ts` |
| Testing strategy | Review | `docs/design-docs/testing-strategy.md` — no strategy change expected |
| Runbooks | Review | `docs/runbooks/parameter-identity-cutover.md` — migration dismisses structural review tasks during finalize |
| Product specs | Review | `docs/product-specs/prototype-functional-spec.md` — enablement is new visible behavior |
| Reliability | No change | — |
| Architecture / AGENTS | No change | — |

## Documentation Update Gate

Blocking. This plan cannot move to `completed/` until every Update and Review row is either done or explicitly recorded as unchanged with evidence, and until the new requirement and operation IDs exist. Run `npm run docs:check`. Any deferred item goes to `docs/exec-plans/tech-debt-tracker.md`.

## Verification

```bash
# Batch 1
npm run test:server -- --run \
  server/modules/parameter-topology/ingestService.test.ts \
  server/modules/parameter-topology/editService.test.ts \
  server/modules/parameter-topology/candidateRevisionStateMachine.test.ts
npm test -- --run src/domain/parameter-topology

# Batches 2-3
npm test -- --run src/components/parameter-topology
npm run test:server -- --run server/modules/parameter-topology

# All batches
npm run test:all
npm run build
npm run docs:check
npm run acceptance:browser
```

Manual check after Batch 1 against a locally seeded database: the spec review queue at `/parameter-admin` shows zero `status` tasks, and candidate promotion succeeds without dismissing anything by hand.

Frontend verification for Batches 2 and 3 requires `playwright-cli` against `npm run dev` at 1440x900, 768x1024, and 390x844, covering the topology tree, node detail toggle, workbench no-effect notice, and the non-standard-value read-only path, with `console error` clean and screenshots under `work/ui-checks/`.
