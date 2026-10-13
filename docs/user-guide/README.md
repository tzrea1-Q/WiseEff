# WiseEff User Guide

> Chinese: [Chinese](../zh-CN/user-guide/README.md)

## Who can do this

This guide is for new account applicants and all WiseEff roles: guest, hardware user, software user, hardware/software committer, Organization Admin (`admin`), and Platform Admin (`platform-admin`). Each workflow explains its access requirements; reading the guide does not grant permissions.

WiseEff coordinates parameter changes, device debugging, log analysis, and engineering knowledge inside an Organization. Engineers use these workflows to propose changes, review evidence, and retain a traceable history; Xiaoze assists within permissions and human-approval boundaries. An Organization is a company or deployment customer's boundary, not a hardware/software department. The repository is suitable for controlled staging and pilot evidence collection, not broadly production-ready.

## Start here by role

Only published guide pages are listed here. Start with [Account and access](account-and-access.md); further workflow guides will be added as they become available.

The app UI is Chinese-first, so locate pages by their route; the Chinese guide gives the exact on-screen labels.

| Your role | Start here |
| --- | --- |
| Guest (`guest`) | [Register or sign in](account-and-access.md#register-a-local-account) and understand which Organization you join. |
| Hardware user (`hardware-user`) | [Create a local account](account-and-access.md#register-a-local-account) and [change your password](account-and-access.md#change-your-local-password). |
| Software user (`software-user`) | [Create a local account](account-and-access.md#register-a-local-account) and [change your password](account-and-access.md#change-your-local-password). |
| Hardware committer (`hardware-committer`) | [Request a Committer role](account-and-access.md#wait-for-committer-approval) before trying to sign in. |
| Software committer (`software-committer`) | [Request a Committer role](account-and-access.md#wait-for-committer-approval) before trying to sign in. |
| Organization Admin (`admin`) | [Approve registration requests](account-and-access.md#approve-a-committer-request) and [reset a member's password](account-and-access.md#reset-a-members-local-password). |
| Platform Admin (`platform-admin`) | [Account and access](account-and-access.md), including Admin actions in your home Organization; this guide does not cover cross-Organization operations. |

## Workflows

- [Account and access](account-and-access.md): local registration, Committer approval, password changes and resets, and deployment-provided OIDC sign-in.
- [Parameter management](parameter-management.md): search and comparison, drafts, submission and review, project initialization, imports, and configuration releases.
- [Device debugging](device-debugging.md): connect HDC/ADB devices, read and safely write nodes, test DTS reloads, restore baselines, and inspect evidence.
- [Log analysis](log-analysis.md): upload logs, follow stages, distinguish degraded results, inspect evidence, give feedback, and create knowledge drafts.

## Find the right reference

- [Knowledge base](../README.md): developer and operator reading paths.
- [Authentication reference](../api/authentication.md): the maintained identity and local-account contracts.
