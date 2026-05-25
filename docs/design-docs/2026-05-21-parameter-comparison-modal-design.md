# Parameter Comparison Modal Refactor Design

## Summary

Refactor parameter comparison from a standalone page into the project parameter user workbench. Users should inspect a parameter from the table row action, see its detailed definition, compare that same parameter across projects, and optionally add it to the existing modification draft flow without leaving `/parameters`.

The old `/parameter-comparison` business page is retired. Direct access to that path should show a no-entry or 404-style state rather than loading the previous comparison workspace.

## Goals

- Move comparison analysis into the parameter workbench row-level workflow.
- Add a non-routing "View" action to each parameter table row.
- Show parameter definition and cross-project comparison in a modal.
- Compare the selected parameter across all projects while allowing one target project to be emphasized.
- Let users add the viewed parameter to the existing modification draft flow from the modal.
- Remove standalone comparison page entry points from navigation and quick actions.
- Keep the implementation aligned with existing table, draft sheet, and parameter domain patterns.

## Non-Goals

- Do not keep the old full comparison page as a hidden business experience.
- Do not preserve the old all-parameter comparison matrix inside the modal.
- Do not introduce a new approval, submission, or sync workflow.
- Do not change the shape of parameter records beyond helper-derived comparison data.
- Do not implement real backend persistence; this remains within the current prototype state model.

## Current State

The project currently has:

- `/parameters`: project parameter user workbench with search, filters, row edit action, draft sheet, and submission flow.
- `/parameter-comparison`: standalone page with project-pair comparison, filters, metrics, matrix, and export.
- Parameter comparison domain logic already separated enough to inform new helper functions.
- Topbar and homepage shortcuts that expose "comparison analysis" as a separate destination.

The refactor should preserve useful comparison ideas but remove the standalone page concept from the user-facing product model.

## Entry Points

The primary entry is the parameter table operation column on `/parameters`.

Each row should expose:

- "View": opens the parameter detail modal.
- Existing edit action: still directly adds or opens the parameter in the modification draft flow.

The topbar action currently labeled as cross-project comparison should be removed from `/parameters`.

The parameter management homepage quick navigation should no longer include "comparison analysis".

The sidebar or page configuration should not present `/parameter-comparison` as a normal destination.

Direct access to `/parameter-comparison` should render a no-entry or 404-style state. The state should make clear that the independent comparison workspace is unavailable. It should offer a path back to the parameter workbench, but it should not auto-redirect.

## User Flow

1. User opens `/parameters`.
2. User searches or filters the parameter table.
3. User clicks "View" in a parameter row.
4. Modal opens without changing the URL.
5. Left side shows the selected parameter's definition and project-local details.
6. Right side shows the same parameter across all projects.
7. User may choose a target project to emphasize in the comparison.
8. User reviews the difference summary between the current project and emphasized target project.
9. User clicks "Add to modification draft" if they want to modify the current project value.
10. Existing draft sheet opens or remains available for target value and reason editing.
11. User closes the modal and continues the normal submission flow.

## Modal Layout

Use a two-column modal layout.

Left column: parameter definition.

- Parameter name.
- Module.
- Risk level.
- Current project code and name.
- Current value.
- Recommended value.
- Range.
- Unit.
- Last updated time.
- Description.
- Explanation.
- Config format.
- Recent history, shown compactly if available.

Right column: cross-project comparison.

- All projects from the runtime project list.
- One row per project.
- Matching parameter found by parameter name.
- Current value.
- Recommended value.
- Risk.
- Last updated time.
- Coverage state: configured or missing.
- Current workbench project highlighted as base.
- Emphasized target project highlighted separately.
- A target project selector, defaulting to the first project that is not the current project.
- Difference summary between base project and emphasized target project.

Footer:

- Primary action: "Add to modification draft".
- Secondary action: "Close".
- If the parameter is already in the draft, the primary action should communicate that state and avoid duplicate draft entries.
- If editing is unavailable because of role or initialization status, disable the action and show the existing permission or initialization reason.

## Comparison Semantics

The modal compares by parameter name, not by record id. Record ids are project-scoped in the current model, while names are the shared parameter identity across projects.

For each runtime project:

- If a same-name parameter exists, display its project-specific values.
- If no same-name parameter exists, display a visible "missing" state.
- If the unit differs, display each project's unit with its value and flag the unit mismatch in the row or summary.
- If values are numeric, calculate absolute and percentage delta between base and emphasized target.
- If values are not numeric, show changed/same/missing status without numeric delta.

The current project is the base. The emphasized target is for focus only; the all-project list remains visible.

## Components

### `ParametersPage`

Owns modal state:

- `viewingParameterId`
- `comparisonTargetProjectId`

Provides callbacks to:

- Open the detail modal for a row.
- Close the modal.
- Change emphasized target project.
- Add the viewed parameter to the existing draft flow by reusing the current edit handler.

`ParametersPage` should remain the integration point because it already owns current project context, edit permissions, initialization state, table rows, draft state, and the existing `handleEditRow` behavior.

