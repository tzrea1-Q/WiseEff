# Parameter admin is organized by governance scope

The parameter admin surface accumulated its shape from a dozen consecutive execution plans, ending with DTS structural management split across two unrelated sub-navigations and identity mapping governance living on the everyday workbench route. We decided the admin's primary organizing axis is **governance scope**: organization-scoped governance (parameter specs, spec review, module trees and driver mappings, business categories, policy targets) and project-scoped operations (parameter files, config sets, release baselines, validation) are peer top-level areas. Project-scoped work is **addressable by route**; its presentation may be a deep-linked dialog over the project list so the inventory stays in context.

## Considered Options

- **Project as the primary axis** — select a project first, then do everything in its context, with organization-level catalogs as a separate "global settings" area. Rejected because organization-scoped specs and module trees are governed independently of any single project, and burying them under a project selector misrepresents their lifecycle.
- **Job as the primary axis** — group by daily task (approvals, data onboarding, releases, catalog upkeep). Rejected because the same object is touched by several jobs, so the grouping would duplicate surfaces and obscure ownership.

## Consequences

- Scope is already the axis the schema uses: `parameter_specs` is unique on organization/kind/key, `parameter_policy_targets` and `business_categories` are organization-level, while `project_parameter_files`, `dts_config_set`, `dts_release_baseline*`, and `project_parameter_bindings` are project-scoped. Designing against this axis keeps UI structure and data ownership aligned.
- Project-scoped operations become deep-linkable and survive reload. The project list can stay behind a deep-linked dialog so operators keep inventory context while working a single project.
- Identity mapping tasks move from the parameter workbench to the admin, resolving a standing contradiction with `docs/product-specs/prototype-functional-spec.md`.
- The boundary is explicit about what the admin does **not** own: everyday binding edits, draft trays, and binding history stay on the parameter workbench.

## Round trip through a modal (2026-08-05)

PR #224 (`3b18433e`) moved the four project-scoped views into a `ProjectOperationsDialog` modal while keeping the URL. That preserved deep links but contradicted an earlier reading of this ADR that treated "route-addressable" as "full-page only". Fitting a file manager, a baseline console, a two-pane structure browser and a conflict queue into an underspecified `min(980px, 100vw-48px)` box produced a shared navigation strip that jumped between views, a node tree locked to a nested scroller, and rows clipped at 390px width.

`docs/exec-plans/completed/2026-08-05-project-operations-dialog-hardening.md` (POD-D1) temporarily returned the views to full-page routes and delivered the shared `ModalDialog` / `ConfirmDialog` contract, leave-with-drafts guarding, and irreversible-action confirmations. Product direction then restored the deep-linked dialog presentation on top of that hardening (`docs/exec-plans/completed/2026-08-05-project-operations-modal-restore.md`): routes still own `/parameter-admin/projects/:projectId/:view`, the dialog owns presentation over the list, and the card carries a fixed height with a single scroll region (full-screen sheet at ≤768px). Short forms — project create/edit, project delete, and governance confirmations — continue to use the shared modal primitives described in `docs/FRONTEND.md`.
