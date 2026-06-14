# WiseEff New User Onboarding

> Chinese: [Chinese](../zh-CN/product-specs/new-user-onboarding.md)

This document captures first-session expectations for a new WiseEff user or developer evaluating the product.

## First Impression

Users should understand that WiseEff coordinates parameter management, log analysis, debugging, and Agent-assisted work inside governed engineering workflows.

In API mode, unauthenticated users first see the WiseEff auth screen. Local account login and registration are productized for self-managed evaluation flows: registration uses a username, fixed localized hardware/software department organization choices, and an allowed self-service platform role. Admin is not available for self-registration. Committer requests create an inactive account and a pending Admin approval request; they do not sign the user in or grant a session until approval activates the account and assigns the requested Committer role. Email verification is intentionally not supported yet, so this path is not verified-domain onboarding or invitation acceptance.

## First Developer Path

A developer should be able to start from README, run local setup, choose mock or API runtime, understand where frontend ports and backend modules live, and pick verification commands from the developer docs.

## First Operator Path

An operator should start from runbooks, understand readiness boundaries, run local/self-hosted checks, and avoid claiming target readiness until real evidence has been collected.

## Product Expectations

- Risky writes require human approval and audit.
- Agent assistance is bounded by tools, permissions, and approvals.
- Device writes require state checks, snapshots, readback, and audit.
- Mock runtime is for demo/test use only.
- The local account lifecycle covers username-based register, login, logout, current-user lookup, and current-user profile editing.
- Admin self-registration is blocked, and local Committer registration stays unauthenticated until Admin approval from user governance.
- Invitations, email verification, and external SSO onboarding remain separate productization work.

## Success Criteria

New users should know which workflow to open, which role can perform each action, what evidence proves completion, and where to find deeper docs in either English or Chinese.
