# WiseEff User Guide

> Chinese: [Chinese](../zh-CN/user-guide/README.md)

## Who can do this

This guide is for new account applicants and all WiseEff roles: guest, hardware user, software user, hardware/software committer, Organization Admin (`admin`), and Platform Admin (`platform-admin`). Each workflow explains its access requirements; reading the guide does not grant permissions.

WiseEff coordinates parameter changes, device debugging, log analysis, and engineering knowledge inside an Organization. Engineers use these workflows to propose changes, review evidence, and retain a traceable history; Xiaoze assists within permissions and human-approval boundaries. An Organization is a company or deployment customer's boundary, not a hardware/software department. The repository is suitable for controlled staging and pilot evidence collection, not broadly production-ready.

## Start here by role

Start with [Account and access](account-and-access.md) to sign in, then choose from the seven workflow guides below. These role-based paths use the default permissions; each guide explains the additional Organization, project, and action requirements.

The app UI is Chinese-first, so locate pages by their route; the Chinese guide gives the exact on-screen labels.

| Your role | Start here |
| --- | --- |
| Guest (`guest`) | Browse and compare [parameters](parameter-management.md), search [knowledge](knowledge.md), and ask [Xiaoze](xiaoze.md) read-only questions. |
| Hardware user (`hardware-user`) | Propose [parameter changes](parameter-management.md), read device nodes in [Device debugging](device-debugging.md), analyze [logs](log-analysis.md), contribute [knowledge](knowledge.md), and use [Xiaoze](xiaoze.md). |
| Software user (`software-user`) | Use the hardware-user workflows above and handle assigned [parameter merge tasks](parameter-management.md#advance-staged-requests) when authorized. |
| Hardware committer (`hardware-committer`) | After [approval](account-and-access.md#wait-for-committer-approval), use the hardware-user workflows, handle assigned [hardware reviews](parameter-management.md#advance-staged-requests), and perform authorized node writes, reloads, and restores in [Device debugging](device-debugging.md). |
| Software committer (`software-committer`) | After [approval](account-and-access.md#wait-for-committer-approval), use the hardware-user workflows, handle assigned [software reviews and merges](parameter-management.md), and perform authorized node writes, reloads, and restores in [Device debugging](device-debugging.md). |
| Organization Admin (`admin`) | Use [Organization administration and governance](organization-and-governance.md) for members, registration approvals, audits, and business modules; manage [parameters and configuration](parameter-management.md) and [knowledge](knowledge.md), and use the engineering workflows above within scope. |
| Platform Admin (`platform-admin`) | Use the Admin workflows above within their documented scope; [Organization administration and governance](organization-and-governance.md) explains protected roles and the registration queue's cross-Organization caveat. |

## Workflows

- [Account and access](account-and-access.md): local registration, Committer approval, password changes and resets, and deployment-provided OIDC sign-in.
- [Parameter management](parameter-management.md): search and comparison, drafts, submission and review, project initialization, imports, and configuration releases.
- [Device debugging](device-debugging.md): connect HDC/ADB devices, read and safely write nodes, test DTS reloads, restore baselines, and inspect evidence.
- [Log analysis](log-analysis.md): upload logs, follow stages, distinguish degraded results, inspect evidence, give feedback, and create knowledge drafts.
- [Knowledge](knowledge.md): search and ask Xiaoze, create and publish entries, upload files, manage revisions and archives, and check index health.
- [Xiaoze](xiaoze.md): ask grounded questions, inspect sources, edit proposals, and approve or reject Agent actions.
- [Organization administration and governance](organization-and-governance.md): manage members and Committer approvals, investigate audits, maintain business modules, and send product feedback.

## Find the right reference

- [Knowledge base](../README.md): developer and operator reading paths.
- [Authentication reference](../api/authentication.md): the maintained identity and local-account contracts.
