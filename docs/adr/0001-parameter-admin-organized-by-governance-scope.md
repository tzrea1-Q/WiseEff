# Parameter admin is organized by governance scope

The parameter admin surface accumulated its shape from a dozen consecutive execution plans, ending with DTS structural management split across two unrelated sub-navigations and identity mapping governance living on the everyday workbench route. We decided the admin's primary organizing axis is **governance scope**: organization-scoped governance (parameter specs, spec review, module trees and driver mappings, business categories, policy targets) and project-scoped operations (parameter files, config sets, release baselines, validation) are peer top-level areas, and project-scoped work is addressable by route rather than nested inside a modal.

## Considered Options

- **Project as the primary axis** — select a project first, then do everything in its context, with organization-level catalogs as a separate "global settings" area. Rejected because organization-scoped specs and module trees are governed independently of any single project, and burying them under a project selector misrepresents their lifecycle.
- **Job as the primary axis** — group by daily task (approvals, data onboarding, releases, catalog upkeep). Rejected because the same object is touched by several jobs, so the grouping would duplicate surfaces and obscure ownership.

## Consequences

- Scope is already the axis the schema uses: `parameter_specs` is unique on organization/kind/key, `parameter_policy_targets` and `business_categories` are organization-level, while `project_parameter_files`, `dts_config_set`, `dts_release_baseline*`, and `project_parameter_bindings` are project-scoped. Designing against this axis keeps UI structure and data ownership aligned.
- Project-scoped operations become deep-linkable and survive reload, which the previous full-screen modal could not do.
- Identity mapping tasks move from the parameter workbench to the admin, resolving a standing contradiction with `docs/product-specs/prototype-functional-spec.md`.
- The boundary is explicit about what the admin does **not** own: everyday binding edits, draft trays, and binding history stay on the parameter workbench.