### `ParametersTable`

Adds a row view callback:

- `onViewRow?: (id: string) => void`

The operation column should render a view button for every row. The existing edit button remains controlled by edit permission. Clicks on operation buttons should not trigger row focus unless explicitly intended.

### `ParameterDetailDialog`

New component responsible for presentation and modal interactions.

Inputs:

- Selected `ParameterRecord`.
- All parameters.
- Runtime projects.
- Current project id.
- Emphasized target project id.
- Whether current user can edit.
- Disabled reason for draft action.
- Whether the parameter is already in draft.
- `onTargetProjectChange`.
- `onAddToDraft`.
- `onClose`.

The component should not mutate global state directly. It delegates actions to `ParametersPage`.

### Comparison Helper

Add a pure helper such as `buildSingleParameterProjectComparison`.

Inputs:

- `parameters`
- `projects`
- `parameterName`
- `baseProjectId`
- `targetProjectId`

Output:

- Base project row.
- Target project row.
- All project comparison rows.
- Delta summary.
- Coverage counts.
- Missing project ids.

The helper should live near existing parameter domain or feature comparison logic. It should be tested independently.

## Routing And Navigation

Remove user-facing navigation to `/parameter-comparison`.

Update route handling so page key `parameter-comparison`, if still recognized by URL mapping, renders a no-entry state rather than the old `ParameterComparisonPage`.

The no-entry state should:

- Be accessible as a normal page region.
- Explain that comparison is now available from each parameter row in the workbench.
- Include a button or link to `/parameters`.
- Avoid loading the retired comparison components.

Retired comparison page files can be deleted if no longer imported. Shared pure utilities may remain only if they are used by the new helper or tests.

## Permissions And Locked States

Viewing parameter details is read-only and should remain available to users who can access `/parameters`.

Adding to modification draft follows the same rules as the existing edit action:

- Disabled for roles without parameter edit permission.
- Disabled when project initialization is not `initialized`.
- Disabled if the current parameter cannot be found in the active project.

The modal should use the same reason text style as the existing workbench permission and initialization notes.

## Empty And Error States

If the selected parameter no longer exists, close the modal or show a compact "parameter unavailable" state.

If no runtime projects exist, show the definition column and an empty comparison state.

If the current project does not have a base parameter, show the selected parameter definition but mark the base comparison as unavailable.

If every other project is missing the parameter, keep the all-project list visible and show coverage as one configured project.

## Accessibility

The modal should use `role="dialog"` with `aria-modal="true"` and an accessible title tied to the parameter name.

The view button should have a clear accessible label such as `View <parameter name>`.

Project selector labels should describe that the selection changes the emphasized comparison target.

Disabled draft actions should expose a visible reason and not rely only on disabled button state.

Keyboard users should be able to open, close, select target project, and activate draft action without mouse-only behavior.

## Styling Direction

Follow the existing workbench style: dense, restrained, and operational.

The modal should use the selected B layout:

- Definition on the left.
- Comparison on the right.
- Compact summary at the top of the comparison column.
- Highlight current project and emphasized target with subtle badges or row accents.

Avoid recreating the old comparison page's full hero, metrics strip, filter bar, or all-parameter matrix.

## Testing

Add or update tests for:

- `/parameters` operation column includes a view action.
- Clicking view opens the modal without changing `window.location.pathname`.
- Modal shows parameter definition fields.
- Modal shows all projects, including missing states when applicable.
- Current project and emphasized target project are identifiable.
- Changing target project updates the focused comparison summary.
- "Add to modification draft" reuses the existing draft behavior.
- Read-only or initialization-locked states disable the draft action with a reason.
- Parameter management homepage no longer shows comparison quick entry.
- `/parameters` topbar no longer shows standalone comparison action.
- `/parameter-comparison` renders the no-entry state and does not render the old comparison page.
- Deleted retired page imports do not leave dead route references.

Pure helper tests should cover numeric deltas, non-numeric values, missing target parameter, missing base parameter, unit mismatch, and all-project coverage counts.

## Implementation Notes

Prefer small, focused changes:

- First add the pure comparison helper and tests.
- Then add `ParameterDetailDialog` with focused tests.
- Then wire `ParametersTable` and `ParametersPage`.
- Then remove navigation and route exposure for the standalone page.
- Finally delete retired comparison page code that is no longer imported.

The old comparison design can be used as visual reference, but the implementation should be modal-native and parameter-scoped.

## Acceptance Criteria

- Users can inspect parameter definition and cross-project values from `/parameters` without route changes.
- Users can emphasize a target project while still seeing all project values for the parameter.
- Users can add the viewed parameter to the normal modification draft flow from the modal.
- The standalone comparison page is not reachable as a business feature.
- `/parameter-comparison` shows a no-entry or 404-style state.
- Navigation and quick-entry UI no longer advertise comparison as a separate page.
- Tests cover the new modal workflow and retired route behavior.
