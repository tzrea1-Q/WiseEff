# WiseEff New User Onboarding

> Chinese: [Chinese](../zh-CN/product-specs/new-user-onboarding.md)

This document captures first-session expectations for a new WiseEff user or developer evaluating the product.

## First Impression

Users should understand that WiseEff coordinates parameter management, log analysis, debugging, and Agent-assisted work inside governed engineering workflows.

In API mode, unauthenticated users first see the WiseEff auth screen. Local account login and registration are productized for self-managed evaluation flows: registration uses a username and an allowed self-service platform role, plus a password confirmation. The new account joins the Evaluation Organization (ChargeLab when seeded; otherwise the single bootstrap Organization). There is no organization picker. The screen explains that join rule, username syntax, and a one-line role hint. Admin is not available for self-registration. When no local Admin exists, the screen shows the `npm run admin:bootstrap` hint. Operators can turn self-registration off with `AUTH_LOCAL_SELF_REGISTER=false`; the Register tab then stays hidden. Committer requests create an inactive account and a pending Admin approval request; they do not sign the user in or grant a session until approval activates the account and assigns the requested Committer role. Signed-in users can change their password from the profile dialog (other sessions are revoked). Admins can reset a member password from `/organization/members` (every session for that user is revoked). Email verification is intentionally not supported yet, so this path is not verified-domain onboarding or invitation acceptance.

## First Developer Path

A developer should be able to start from README, run local setup, choose mock or API runtime, understand where frontend ports and backend modules live, and pick verification commands from the developer docs.

## First Operator Path

An operator should start from runbooks, understand readiness boundaries, run local/self-hosted checks, and avoid claiming target readiness until real evidence has been collected.

## Product Expectations

- Risky writes require human approval and audit.
- Agent assistance is bounded by tools, permissions, and approvals.
- Device writes require state checks, snapshots, readback, and audit.
- Mock runtime is for demo/test use only.
- The local account lifecycle covers username-based register, login, logout, current-user lookup, current-user profile editing, self-service password change, and Admin password reset.
- Admin self-registration is blocked, and local Committer registration stays unauthenticated until Admin approval from user governance.
- Self-registration can be disabled server-side; the auth screen hides Register when the public local-config says it is off.
- Invitations, email verification, and external SSO onboarding remain separate productization work.

## Success Criteria

New users should know which workflow to open, which role can perform each action, what evidence proves completion, and where to find deeper docs in either English or Chinese.

## Local Account Acceptance Notes

| ID | Scenario | Actor | Steps | Expected result |
| --- | --- | --- | --- | --- |
| PM-02 | Register a Committer role that requires approval | New user | Register as `hardware-committer` or `software-committer`. | The API creates an inactive account with the matching base User role recorded and a pending Admin approval request. The auth screen shows a pending-approval result state without the editable registration form. The user does not receive a session token and cannot log in before approval. |
| PM-03 | Approve a Committer registration request | Admin | Open `/organization/members` and approve the pending Committer request. | The account is activated, the requested Committer role is granted, and the user can log in or refresh to access Committer review capabilities. |
| PM-04 | Change the current password | Signed-in user | Open the profile dialog and submit current + new password. | The current session stays active; other sessions for that user are revoked. |
| PM-05 | Reset a member password | Admin | Open `/organization/members`, reset the member password, and confirm. | The new password is stored; every session for that user is revoked. |
| PM-06 | Close self-registration | Operator | Set `AUTH_LOCAL_SELF_REGISTER=false` and reload the auth screen. | Register is hidden; `POST /api/v1/auth/register` returns `FORBIDDEN`. |
| PM-07 | Bootstrap the first Admin | Operator | When the auth screen says no Admin exists, run `npm run admin:bootstrap`. | The first Admin can log in; self-registration still cannot create Admin. |
