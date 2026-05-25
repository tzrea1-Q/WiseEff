# Project Parameter Initialization Design

## Summary

Add a parameter library initialization step to the new project creation wizard. When a new project starts, users can create a one-time snapshot from one or more existing projects, choose the subset of parameters to inherit, and submit the generated parameter library for initialization review.

The feature is intentionally a snapshot copy. It does not keep the new project linked to source projects after the initialization draft is generated.

## Goals

- Let project creators initialize a new project's parameter library from existing project experience.
- Support flexible inheritance from one or more projects.
- Let users select all or part of the source parameters by module, risk, and individual parameter.
- Preserve auditability by generating an initialization draft and review record before the parameter library becomes active.
- Avoid treating inherited current values as real measurements for the new project.

## Non-Goals

- No ongoing synchronization with source projects after snapshot creation.
- No full template management system in the first version.
- No automatic conflict merging beyond the primary-source priority rule.
- No direct device data collection for new project current values.

## Entry Point

The feature lives inside the new project creation wizard. It appears after project basics and team owner details, before final summary and submission.

Recommended wizard steps:

1. Project basics
2. Team and owner
3. Initialize parameter library
4. Review summary
5. Submit for approval

The initialization step should provide a visible "start from empty" path, but users must choose that mode intentionally.

## Initialization Flow

1. User creates a new project and enters the initialization step.
2. User selects one or more source projects.
3. User manually chooses the primary source project.
4. User optionally chooses supplement source priority.
5. User filters candidate parameters by module and risk.
6. User fine-tunes individual parameters in the candidate list.
7. User previews the generated snapshot.
8. User submits the project and parameter initialization for review.
9. The project is created with status `initialization_pending_review`.
10. Admin reviews the initialization draft.
11. On approval, the new project's parameter values become active and project status becomes `initialized`.
12. On rejection, the draft keeps its selections and rejection reason so the creator can revise and resubmit.

## Project Initialization Status

Use a project-level status to control what the parameter workspace allows.

- `not_initialized`: project exists without an initialization choice.
- `initialization_draft`: project creator has selected sources and parameters but has not submitted review.
- `initialization_pending_review`: initialization has been submitted and is waiting for admin review.
- `initialization_rejected`: admin rejected the initialization draft.
- `initialized`: initialization is approved and the project can use the normal parameter workflow.

Before `initialized`, project members can view parameters, compare inherited values, and add notes. They cannot submit normal parameter change requests.

## Source Selection

Users can select multiple source projects. If only one source is selected, it is automatically the primary source. If multiple sources are selected, the user must manually designate one primary source.

The primary source is the baseline. Supplement sources only fill parameters missing from the primary source and never override primary-source parameters.

Supplement priority defaults to selection order. Users may reorder supplement sources before generating the preview.

## Parameter Selection

Selection happens in three layers:

1. Module selection for broad scope control.
2. Risk selection for quick filtering.
3. Individual parameter selection for final cleanup.

The candidate parameter list shows:

- Parameter name and key.
- Module.
- Risk.
- Recommended value to inherit.
- Source project.
- Whether the parameter came from the primary source or was filled from a supplement.
- Whether alternative source values exist.
- Whether the value needs an owner or admin note.

The page footer should summarize selected count, supplement-filled count, conflict/reference count, and parameters requiring notes.

## Conflict And Value Rules

Conflict resolution follows primary-source priority:

- If the same parameter exists in the primary source and supplement sources, inherit the primary-source version.
- Supplement versions are shown as references but do not override.
- If the parameter is missing from the primary source and exists in supplement sources, inherit from the highest-priority supplement source.
- If a selected parameter has no recommended value, include it only with a "recommended value needs confirmation" flag.

Inherited values:

- Copy the source project's recommended value into the new project as the initial recommended value.
- Do not copy the source project's current value.
- Set the new project's current value state to `pending_project_confirmation`.
- Show this state to users as "Pending project confirmation". Chinese localization should use the existing app i18n or label conventions during implementation.

## Snapshot Preview

Before submission, users can open a snapshot preview with three groups:

- Parameters that will enter the new project.
- Parameters excluded by filters or manual deselection.
- Parameters with source conflicts or alternative reference values.

