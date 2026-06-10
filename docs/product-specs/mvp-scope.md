# WiseEff MVP Scope

> Chinese: [Chinese](../zh-CN/product-specs/mvp-scope.md)

WiseEff MVP scope is split into staged productization milestones. Each milestone should preserve demo value while moving durable business behavior behind API, auth, audit, and verification seams.

## M0 Foundation

Backend skeleton, database migrations, user/auth context, audit baseline, frontend API client foundation, runtime mode switch, and initial CI quality gates.

## M1 Parameter Management

Parameter data model, parameter list/detail/history APIs, drafts, submission rounds, review flow, merge/history/audit behavior, imports, and API-backed frontend repository.

## M2 Log Analysis

File upload/object storage seam, log records, analysis jobs, worker processing, staged progress, evidence/report generation, retry/failure/archive/feedback behavior, and API-backed frontend repository.

## M3 Debugging

Device gateway seam, simulator, target detection, node reads/writes, snapshots, rollback, guarded writes, readback handling, and API-backed debugging UI.

## M4 Agent Collaboration

Agent sessions, messages, tool registry, approval records, tool execution audit, contextual frontend panel, deterministic provider for tests, and live provider seam.

## M5/M6 Readiness

Commercial pilot and self-hosted hardening add contract checks, production auth boundaries, worker/object-store/queue seams, HDC evidence, live provider evidence, backup/restore, rollback, observability, release, and capacity gates.

## Non-Goals

The MVP does not claim broad enterprise production readiness without real target evidence, full SSO/OIDC validation, durable operational proof, and HDC/device-lab signoff.
