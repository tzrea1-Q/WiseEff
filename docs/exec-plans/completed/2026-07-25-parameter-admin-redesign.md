# Parameter admin redesign — execution plan

> Chinese: [`docs/zh-CN/exec-plans/completed/2026-07-25-parameter-admin-redesign.md`](../../zh-CN/exec-plans/completed/2026-07-25-parameter-admin-redesign.md)
> ADRs: [`0001`](../../adr/0001-parameter-admin-organized-by-governance-scope.md), [`0002`](../../adr/0002-mock-runtime-serves-the-semantic-parameter-model.md)
> Branch: `feat/refactor-parameter-admin`

## Problem Statement

Admins cannot form a reliable mental model of the parameter admin surface. Governance work that belongs together is split across unrelated places, and work that belongs elsewhere has leaked in.

- The same route shows two different products depending on runtime mode. In mock mode it is a flat parameter library that the identity cutover already retired; in API mode it is spec governance, review queues, and driver mappings. Shared dialogs branch internally on mode, so the same button means different things.
- DTS management is cut in half. Spec and vendor-schema governance sits in the parameter library area, while file upload/versioning, config sets, release baselines, the dtc gate, and structure browsing are buried in a full-screen modal on the project area. The modal cannot be deep-linked and loses its state on reload.
- Identity mapping governance lives on the everyday parameter workbench, contradicting the documented product boundary that the admin governs identity mapping tasks.
- The project area is not a first-class navigation destination; it is reachable only through a sub-navigation tab.
- Navigation copy still describes a battery/charging parameter database and bulk import, which is not what the surface does now.

None of this is careless code — there are no TODO or FIXME markers anywhere in these paths. It is the residue of a dozen consecutive plans that each landed correctly without retiring the layer beneath.

## Solution

Rebuild the parameter admin as one product with one organizing axis, and let the old surface retire in a single deliberate step.

Governance scope becomes the primary axis (ADR-0001). Organization-scoped governance and project-scoped operations are peer top-level areas. Project-scoped operations get real routes, so an Admin can link a colleague straight to a project's config sets and reload without losing place.

Runtime mode stops changing the product (ADR-0002). Mock mode serves the same semantic model through the same ports, so there is one component tree, one set of concepts, and one set of tests.

Identity mapping tasks move into the admin. Everyday binding work stays on the workbench.

## User Stories

1. As an Admin, I want one consistent parameter admin regardless of runtime mode, so that what I learn in a demo still applies to real work.
2. As an Admin, I want organization-scoped governance and project-scoped operations as peer areas, so that I can tell from the navigation which scope I am acting in.
3. As an Admin, I want to reach a project's parameter files by URL, so that I can share a link instead of describing a click path.
4. As an Admin, I want a project's config sets and baselines to survive a page reload, so that a long release review is not lost.
5. As an Admin, I want the parameter spec library and spec review queue in one place, so that I can move from a questionable spec to its review task without re-orienting.
6. As an Admin, I want to resolve identity mapping tasks in the admin, so that migration governance is not mixed into the everyday workbench.
7. As an Admin, I want unmapped drivers surfaced as a queue, so that I can see what governance work is outstanding without hunting.
8. As an Admin, I want to browse a project's source DTS tree from the admin, so that I can audit what was ingested.
9. As an Admin, I want to adjudicate file-versus-draft conflicts from the admin, so that conflicting edits have one owner.
10. As an Admin, I want to run revision validation and see the dtc gate result, so that I can decide whether a baseline is releasable.
11. As an Admin, I want the bulk import wizard reachable from the organization area, so that data onboarding sits with catalog governance.
12. As an Admin, I want navigation labels and subtitles that describe what each area does, so that I do not rely on memory.
13. As an Admin, I want cross-panel context (current project, current config revision, pending queue counts) to persist while I move between panels, so that I do not re-select the same project repeatedly.
14. As an Admin, I want destructive actions to stay undoable, so that a mistaken deletion is recoverable.
15. As an Admin, I want every governance action to produce an audit record, so that decisions remain reviewable.
16. As an Admin, I want role-gated access unchanged, so that the redesign does not widen who can govern parameters.
17. As a Hardware or Software User, I want the parameter workbench to keep working exactly as before, so that my daily work is unaffected by an admin redesign.
18. As a Hardware or Software User, I want binding drafts, history, and comparison to stay on the workbench, so that I do not have to enter an admin surface to do my job.
19. As a developer, I want the admin to read its data only through ports, so that I can add a capability without touching global application state.
20. As a developer, I want admin state in one admin-owned unit, so that I do not have to trace scattered component state to understand a flow.
21. As a developer, I want one mock adapter per port, so that a new panel does not require writing a mock code path and an API code path.
22. As a developer, I want tests that assert user-visible behavior at the port seam, so that restructuring internals does not break the test suite.
23. As a developer, I want the old admin and its admin-exclusive reducer actions deleted in one final step, so that no half-migrated state survives this plan.
24. As a developer, I want the navigation and route registry to name the project area as a first-class destination, so that it is discoverable.
25. As an operator, I want existing browser acceptance coverage to keep passing against the new routes, so that the redesign does not silently drop verified behavior.

