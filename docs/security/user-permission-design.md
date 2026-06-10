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
| Admin | Governance role for user, permission, audit, and admin surfaces. Admin is not a blanket workflow assignee. |

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