The preview must make clear that this is a one-time snapshot. Later source project changes do not affect the draft.

## Review Flow

The system creates a `ProjectParameterInitializationReview` record when the user submits the wizard.

The admin review page should show initialization reviews separately from ordinary parameter change requests, while reusing the existing review list and detail patterns where possible.

Admin review details include:

- New project name, code, owner, and team.
- Submitter.
- Primary source and supplement sources.
- Selected module and risk scope.
- Final selected parameters.
- Supplement-filled parameters.
- Conflict/reference parameters.
- Parameters whose recommended values need confirmation.
- Parameters whose current values are `pending_project_confirmation`.
- Creator notes.

Admin actions:

- Approve initialization.
- Reject initialization with a required reason.

Approval writes the selected parameter values to the new project and changes project status to `initialized`. Rejection changes status to `initialization_rejected` and keeps the draft editable.

## Data Model

Add a draft model:

```ts
type ProjectParameterInitializationDraft = {
  id: string;
  projectId: string;
  projectName: string;
  projectCode: string;
  ownerUserId: string;
  sourceProjectIds: string[];
  primarySourceProjectId: string;
  supplementSourceProjectIds: string[];
  selectedModules: string[];
  selectedRisks: Array<"High" | "Medium" | "Low">;
  selectedParameterIds: string[];
  parameterSnapshots: ProjectParameterInitializationSnapshotItem[];
  notes: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

type ProjectParameterInitializationSnapshotItem = {
  parameterId: string;
  sourceProjectId: string;
  sourceRole: "primary" | "supplement";
  module: string;
  risk: "High" | "Medium" | "Low";
  recommendedValue: string;
  currentValueState: "pending_project_confirmation";
  alternativeSourceProjectIds: string[];
  needsRecommendedValueConfirmation: boolean;
  notes?: string;
};
```

Add a review model:

```ts
type ProjectParameterInitializationReview = {
  id: string;
  draftId: string;
  projectId: string;
  status: "pending" | "approved" | "rejected";
  submittedBy: string;
  submittedAt: string;
  reviewedBy?: string;
  reviewedAt?: string;
  rejectionReason?: string;
};
```

Add a project status:

```ts
type ProjectInitializationStatus =
  | "not_initialized"
  | "initialization_draft"
  | "initialization_pending_review"
  | "initialization_rejected"
  | "initialized";
```

The current prototype uses shared parameter definitions with per-project values. This design should extend that shape instead of replacing it.

## Permissions

Project creators can create and edit their own initialization drafts before submission.

Admins can approve or reject initialization reviews.

While a project is not `initialized`, normal parameter change submission is disabled for that project. Read-only parameter views and comparison remain available.

## Empty And Error States

- No source selected: user can continue only if they explicitly choose "start from empty".
- Multiple sources without primary source: cannot continue.
- Filter result contains zero parameters: draft can be saved but cannot be submitted.
- Recommended value missing: parameter can remain selected but is flagged for admin confirmation.
- Review rejected: creator sees rejection reason and returns to the initialization step with previous selections intact.
- Source project changes after draft creation: no automatic updates. The draft keeps its snapshot data.

## UI Design

The initialization step uses the approved low-fidelity structure:

- Left step navigation for the project wizard.
- Main header explaining one-time snapshot initialization.
- Primary source panel.
- Supplement source panel.
- Module and risk filter column.
- Candidate parameter table.
- Sticky footer summary and actions.

Primary actions:

- Start from empty.
- Preview snapshot.
- Continue.

The summary and review pages must explicitly state that the new project will be created in initialization pending review state.

## Testing

Cover these cases:

- Single source project creates an initialization review with selected parameters.
- Multiple source projects use primary-source priority.
- Supplement sources fill parameters missing from the primary source.
- Module, risk, and individual parameter selections combine correctly.
- Zero selected parameters cannot be submitted for review.
- Missing recommended values are flagged.
- Projects in pending or rejected initialization states cannot submit normal parameter change requests.
- Review approval activates the new project's parameters.
- Review rejection keeps the draft and reason available for revision.
- Initialized project appears in parameter workspace, comparison, and admin views.

## Open Decisions

None. Template management and ongoing synchronization are intentionally out of scope for the first version.