## Implementation Decisions

**Scope of change.** Frontend product redesign, information-architecture rework, and implementation rewrite of the parameter admin. Backend semantics are not changed.

**Organizing axis.** Governance scope, per ADR-0001. Organization-scoped governance covers the parameter spec library, spec review queue, module trees and driver mappings, and bulk import. Project-scoped operations cover parameter files and versions, config sets, release baselines, revision validation and the dtc gate, source structure browsing, and file-versus-draft conflict adjudication. Project-scoped operations are addressed by route, not by modal.

**Runtime mode.** Per ADR-0002, a mock adapter is added for the parameter topology port and the mode guard is removed from the topology runtime seam. The admin renders one component tree in both modes. Mock fixtures must express the semantic model — specs, spec versions, bindings, topology trees, review tasks, mapping tasks, validation runs — not the retired flat library.

**Capability ownership.** Identity mapping task governance moves from the workbench to the admin. Source structure browsing, file-versus-draft conflict adjudication, and revision validation stay in the admin. Organization policy targets and business categories belong to the admin by ownership, but this plan only reserves their place in the information architecture and builds no panel for them. The TD-043 optional L2 toolchain panel is likewise out of scope.

**Backend.** No route, contract, or schema changes. The frontend gains one admin application layer that fronts the existing v1 admin/module/file/import clients and the v2 spec/topology/module-mapping clients, so no panel holds more than one client. A new aggregate read endpoint is added only if a required view cannot be composed from existing endpoints without an N+1 fetch pattern; if one is added, `server/modules/contracts/routeManifest.ts` and the contract tests are updated in the same change.

**State ownership.** The admin owns a dedicated reducer plus context for cross-panel concerns: selected project, selected config revision, queue counts, undo stack, and audit hints. Panel-local detail stays in the panel. The admin does not read global application state. URL remains the source of truth for filters, sort, selection, and the active area.

**Retirement.** The new component tree is built in parallel with the old surface. There is no runtime feature flag, because there is no deployed environment or production user to protect. The final task deletes the old admin pages, the admin-exclusive reducer actions, and the legacy helpers that only those pages used. `configDraft.parameterLibrary` is retained as shared mock seed data for the project initialization wizard, power-management config, mock parameter repository, and project value matrix.

**Legacy constraints.** The new admin must not add any new dependency on transitional flat module text columns (TD-038) or on `(name, module)` path-derived identity fallback (TD-039). This plan does not clean either up.

**Visual language.** Existing design tokens and component styles are reused. This is a structural redesign, not a visual refresh.

**Navigation copy.** Navigation labels, titles, subtitles, and the Xiaoze context summaries for the admin areas are rewritten to describe the scope-based areas. The project area becomes a first-class navigation entry rather than a derived path special case.

## Testing Decisions

**What makes a good test here.** A test mounts the real admin route tree with mock adapters injected at the port boundary, drives it the way an Admin would, and asserts only what an Admin can see or verify: rendered rows, queue states, resolved outcomes, error and loading states, audit records, URL state. Tests do not assert on reducer action shapes, internal component state, or panel composition.

