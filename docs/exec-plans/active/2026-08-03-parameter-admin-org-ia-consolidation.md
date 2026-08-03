# Parameter admin organization IA consolidation

> Status: **Active** — implementation in progress on `feat/parameter-admin-org-ia`
> Date: 2026-08-03
> Chinese: [`docs/zh-CN/exec-plans/active/2026-08-03-parameter-admin-org-ia-consolidation.md`](../../zh-CN/exec-plans/active/2026-08-03-parameter-admin-org-ia-consolidation.md)
> Decision: [ADR-0015](../../adr/0015-governance-queues-live-with-the-object-they-govern.md)
> Governing IA: [ADR-0001](../../adr/0001-parameter-admin-organized-by-governance-scope.md) (unchanged)
> Predecessor: [`2026-08-02-parameter-admin-ux-polish.md`](./2026-08-02-parameter-admin-ux-polish.md) (PR #221)

## Context

The organization area of `/parameter-admin` exposes four peer sub-navigation entries: 参数定义库, 定义匹配审核, 模块归属, 节点对应确认. Two name governance objects and two name work queues over objects that already have a page, so the four do not read as peers.

The split is also visible in the code. `OrganizationSpecGovernancePanel` renders both the definition library and the spec review queue and is divided into two routes purely by a `focus` prop:

```ts
const showLibrary = focus !== "review";
const showReview = focus !== "library";
```

`ParameterSpecLibrary` already accepts a `reviewQueueSlot`, so the merged form is the component's native shape and the split is the special case. Meanwhile `/parameter-admin/modules` already demonstrates the nested pattern the rest of the area lacks: the attribution tree is the page, `/modules/queue` is the unclassified-driver queue beneath it, and the nested sub-navigation hides when discovery is empty.

ADR-0015 records the decision. This plan sequences it.

## Goal

The organization area has exactly two entries:

| Entry | Route | Contains |
| --- | --- | --- |
| 参数定义管理 | `/parameter-admin/specs` | Definition library with the spec review queue rendered inside it; identity mapping nested beneath |
| 模块管理 | `/parameter-admin/modules` | Attribution tree with the unclassified-driver queue nested beneath (unchanged) |

Identity mapping becomes `/parameter-admin/specs/identity-mapping`. Its **navigation entry** appears only while open tasks exist; its **route** stays reachable unconditionally so resolved/dismissed history does not become unreachable when the queue empties.

## Non-goals

- Reopening ADR-0001. Organization and project remain peer scopes; only the organization side subdivides differently.
- Changing any identity mapping, spec review, or spec lifecycle **decision semantics**. This is navigation and composition only — no API, authz, or audit behavior changes.
- Merging the project-scoped tabs under 项目运营.
- Parameter-governance deferred D1–D8 and attribution deferred D-AG-*.
- Retiring identity mapping itself. TD-051 and the migration-era lifecycle of the queue stay where they are.

## Git & PR Workflow

| Role | Allowed |
| --- | --- |
| Implementation agent | Commit on `feat/parameter-admin-org-ia`; do not open or merge GitHub PRs |
| Parent agent | Review, run verification, open/merge the PR, then sync local `main` |

Branch: `feat/parameter-admin-org-ia`, cut from `main` after #221 merges. One branch for the whole plan — splitting route changes from navigation changes would ship a broken intermediate state.

## Route map

| Old | New | Mechanism |
| --- | --- | --- |
| `/parameter-admin` | `/parameter-admin/specs` | Existing entry redirect, unchanged |
| `/parameter-admin/specs` | `/parameter-admin/specs` | Now also renders the review queue |
| `/parameter-admin/spec-review` | `/parameter-admin/specs` | Redirect, preserving query string |
| `/parameter-admin/identity-mapping` | `/parameter-admin/specs/identity-mapping` | Redirect, preserving query string |
| `/parameter-admin/modules`, `/modules/queue` | unchanged | — |

Both redirects are permanent obligations, not a deprecation window: acceptance operation IDs, the coverage matrices, and `e2e/quality/responsive.quality.spec.ts` reference the old paths, and the existing `/modules/registry` legacy branch in `parseParameterAdminModulesSubView` is the precedent for how to carry them.

## Risks this plan must close

| ID | Risk | Required handling |
| --- | --- | --- |
| IA-R1 | **Identity mapping count is only loaded by the identity mapping panel.** `OrganizationIdentityMappingPanel` is what dispatches `SET_QUEUE_COUNTS { identityMapping }`. Once that panel is no longer mounted by default, the count stays `0` and the conditional entry never appears — the queue becomes invisible. | The definition management page must load the open-task count itself on mount, independently of the panel. |
| IA-R2 | **A failed count load must not read as "no tasks."** Conditional rendering keyed on `count > 0` treats a network failure as an empty queue. | Distinguish loading / error / empty. Render the entry with an error state when the count cannot be loaded. |
| IA-R3 | **Removing two top-level entries removes two pending-count surfaces.** | Put `queueCounts.specReview` and `queueCounts.identityMapping` badges on the surviving sub-navigation. |
| IA-R4 | **History becomes unreachable if the entry is hidden when open tasks reach zero.** `IDMAP-HISTORY-001` and `IDMAP-REOPEN-001` operate on non-open outcomes. | Route stays reachable when the nav entry is hidden; the definition management page keeps a discoverable path to mapping history (for example an entry that appears when history exists, not only when open tasks exist). |
| IA-R5 | **Embedding a long review queue below the library makes the page unbounded.** | Keep the embedded queue collapsed-by-default or paged, and verify page length at 390×844 with a non-empty queue. |

## Delivery batches

### Batch 1 — routes and redirects

1. [x] Narrow `ParameterAdminOrganizationView` to `"specs" | "modules"`; add a `ParameterAdminSpecsSubView` (`"library" | "identity-mapping"`) mirroring `ParameterAdminModulesSubView`.
2. [x] Parse `/parameter-admin/specs/identity-mapping`; keep `/parameter-admin/specs` as the default sub-view.
3. [x] Redirect `/parameter-admin/spec-review` and `/parameter-admin/identity-mapping`, preserving query strings, alongside the existing `audit=open` and entry-path redirects in `ParameterAdminNextPage`.
4. [x] Update `parameterAdminOrganizationPath.test.ts` for the new views, the nested sub-view, and both redirects.

### Batch 2 — composition

5. [x] Drop the `focus` prop from `OrganizationSpecGovernancePanel`; always render the library with `reviewQueueSlot`. Address IA-R5 while doing so.
6. [x] Mount `OrganizationIdentityMappingPanel` on the nested route instead of a top-level view.
7. [x] Load the open identity-mapping count from the definition management page on mount (IA-R1) with explicit loading/error/empty states (IA-R2).
8. [x] Render the nested specs sub-navigation only when there are open tasks or existing history (IA-R4), following the `modules` precedent for hiding.

### Batch 3 — navigation, copy, counts

9. [x] Reduce `ParameterAdminOrganizationSubNav` to two entries and add pending-count badges (IA-R3).
10. [x] Rename copy in `parameterAdminUiCopy.ts`: `specLibrary` → 参数定义管理, `moduleMapping` → 模块管理. Audit every other use of these keys — `moduleMappingManage` and the in-page headings must stay accurate rather than inherit the nav label.
11. [x] Update the TopBar subtitle at `src/appConfig.ts:99`, which still enumerates the four old sub-routes.
12. [x] Re-check that in-page headings do not restate the nav label (the PA-A1 duplication finding from the predecessor plan).

### Batch 4 — tests, acceptance, docs

13. [x] Update `ParameterAdminNextPage.test.tsx` (11 route references), `ParameterAdminNextPage.a11y.test.tsx`, and `App.test.tsx`.
14. [x] Update `e2e/quality/responsive.quality.spec.ts` (2 paths) and `e2e/acceptance/operationMatrix.ts` (3 route fields).
15. [x] Add `PARAM-ADMIN-IA-001` and cover it (see UI interaction coverage below).
16. [x] Work the Documentation Impact Matrix.
17. [x] playwright-cli evidence at 1440×900 / 768×1024 / 390×844 with 0 console errors, including a non-empty review queue and both redirect paths.

## Key seams (starting points)

- Route parsing and builders: `src/application/parameters/parameterAdminOrganizationPath.ts`.
- Redirects and panel mounting: `src/ParameterAdminNextPage.tsx:124-205`.
- Library/review composition: `src/components/parameter-admin-next/OrganizationSpecGovernancePanel.tsx:518-608`; slot at `src/components/parameter-topology/ParameterSpecLibrary.tsx:284,665`.
- Identity mapping panel and its count dispatch: `src/components/parameter-admin-next/OrganizationIdentityMappingPanel.tsx:21-40`.
- Nested-queue precedent: `src/components/parameter-topology/ParameterModuleMappingPanel.tsx:628-640`.
- Sub-navigation: `src/components/parameter-admin-next/ParameterAdminOrganizationSubNav.tsx`.
- Copy: `src/application/parameters/parameterAdminUiCopy.ts:12,28,52,148`.
- Queue counts: `src/application/parameters/parameterAdminState.ts:42-92`.

## Documentation Impact Matrix

| Area | Action | Paths |
| --- | --- | --- |
| Repository maps | Review | `AGENTS.md`, `ARCHITECTURE.md` — confirm neither enumerates the organization sub-routes |
| Planning | Update | this plan; `docs/PLANS.md`; `docs/zh-CN/PLANS.md`; ZH companion plan |
| Architecture / ADR | Update | new `docs/adr/0015-governance-queues-live-with-the-object-they-govern.md`; `docs/adr/README.md`; `CONTEXT.md` ADR list |
| Domain glossary | Review | `CONTEXT.md` 「Identity mapping task」 says Admins decide in `/parameter-admin` — still true, but verify the wording does not imply a top-level route |
| Product specs | Update | `docs/product-specs/prototype-functional-spec.md:23` describes `/parameter-admin` governing "specs, spec review, and identity mapping tasks" as peers |
| Frontend / design | Update | `docs/FRONTEND.md` and `docs/zh-CN/frontend.md` (3 route references each) |
| Quality / testing | Update | `docs/developer/browser-acceptance-coverage-map.md` (+ ZH) for `PARAM-ADMIN-IA-001`; `docs/developer/user-operation-coverage-matrix.md` (+ ZH) for the 3 `IDMAP-*` route fields |
| Security / governance | No change | expected — no authz or audit change |
| Reliability / runbooks | Review | `docs/runbooks/parameter-identity-cutover.md` if it links the identity mapping route |
| Generated artifacts | Review | `docs/generated/acceptance-operation-evidence.md` regenerates from acceptance runs; confirm no manual edit needed |
| References | Review | `docs/references/*` for quoted admin routes or copy |

## Documentation Update Gate

Before moving this plan to `completed/`:

1. Every Impact Matrix `Update` / `Review` row is updated or recorded unchanged with evidence.
2. All four batches are delivered, or the remainder is filed in `exec-plans/tech-debt-tracker.md`.
3. All five IA-R risks are closed with evidence, not just implemented.
4. `PARAM-ADMIN-IA-001` is registered and covered, and the three `IDMAP-*` operation rows carry their new routes.
5. `npm run docs:check`, `npm run acceptance:coverage`, and `npm run acceptance:operations` are green.

## UI interaction coverage

This plan changes routes and navigation, so the UI Interaction Automation Rule applies.

Existing IDs and their exposure:

- `PARAM-IDENTITY-MAP-ADMIN-001` (blocking, `e2e/acceptance/parameter-topology.acceptance.spec.ts`) navigates to `/parameter-admin/identity-mapping` directly. It must keep passing through the redirect, which makes it the de-facto redirect regression test.
- `PARAM-SPEC-GOVERN-001` (blocking) resolves a spec review task and must be re-pointed at the merged page.
- `IDMAP-NEWID-001`, `IDMAP-HISTORY-001`, `IDMAP-REOPEN-001` (coverage `future`) carry `/parameter-admin/identity-mapping` in their route field and need the new path.
- No existing ID covers the organization sub-navigation itself.

New ID to register in `docs/developer/browser-acceptance-coverage-map.md` **before** implementation is claimed complete:

- `PARAM-ADMIN-IA-001` — organization sub-navigation offers exactly 参数定义管理 and 模块管理; the definition management page renders the review queue inline; the identity mapping entry appears while open tasks exist; both legacy routes redirect with query strings preserved.

## Verification

```bash
npm test -- src/ParameterAdminNextPage.test.tsx src/ParameterAdminNextPage.a11y.test.tsx src/App.test.tsx
npm test -- src/application/parameters/parameterAdminOrganizationPath.test.ts
npm run build
npm run docs:check
npm run acceptance:coverage
npm run acceptance:operations
# Browser evidence under work/ui-checks/param-admin-org-ia/
```
