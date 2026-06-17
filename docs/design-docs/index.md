# Design Docs Index

> Chinese: [Chinese](../zh-CN/design-docs/index.md)

Design docs explain how WiseEff works and why major boundaries exist. Product requirements live in `../product-specs/`; execution plans live in `../exec-plans/`.

Current baseline: M0-M5 productization work is merged. These docs should describe both implemented seams and remaining external pilot evidence, especially where production infrastructure still depends on staging/device-lab/cloud-provider setup.

## Core Operating Beliefs

- [Core Beliefs](core-beliefs.md): agent-first repository knowledge, architecture boundaries, and verification expectations.

## Current Architecture

| Status | Document | Purpose |
| --- | --- | --- |
| Current | [Full-Stack Architecture](full-stack-architecture.md) | Recommended runtime architecture and module boundaries. |
| Current | [Domain Model](domain-model.md) | Entities, state machines, and consistency rules. |
| Current | [API Contract](api-contract.md) | REST conventions, endpoint shape, error model, Agent/device contracts. |
| Current | [Testing Strategy](testing-strategy.md) | Test layers, E2E scenarios, contract tests, reliability checks. |
| Current | [Deployment Operations](deployment-operations.md) | Environments, CI/CD, health checks, monitoring, backup, rollback. |
| Current | [Security Governance](security-governance.md) | Identity, authorization, audit, Agent safety, device safety, data protection. |
| Current | [Audit Center Design](2026-06-17-audit-center-design.md) | Audit evidence model, module/org audit IA, API, and phased delivery. |

## Historical Feature Designs

These are implementation and design history. They are useful context, but current behavior is governed by the current architecture docs, product specs, source code, tests, and generated artifacts.

| Status | Document |
| --- | --- |
| Historical | `2026-05-07-light-homepage-color-refresh-design.md` |
| Historical | `2026-05-07-parameter-management-homepage-design.md` |
| Historical | `2026-05-07-wiseeff-icon-design.md` |
| Historical | `2026-05-10-parameter-admin-redesign-design.md` |
| Historical | `2026-05-10-parameter-comparison-redesign-design.md` |
| Historical | `2026-05-15-node-debugging-design.md` |
| Historical | `2026-05-17-user-permissions-design.md` |
| Historical | `2026-05-20-project-parameter-initialization-design.md` |
| Historical | `2026-05-21-parameter-comparison-modal-design.md` |
| Historical | `2026-05-23-parameter-draft-dialog-redesign-design.md` |
| Historical | `2026-05-24-parameter-personal-workbench-design.md` |

## Maintenance Rules

- Add a design doc when a change affects user workflows, architecture, security, reliability, or cross-module contracts.
- Keep design docs linked from this index.
- If implementation diverges from a design, update the design or move the obsolete detail into the completed plan notes.