**Single seam.** The port boundary is the only test seam, exercised through route-level rendering. Existing ports (`ParameterTopologyRepository`, `ParameterFileRepository`, `DtsStructuredRepository`, `ParameterModuleRegistryRepository`) are preferred over new ones; no new seam is introduced.

**Prior art.** `src/ParameterAdminPage.test.tsx`, `src/ParameterAdminProjectsPage.test.tsx`, and `src/components/parameter-topology/ApiProjectTopologyWorkspace.test.tsx` already render pages against injected repositories; the new tests follow that shape. `src/ParameterAdminPage.a11y.test.tsx` is the pattern for the accessibility gate.

**Retiring reducer tests.** `src/appReducer.parameterAdmin.test.ts` asserts directly on reducer transitions, which is implementation-detail testing under this seam. It is not ported; the behaviors it covers are re-expressed as route-level tests.

**Mock adapter tests.** The new mock topology adapter gets its own tests, following `src/infrastructure/mock/mockDtsStructuredRepository.test.ts` and `mockParameterFileRepository.test.ts`.

**Browser acceptance.** Existing acceptance specs must pass against the new routes. Route changes affect `PARAM-ADMIN-001`, `PARAM-ADMIN-002`, `PARAM-IMPORT-DTS-FULL-001`, `PARAM-IMPORT-REVIEW-META-001`, `MOD-TREE-PARAM-001`, `MOD-TREE-PARAM-002`, `MOD-TREE-AUTHZ-001`, `PARAM-FILE-UPLOAD-001`, `PARAM-DTS-CONFIGSET-001`, `PARAM-SPEC-GOVERN-001`, and `PARAM-FILE-ADMIN-001`. Identity mapping moving into the admin has no operation ID today, so this plan adds one to `docs/developer/user-operation-coverage-matrix.md` and a matching requirement ID to `docs/developer/browser-acceptance-coverage-map.md` before implementation.

**Browser verification.** Every affected route is checked with `playwright-cli` at 1440x900, 768x1024, and 390x844, with snapshot, screenshot, and console error checks, per `AGENTS.md`.

## Out of Scope

- Rewriting the `/parameters` parameter workbench implementation. Its ownership boundary is in scope; its internals are not. It was redesigned three times between 2026-07-19 and 2026-07-21 and is not the mess this plan addresses.
- Backend route, contract, or schema redesign, including any v1/v2 consolidation.
- TD-042. This plan neither resolves it nor permits any claim that the new admin is production cutover ready.
- TD-038 transitional flat module columns and TD-039 residual path-derived identity fallback cleanup.
- New panels for organization policy targets and business categories.
- The TD-043 optional Admin L2 toolchain validation panel.
- Visual restyling or design-token changes.
- Role and permission model changes.

## Git & PR Workflow

| Role | Allowed |
| --- | --- |
| Implementation | Work on `feat/refactor-parameter-admin` from `main`; commit on the feature branch |
| Implementation | Must not push to `main`, open/merge PRs, or fast-forward local `main` |
| Parent / session owner | Review, open PR, merge, sync local `main` |

## Tasks

