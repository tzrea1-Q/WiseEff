# Project Parameter Initialization Design

> Amended 2026-08-05 for post-cutover **semantic bindings** (C1 / TD-060).  
> Chinese: [`docs/zh-CN/design-docs/2026-05-20-project-parameter-initialization-design.md`](../zh-CN/design-docs/2026-05-20-project-parameter-initialization-design.md)  
> Plan: [`docs/exec-plans/active/2026-08-05-project-parameter-initialization.md`](../exec-plans/active/2026-08-05-project-parameter-initialization.md)

## Summary

Add a parameter-library initialization step to the new-project wizard. Creators take a **one-time snapshot of selected source-project bindings** (semantic identities), submit an initialization review, and unlock the normal typed-binding workflow only after admin approval.

This is intentionally a snapshot. The new project is **not** kept linked to source projects after the draft is generated.

## Goals

- Let creators initialize a new project from existing project experience.
- Support inheritance from one or more source projects with primary/supplement priority.
- Select candidates by module, risk, and individual **bindings** (not flat shared `parameterId` rows).
- Preserve auditability: draft + review before the target library becomes writable.
- Never treat inherited source **device measurements** as already measured on the new project.

## Non-Goals

- Ongoing synchronization with source projects after snapshot creation.
- Full template / marketplace management in v1.
- Automatic conflict merging beyond primary-source priority.
- Direct device collection for new-project measured values.
- Using flat `recommendedValue` / shared parameter-definition tables as the API write model (prototype-only legacy; see Deprecated below).

## Deprecated (do not implement for API mode)

The May 2026 draft described shared flat parameter definitions plus per-project `recommendedValue` / `currentValue` strings. After the topology cutover, that shape is **not** the product write model:

| Deprecated concept | Replacement |
| --- | --- |
| `selectedParameterIds` / snapshot `parameterId` as SSOT | Source `projectParameterBindingId` (+ target materialize of a new binding) |
| Snapshot `recommendedValue: string` as write payload | Snapshot of `parameterSpecId` / `parameterSpecVersionId` / `effectiveValue` (or `rawValue`) shape from the source binding |
| “Activate shared definition values on approve” | Transactionally **materialize bindings** (and required module/topology support) on the **target** project |
| Prototype reducer as SSOT | Port + HTTP + DB; mock adapter implements the same Port |

Mock UI may still show legacy labels during transition, but API mode must not persist or submit flat recommended-value SSOT.

## Entry Point

Lives in the new-project creation wizard, after project basics and team/owner, before final summary.

Recommended wizard steps:

1. Project basics  
2. Team and owner  
3. Initialize parameter library  
4. Review summary  
5. Submit for approval  

The initialization step must offer an explicit **start from empty** path.

## Initialization Flow

1. Creator starts a new project and reaches the initialization step.  
2. Either chooses **start from empty**, or selects one or more source projects.  
3. With sources: designate primary (required when ≥2 sources); optionally order supplement priority.  
4. Filter candidate **bindings** by module and risk.  
5. Fine-tune individual binding selection.  
6. Preview the generated snapshot (server-resolved).  
7. Submit project + initialization for review.  
8. Project status becomes `initialization_pending_review`.  
9. Admin reviews the initialization draft (separate from ordinary change-request review).  
10. **Approve:** materialize target bindings; status → `initialized`.  
11. **Reject:** status → `initialization_rejected`; draft + reason remain editable for resubmit.

## Project Initialization Status

Persisted on `projects` (extend existing `status` or add `initialization_status` — prefer a dedicated column if `status` already encodes ops states such as `maintenance`):

- `not_initialized` — project exists without an initialization choice.  
- `initialization_draft` — sources/bindings chosen but not submitted.  
- `initialization_pending_review` — awaiting admin.  
- `initialization_rejected` — rejected; draft editable.  
- `initialized` — approved; normal typed binding submit allowed.

**Lock:** while status ∉ {`initialized`} (and not a separate ops-only `maintenance` state that already allows edits), block normal typed binding submit / change-request create for that project. Read-only topology/binding views remain available.

