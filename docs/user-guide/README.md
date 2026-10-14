# WiseEff User Guide

> Chinese: [Chinese](../zh-CN/user-guide/README.md)

## Who can do this

Use this guide whether you are applying for an account or already using WiseEff as a guest, hardware user, software user, hardware/software committer, Organization Admin (`admin`), or Platform Admin (`platform-admin`). Each guide explains the roles and permissions needed; your account's authorization determines which actions you can take.

In WiseEff, engineers can propose parameter changes, debug devices, analyze logs, and organize engineering knowledge for the same Organization. The workflows keep a traceable history, and Xiaoze assists under the account's permissions and human-approval requirements. An Organization represents a company or deployment customer, not a hardware or software department. The repository is suitable for controlled staging and pilot evidence collection; acceptance for broad production use remains incomplete.

## Start here by role

Follow [Account and access](account-and-access.md) to sign in, then choose the guide for your task. The table recommends starting points based on default role permissions. Each guide also explains the Organization, project, and permission requirements for specific actions.

The app UI is Chinese-first. Use routes to locate pages, or consult the Chinese guide for the exact on-screen labels.

| Your role | Start here |
| --- | --- |
| Guest (`guest`) | Browse and compare [parameters](parameter-management.md), search [knowledge](knowledge.md), and ask [Xiaoze](xiaoze.md) read-only questions. |
| Hardware user (`hardware-user`) | Propose [parameter changes](parameter-management.md), read device nodes in [Device debugging](device-debugging.md), analyze [logs](log-analysis.md), contribute [knowledge](knowledge.md), and use [Xiaoze](xiaoze.md). |
| Software user (`software-user`) | Use the workflows in the hardware-user row. When authorized, also handle assigned [parameter merge tasks](parameter-management.md#advance-staged-requests). |
| Hardware committer (`hardware-committer`) | After [approval](account-and-access.md#wait-for-committer-approval), use the workflows in the hardware-user row and handle assigned [hardware reviews](parameter-management.md#advance-staged-requests). When authorized, also write nodes and run reloads and restores in [Device debugging](device-debugging.md). |
| Software committer (`software-committer`) | After [approval](account-and-access.md#wait-for-committer-approval), use the workflows in the hardware-user row and handle assigned [software reviews and merges](parameter-management.md). When authorized, also write nodes and run reloads and restores in [Device debugging](device-debugging.md). |
| Organization Admin (`admin`) | Follow [Organization administration and governance](organization-and-governance.md) to manage members, approve registrations, inspect audits, and maintain business modules. Manage [parameters and configuration](parameter-management.md) and [knowledge](knowledge.md), and use the engineering workflows above within scope. |
| Platform Admin (`platform-admin`) | Use the Admin workflows above within each guide's scope. See [Organization administration and governance](organization-and-governance.md) for protected roles and the registration queue's cross-Organization caveat. |

## Workflows

- [Account and access](account-and-access.md): local registration, Committer approval, password changes and resets, and deployment-provided OIDC sign-in.
- [Parameter management](parameter-management.md): search and comparison, drafts, submission and review, project initialization, imports, and configuration releases.
- [Device debugging](device-debugging.md): connect HDC/ADB devices, read and safely write nodes, test DTS reloads, restore baselines, and inspect evidence.
- [Log analysis](log-analysis.md): upload logs, track analysis progress, distinguish degraded results, inspect evidence, give feedback on quality, and create knowledge drafts.
- [Knowledge](knowledge.md): search and ask Xiaoze, create and publish entries, upload files, manage revisions and archives, and check index health.
- [Xiaoze](xiaoze.md): ask grounded questions, inspect sources, edit proposals, and approve or reject Agent actions.
- [Organization administration and governance](organization-and-governance.md): manage members and Committer approvals, investigate audits, maintain business modules, and send product feedback.

## Find the right reference

- [Knowledge base](../README.md): developer and operator reading paths.
- [Authentication reference](../api/authentication.md): identity and local-account contracts.
