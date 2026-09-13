# Design Docs Index

> Chinese: [Chinese](../zh-CN/design-docs/index.md)

Design docs explain how WiseEff works and why major boundaries exist. Product requirements live in `../product-specs/`; execution plans live in `../exec-plans/`.

The [technical entry](full-stack-architecture.md) and [test-design entry](testing-strategy.md) were source-reviewed at `67d4a77325b6009b77c2373bd788298a6d022bcf` on 2026-09-06. They consolidate current system explanation and risk-based test design within the existing documentation set. Specialist documents retain their own subject ownership; historical designs are preserved. A locked contract describes intended invariants, not whether all or none of its implementation is present. Deployment/cutover and target evidence require separate verification.

## Core Operating Beliefs

- [Core Beliefs](core-beliefs.md): agent-first repository knowledge, architecture boundaries, and verification expectations.

## Current Architecture

<!-- prettier-ignore -->
| Status | Document | Purpose |
| --- | --- | --- |
| Locked decision | [Parameter Catalog Verification, Upgrade, and Retirement Gates](parameter-catalog-verification-upgrade-retirement-gates.md) | One Release Verification seam, V01-V17 and D01-D09 release gates, API/browser acceptance, self-hosted recovery, observability, evidence hierarchy, and staged legacy retirement. |
| Locked CP-00 contract | [Catalog Authoring and Publication Control Plane](catalog-authoring-and-publication-control-plane.md) | In-product ChangeSet authoring, frozen Artifact/Candidate/Authorization/Job/Receipt, unique synchronizer activation, and dual application/Catalog readiness. Not implementation evidence. |
| Current | [Technical Compendium](full-stack-architecture.md) | Integrated Markdown: 13 chapters, 22 Mermaid diagrams, interfaces, domain relationships, sequences, concurrency, failure recovery and operations. |
| Current | [Domain Model](domain-model.md) | Entities, state machines, and consistency rules. |
| Locked target contract | [Catalog Kernel Interface and Transaction Boundary](catalog-kernel-interface-and-transaction-boundary.md) | Deep catalog module seam, tagged results, transaction ownership, permissions, caches, and test surface for the Wayfinder replacement; implementation status is established by the technical entry and current source, not this contract label. |
| Current | [API Contract](api-contract.md) | REST conventions, endpoint shape, error model, Agent/device contracts. |
| Locked decision | [Parameter Catalog API and Legacy-Identifier Transition](parameter-catalog-api-transition.md) | Canonical `/api/v2/catalog/*` resources, permissions, DTO states, typed legacy-ID mapping, consumer migration, and bounded retirement rules. |
| Current | [Testing Strategy](testing-strategy.md) | Testing entry: risks, environment/data, 20 executable design scenarios, automation traceability and outcome rules. |
| Current | [Deployment Operations](deployment-operations.md) | Environments, CI/CD, health checks, monitoring, backup, rollback. |
| Implemented locally | [Self-Hosted One-Command Upgrade](2026-08-20-self-hosted-one-command-upgrade-design.md) | Source-checkout upgrade seam: immutable target, prebuild, quiescence, verified recovery point, full data-preserving restart, resume/recovery. Non-customer target rehearsal remains required evidence. |
| Locked decision | [Parameter Catalog Cutover, Archive, and Rollback](parameter-catalog-cutover-archive-rollback.md) | P0-P16 populated-data maintenance workflow, typed legacy dispositions, mandatory P11 semantic dual-read comparison, Archive, recovery, and self-hosted ordering contract. |
| Current | [Security Governance](security-governance.md) | Identity, authorization, audit, Agent safety, device safety, data protection. |
| Current | [Audit Center Design](2026-06-17-audit-center-design.md) | Audit evidence model, module/org audit IA, API, and phased delivery. |
| Current | [DTS Parameter Management Assessment](2026-07-14-dts-parameter-management-assessment.md) | Current-state problem inventory and locked positioning decisions for DTS/JSON tree parameter management (planning input). |
| Current | [DTS Parameter Surface Boundary RFC](2026-07-21-dts-parameter-surface-boundary-rfc.md) | Product boundary: manageable parameter surface, module-centric UX, DTS text maintenance, optional L2 toolchain (revises 2026-07-14 locks). |
| Current | [DTS Capability Cut Matrix](2026-07-21-dts-capability-cut-matrix.md) | Keep / demote / remove-from-hot-path matrix for topology, schema, toolchain, and UI capabilities. |
| Current | [Project-Primary DTS Contract RFC](2026-07-21-project-primary-dts-contract-rfc.md) | Upload one project DTS; writeback always that final text; retire platform synthetic base; admin owns module↔driver only. |
| Locked design | [Project Configuration Workbench](2026-08-06-project-configuration-workbench-design.md) | Replace the four-view project-operations dialog with one config-set/source-centered full-screen workbench; includes state and migration contracts. |
| Locked design | [Knowledge Base](2026-08-12-knowledge-base-design.md) | Organization-scoped agentic knowledge base: flat tagged entries, wiki-lite lifecycle, published-only hybrid retrieval (ADR-0025), Xiaoze tools with citations, distillation loop. |
| Locked design | [Organization Administration](2026-08-19-organization-administration-design.md) | Home-organization tenant operations: membership, onboarding, display name. Distinct from Organization-scoped governance (ADR-0037). |
| Locked decisions | [Parameter governance deferred questions](2026-07-30-parameter-governance-deferred-questions.md) | D1–D8 plus TD-117 / TD-063 locked 2026-08-18 (ADR-0032–0035). Implementation input only; no code in that lock. |
| Current | [DTS Follow-up Scheme (Hardening + Import)](2026-07-15-dts-followup-scheme.md) | Post–P0–P3.1 follow-up scheme: hardening closeout (B) and import-wizard TD-035 alignment (C); Git publish deferred. |
| Current | [Table Column Multi-Select Filter UX](ux-table-column-filter.md) | Standard header funnel + checkbox filter (`ColumnFilter`); reuse for all similar table column filters. |
| Current | [UI Design System](ui-design-system.md) | Operational visual standard: design tokens, component contracts, interaction states, motion, layout, and content language for every product surface. |

## Historical Feature Designs

These are implementation and design history. They are useful context, but current behavior is governed by the current architecture docs, product specs, source code, tests, and generated artifacts.

| Status     | Document                                                |
| ---------- | ------------------------------------------------------- |
| Historical | `2026-05-07-light-homepage-color-refresh-design.md`     |
| Historical | `2026-05-07-parameter-management-homepage-design.md`    |
| Historical | `2026-05-07-wiseeff-icon-design.md`                     |
| Historical | `2026-05-10-parameter-admin-redesign-design.md`         |
| Historical | `2026-05-10-parameter-comparison-redesign-design.md`    |
| Historical | `2026-05-15-node-debugging-design.md`                   |
| Historical | `2026-05-17-user-permissions-design.md`                 |
| Historical | `2026-05-20-project-parameter-initialization-design.md` |
| Historical | `2026-05-21-parameter-comparison-modal-design.md`       |
| Historical | `2026-05-23-parameter-draft-dialog-redesign-design.md`  |
| Historical | `2026-05-24-parameter-personal-workbench-design.md`     |

## Maintenance Rules

- Add a design doc when a change affects user workflows, architecture, security, reliability, or cross-module contracts.
- Keep design docs linked from this index.
- If implementation diverges from a design, update the design or move the obsolete detail into the completed plan notes.