## Source Selection

- Multiple sources allowed.  
- One source ⇒ automatically primary.  
- Multiple sources ⇒ creator must designate primary.  
- Primary is the baseline; supplements **only fill bindings missing from primary** (keyed by semantic identity — see Conflict).  
- Supplement priority defaults to selection order; reorder before preview.

## Binding Selection

Three layers:

1. Module selection (browse via durable `moduleId` / attribution tree).  
2. Risk selection (from spec / policy metadata available on the binding view).  
3. Individual binding selection.

Candidate list shows:

- Property key / display label.  
- Module path.  
- Risk (if available).  
- Effective value preview (from source binding; not a device “current”).  
- Source project + primary vs supplement.  
- Whether alternative source bindings exist for the same semantic key.  
- Whether the effective value needs an owner/admin note.

Footer: selected count, supplement-filled count, conflict/reference count, items needing notes.

## Conflict And Value Rules

Semantic conflict key (v1): within an organization, treat two bindings as the “same parameter slot” when they share:

- `parameter_spec_id`, and  
- `module_id`  

(aligned with existing cross-project compare peers). Optional tightening later: also require matching `logical_node_id` when both are non-null — **out of scope for v1** unless implementation discovers false merges; document in service if tightened.

Priority:

- Same semantic key in primary + supplements → inherit **primary** binding snapshot; supplements listed as references.  
- Missing in primary, present in supplements → inherit highest-priority supplement.  
- Selected binding with empty/invalid effective value → allowed only with `needsEffectiveValueConfirmation: true`.

Inherited values on materialize:

- Create a **new** `project_parameter_binding` (and supporting rows) on the **target** project from the snapshot’s spec version + value payload.  
- Do **not** copy source device-measured “current” / live debug values as already confirmed on the target.  
- Target measured/current confirmation state: `pending_project_confirmation` (product copy: “Pending project confirmation” / 待项目确认).  
- Do not invent flat `recommendedValue` columns for API persistence.

## Empty Path

**Start from empty:**

- No source projects; zero snapshot items.  
- Submit still creates a review (or a short-circuit approve path for empty — prefer **same review flow** for audit symmetry).  
- On approve: status → `initialized` with **zero** bindings.  
- Creator cannot “accidentally” empty-init: UI requires an explicit affirmation control.

## Snapshot Preview

Three groups before submit:

- Bindings that will enter the target project.  
- Bindings excluded by filters or deselection.  
- Bindings with source conflicts / alternative references.

Preview must state: one-time snapshot; later source changes do not update the draft.

## Review Flow

Submitting creates `ProjectParameterInitializationReview`.

Admin surface: initialization reviews separate from ordinary parameter change requests; reuse list/detail chrome where practical.

Review detail includes:

- Target project name/code/owner/team.  
- Submitter.  
- Primary + supplement sources.  
- Module/risk scope.  
- Final selected binding snapshots.  
- Supplement-filled and conflict/reference sets.  
- Items needing effective-value confirmation.  
- Items with `pending_project_confirmation` on target after approve.  
- Creator notes.

Actions: approve; reject with required reason.

## Data Model (API / Port)

