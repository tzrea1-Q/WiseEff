# New User Onboarding

Date: 2026-05-25

## Goal

New WiseEff users should understand where to start, what their role permits, and how AI assistance fits into governed engineering workflows.

## Target Users

- Guest: explores read-only parameter and platform views.
- Hardware User: submits parameter changes, uploads logs, and uses debugging tools.
- Software User: submits software-side parameter changes and follows merge status.
- Hardware Committer: reviews hardware-side parameter requests.
- Software Committer: reviews software-side requests and helps close merge flow.
- Admin: manages users, permissions, parameter governance, and audit.

## First-Session Flow

1. User lands on the WiseEff home page.
2. User enters "我的工作台" to see available workspaces and role-relevant entry points.
3. System shows navigation based on role capability.
4. User opens a domain workspace:
   - parameter workbench for parameter viewing and draft changes,
   - log analysis for upload and evidence review,
   - debugging for device or node operations.
5. User opens the Agent panel for context-specific suggestions.
6. Any write-like action asks for confirmation and, in productized flows, server-side permission and audit.

## Onboarding Requirements

- The active role must be visible and understandable.
- Users should see only reachable workspaces or get a clear access-denied page with a fallback.
- Empty states should explain what is missing and what action is available.
- Agent suggestions must be contextual to the current page.
- Agent actions that change state must not bypass confirmation.

## Prototype Status

The current frontend supports role switching, permission-denied fallbacks, contextual Agent suggestions, and mock workflow actions. M0-M5 API mode adds governed backend seams for auth context, parameters, logs, debugging, Agent approvals, audit, and pilot readiness. Full onboarding persistence, invitations, SSO/OIDC, and production role assignment remain future productization work.

## Acceptance Checks

- A Guest can navigate to read-only parameter pages and cannot submit changes.
- A Hardware User can reach parameter, logs, and debugging workspaces.
- A Committer can access review surfaces.
- An Admin can access management pages.
- Agent write actions require confirmation in the UI.
