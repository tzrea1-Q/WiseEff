# User Permission Design

> Chinese: [Chinese](../zh-CN/security/user-permission-design.md)

Date: 2026-05-31

This note defines the current WiseEff platform permission model for role behavior, workflow assignee slots, and frontend eligibility filtering.

## Roles

| Role | Intent |
| --- | --- |
| Guest | Read-only observer with the lowest privilege. |
| Hardware User | Hardware-side operator who can use hardware-facing parameter and debugging workflows. |
| Software User | Software-side operator who can use software workflows and all Hardware User operations. |
| Hardware Committer | Hardware MDE/reviewer role with Hardware User operations plus hardware commit/review responsibilities. |
| Software Committer | Software MDE/reviewer role with Hardware User operations plus software commit/review responsibilities. |
| Admin | Governance role for user, permission, audit, and admin surfaces, including Organization administration (`/organization`). Admin is not a blanket workflow assignee. |

## Organization administration

`/organization` is the Organization administration profile. `/organization/members` is people management. Both are home-organization tenant operations. `GET /api/v1/organization` is available to any active authenticated member. `PATCH /api/v1/organization` requires `users:manage`, accepts `{ name }` only, and writes `organization-update` in the same transaction. The name is a label, not a globally unique identifier. This is distinct from Organization-scoped governance on `/parameter-admin`.

## Inclusion Rules

Operation permissions inherit as follows:

- Hardware Committer includes all Hardware User permissions.
- Software Committer includes all Hardware User permissions.
- Software User includes all Hardware User permissions.

These inclusion rules describe what a signed-in actor can do. They do not automatically make the actor eligible for every workflow assignee slot.

## Operation Permissions vs Workflow Slots

Operation permission inheritance answers: "Can this actor perform this action?"

Workflow-slot assignability answers: "Can this concrete user be selected for this workflow responsibility?"

Those are separate checks. A role may inherit Hardware User operations while still being excluded from a specific slot if the slot calls for a concrete hardware committer, software committer, or software developer assignee.

## Knowledge Base Permissions

The knowledge workflow uses three permissions with ownership-based governance instead of workflow slots:

| Permission | Grants | Default roles |
| --- | --- | --- |
| `knowledge:view` | Read published entries and search. | Every organization member (Guest and above). |
| `knowledge:edit` | Create entries; edit, publish, and archive OWN entries; restore own revisions. | Hardware/Software User and above. |
| `knowledge:manage` | Govern any entry (edit, archive, restore, hard delete) regardless of ownership. | Admin tier. |

Publisher accountability: `knowledge:edit` never publishes or edits another person's entry; cross-person governance concentrates in `knowledge:manage`. Draft entries are visible to their owner and managers only. Hard delete always requires `knowledge:manage` and leaves a `High`-severity audit record.

Phase 3 distillation and agent drafts extend the same model without new permissions:

- Distil-from-log (`POST /api/v1/knowledge/distill-from-log`) requires `knowledge:edit` to create the draft plus `logs:view` (and organization scope) on the source analysis record.
- The approval-gated agent tool `action.createKnowledgeDraft` executes under the calling user's AuthContext and requires `knowledge:edit` at execution time; every invocation pauses for explicit human approval before any write and creates a NEW draft only.
- Agent-draft publish rights: the draft's creator is the session user, so `knowledge:edit` publishes or archive-rejects drafts distilled in their OWN sessions; `knowledge:manage` publishes or rejects any agent draft from the `/knowledge-admin` queue. Archive-reject (`POST /api/v1/knowledge/entries/:entryId/reject`) only accepts agent-sourced drafts.

## Workflow Slot Examples

Current parameter workflow slots use concrete eligible users:

| Slot | Eligible users |
| --- | --- |
| Hardware MDE | Concrete Hardware Committer users only. |
| Software MDE | Concrete Software Committer users only. |
| Software developer | Concrete Software User or Software Committer users. |

Guest, Admin, and plain/base users should not appear in concrete assignee slots unless the slot definition explicitly makes them eligible.

## Frontend Dropdown Rule

If permission or slot eligibility does not match, do not show the option or user in the dropdown. Filtering should happen before rendering the dropdown option list, not by showing invalid choices that fail later.

Frontend hiding is UX only. The backend remains the source of truth and must re-check authentication, operation permission, project/organization boundary, active user state, slot eligibility, validation, and audit rules before accepting writes.