```ts
type ProjectInitializationStatus =
  | "not_initialized"
  | "initialization_draft"
  | "initialization_pending_review"
  | "initialization_rejected"
  | "initialized";

type ProjectParameterInitializationDraft = {
  id: string;
  organizationId: string;
  projectId: string;
  projectName: string;
  projectCode: string;
  ownerUserId: string;
  sourceProjectIds: string[];
  primarySourceProjectId: string | null; // null when start-from-empty
  supplementSourceProjectIds: string[];
  selectedModuleIds: string[];
  selectedRisks: Array<"High" | "Medium" | "Low">;
  /** Source binding ids the creator selected (pre-merge). */
  selectedSourceBindingIds: string[];
  /** Server-resolved snapshot after primary/supplement merge. */
  bindingSnapshots: ProjectParameterInitializationSnapshotItem[];
  emptyLibrary: boolean;
  notes: string;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
};

type ProjectParameterInitializationSnapshotItem = {
  /** Stable id within the draft (not the target binding id). */
  id: string;
  sourceProjectId: string;
  sourceProjectParameterBindingId: string;
  sourceRole: "primary" | "supplement";
  parameterSpecId: string;
  parameterSpecVersionId: string;
  propertyKey: string;
  moduleId: string;
  risk: "High" | "Medium" | "Low" | null;
  /** Serializable effective value copied from source binding at snapshot time. */
  effectiveValue: unknown;
  rawValue: string;
  currentValueState: "pending_project_confirmation";
  alternativeSourceBindingIds: string[];
  needsEffectiveValueConfirmation: boolean;
  notes?: string;
};

type ProjectParameterInitializationReview = {
  id: string;
  draftId: string;
  organizationId: string;
  projectId: string;
  status: "pending" | "approved" | "rejected";
  submittedByUserId: string;
  submittedAt: string;
  reviewedByUserId?: string;
  reviewedAt?: string;
  rejectionReason?: string;
};
```

Persistence sketch (migration **≥ 0091**):

- `project_parameter_initialization_drafts` (+ JSONB or child table for snapshot items).  
- `project_parameter_initialization_reviews`.  
- `projects.initialization_status` (or mapped `projects.status` values — confirm against existing status enum in implementation).  
- Indexes on `(organization_id, project_id)`, review `status`.

Module placement: extend `server/modules/parameters/` unless routes grow large enough to warrant `parameter-initialization/`.

## Permissions

| Actor | Allowed |
| --- | --- |
| Project creator (owner) | Create/update own draft before submit; resubmit after reject |
| Parameter admin (`admin:access` / parameter-admin) | List pending reviews; approve; reject |
| Other members | Read-only views when authorized; no draft edit; no normal CR submit until initialized |

## Audit Events

Write via `createAuditEvent` (`app`: `parameter-management` or `parameter-admin` as appropriate):

| Event | `kind` (stable) | When |
| --- | --- | --- |
| Draft submitted | `project-initialization-submitted` | Submit for review |
| Approved | `project-initialization-approved` | Approve + materialize success |
| Rejected | `project-initialization-rejected` | Reject with reason |

Metadata: `draftId`, `reviewId`, `projectId`, source project ids, selected binding counts — no full value dumps of sensitive payloads beyond what ordinary parameter audit already allows.

## Empty And Error States

- No source and not empty-mode: cannot continue.  
- Multiple sources without primary: cannot continue.  
- Non-empty mode with zero selected bindings after filters: draft savable; **cannot submit**.  
- Empty mode: submit allowed with zero snapshots.  
- Effective value missing/invalid: selectable only with confirmation flag.  
- Rejected: show reason; return to wizard with prior selections.  
- Source project changes after draft: no auto-refresh; regenerate preview explicitly if product adds that later.

## UI Design

Low-fidelity structure unchanged in spirit:

- Left wizard steps.  
- Header: one-time **binding** snapshot.  
- Primary / supplement panels.  
- Module + risk filters.  
- Candidate **binding** table.  
- Sticky footer.

Primary actions: Start from empty; Preview snapshot; Continue.

Summary/review must state pending-review status until approve.

## Testing (acceptance intent)

- Single source → review with selected bindings.  
- Multi-source primary priority + supplement fill.  
- Module/risk/individual selection compose.  
- Non-empty zero selection cannot submit; empty path can.  
- Needs-confirmation flags surface in review.  
- Pending/rejected lock normal CR submit (`PARAM-INIT-LOCK-001`).  
- Approve materializes bindings and unlocks (`PARAM-INIT-REVIEW-001`).  
- Reject keeps draft + reason (`PARAM-INIT-REJECT-001`).  
- Wizard + empty path IDs: `PARAM-INIT-WIZARD-001`, `PARAM-INIT-EMPTY-001`.

## Open Decisions

None for v1 product scope. Implementation may choose dedicated `initialization_status` column vs overloading `projects.status` after inspecting current status enum usage — record the choice in the migration PR description.