Tickets live on GitHub under parent issue [#188](https://github.com/tzrea1-Q/WiseEff/issues/188), with native blocking dependencies. Each ticket is a tracer bullet that must land a working state; the build stays green between tickets because the new admin is constructed on a temporary route and takes the canonical route only in ticket 09.

- [x] [#189](https://github.com/tzrea1-Q/WiseEff/issues/189) — 01 Prefactor: semantic parameter model available in mock runtime mode. No blockers
- [x] [#190](https://github.com/tzrea1-Q/WiseEff/issues/190) — 02 New admin shell and organization-scoped spec governance. Blocked by 01
- [x] [#191](https://github.com/tzrea1-Q/WiseEff/issues/191) — 03 Organization-scoped module tree and driver mapping. Blocked by 02
- [x] [#192](https://github.com/tzrea1-Q/WiseEff/issues/192) — 04 Organization-scoped bulk parameter import. Blocked by 02
- [x] [#193](https://github.com/tzrea1-Q/WiseEff/issues/193) — 05 Project-scoped routes: project list and parameter files. Blocked by 02
- [x] [#194](https://github.com/tzrea1-Q/WiseEff/issues/194) — 06 Project-scoped config sets, release baselines, and revision validation. Blocked by 05
- [x] [#195](https://github.com/tzrea1-Q/WiseEff/issues/195) — 07 Project-scoped source structure browsing and conflict adjudication. Blocked by 05
- [x] [#196](https://github.com/tzrea1-Q/WiseEff/issues/196) — 08 Identity mapping task governance in the admin. Blocked by 02
- [x] [#197](https://github.com/tzrea1-Q/WiseEff/issues/197) — 09 Contract: new admin takes over the canonical admin route and navigation. Blocked by 02–08
- [x] [#198](https://github.com/tzrea1-Q/WiseEff/issues/198) — 10 Contract: retarget browser acceptance coverage and verify across viewports. Blocked by 09
- [x] [#199](https://github.com/tzrea1-Q/WiseEff/issues/199) — 11 Contract: delete the old admin surface and its exclusive state. Blocked by 10

## Documentation Impact Matrix

| Area | Action | Paths | Status (#199) |
| --- | --- | --- | --- |
| Repository map | Review | `AGENTS.md`, `ARCHITECTURE.md` | unchanged: evidence — axis-aligned admin map already in `ARCHITECTURE.md` § parameter-topology; no edit required |
| Planning | Update | `docs/PLANS.md`, `docs/zh-CN/PLANS.md`, this plan + Chinese companion | updated — plan moved to `completed/`; PLANS index pointers updated |
| Domain context | Update | `CONTEXT.md`, ADR-0001, ADR-0002 | updated `CONTEXT.md` identity-mapping glossary; ADRs unchanged (already state admin/workbench boundary) |
| Product specs | Update | `docs/product-specs/prototype-functional-spec.md` | updated — workbench shows blockers only; admin resolves identity mapping |
| Architecture / design | Update | `docs/design-docs/full-stack-architecture.md`, `docs/design-docs/domain-model.md` | updated — admin/workbench boundary in both files |
| Frontend | Update | `docs/FRONTEND.md`, `docs/zh-CN/frontend.md` | updated — removed workbench mapping-review UI copy; admin ownership retained |
| Quality / testing | Update | coverage matrix, acceptance map, testing strategy | unchanged: evidence — `PARAM-IDENTITY-MAP-ADMIN-001` landed in #198; no new ops in #199 |
| Verification | Review | `docs/developer/verification-matrix.md` | unchanged: evidence — gate list still matches `npm test` / `npm run build` / `docs:check` |
| Technical debt | Update | tech-debt trackers | unchanged: evidence — TD-042 still open; no new deferred items from retirement |
| API contract | Review | `docs/design-docs/api-contract.md`, `docs/api/README.md` | unchanged: evidence — no backend contract changes in #199 |
| Security / governance | Review | `docs/SECURITY.md` | unchanged: evidence — identity mapping audit still via admin governance events |
| Reliability / runbooks | Review | `docs/runbooks/parameter-identity-cutover.md` | unchanged: evidence — cutover procedure unchanged |
| Generated schema | No change | — | n/a |
| References | Review | `docs/references/productization-api-contract-draft.md` | unchanged: evidence — no API draft delta |

## Documentation Update Gate

Blocking. This plan cannot move to `completed/` until every `Update` and `Review` row is either updated or explicitly recorded as unchanged with evidence. Deferred work goes to `docs/exec-plans/tech-debt-tracker.md`. Run `npm run docs:check` before marking complete.

## Verification

```bash
npm test -- --run src/infrastructure/mock src/ParameterAdmin
npm run build
npm run docs:check
npm run acceptance:browser
```

Browser verification with `playwright-cli` at 1440x900, 768x1024, and 390x844 for every affected route, including snapshot, screenshot, console error, and network checks.

## Further Notes

There are no TODO, FIXME, or HACK markers in the parameter-admin or DTS frontend paths. Every layer was built deliberately; the problem is that no layer was retired. Reviewers should expect judgement calls rather than obvious deletions, and the retirement task is where that judgement is spent.

`configDraft.parameterLibrary` looks like admin state but is not. It is read by the project initialization wizard, power-management config, the mock parameter repository, and the project value matrix. Deleting it would break surfaces this plan does not touch.
