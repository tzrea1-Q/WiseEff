# Design Docs Index

Design docs explain how WiseEff works and why major boundaries exist. Product requirements live in `../product-specs/`; execution plans live in `../exec-plans/`.

Current baseline: M0-M5 productization work is merged. These docs should describe both implemented seams and remaining external pilot evidence, especially where production infrastructure still depends on staging/device-lab/cloud-provider setup.

## Core Operating Beliefs

- [Core Beliefs](core-beliefs.md): agent-first repository knowledge, architecture boundaries, and verification expectations.

## Current Architecture

- [Full-Stack Architecture](full-stack-architecture.md): recommended runtime architecture and module boundaries.
- [Domain Model](domain-model.md): entities, state machines, and consistency rules.
- [API Contract](api-contract.md): REST conventions, endpoint shape, error model, Agent/device contracts.
- [Testing Strategy](testing-strategy.md): test layers, E2E scenarios, contract tests, reliability checks.
- [Deployment Operations](deployment-operations.md): environments, CI/CD, health checks, monitoring, backup, rollback.
- [Security Governance](security-governance.md): identity, authorization, audit, Agent safety, device safety, data protection.

## Historical Feature Designs

- `2026-05-07-light-homepage-color-refresh-design.md`
- `2026-05-07-parameter-management-homepage-design.md`
- `2026-05-07-wiseeff-icon-design.md`
- `2026-05-10-parameter-admin-redesign-design.md`
- `2026-05-10-parameter-comparison-redesign-design.md`
- `2026-05-15-node-debugging-design.md`
- `2026-05-17-user-permissions-design.md`
- `2026-05-20-project-parameter-initialization-design.md`
- `2026-05-21-parameter-comparison-modal-design.md`
- `2026-05-23-parameter-draft-dialog-redesign-design.md`
- `2026-05-24-parameter-personal-workbench-design.md`

## Maintenance Rules

- Add a design doc when a change affects user workflows, architecture, security, reliability, or cross-module contracts.
- Keep design docs linked from this index.
- If implementation diverges from a design, update the design or move the obsolete detail into the completed plan notes.
