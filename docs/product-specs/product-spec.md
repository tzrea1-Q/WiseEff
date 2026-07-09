# WiseEff Product Spec

> Chinese: [Chinese](../zh-CN/product-specs/product-spec.md)

WiseEff is an AI-assisted enterprise efficiency platform for governed engineering workflows. It focuses on parameter management, log analysis, and debugging, with an Agent layer that can help search, summarize, prepare drafts, and explain evidence while humans retain approval over risky changes.

## Users

- Hardware engineers review and prepare parameter changes, device reads, and debugging evidence.
- Software engineers review software-side parameter impact, logs, and workflow status.
- Committers review and approve high-risk parameter changes.
- Admins govern users, permissions, project configuration, audit, and pilot readiness.
- Operators collect staging, self-hosted, backup, rollback, monitoring, and device-lab evidence.

## Core Workflows

### Parameter Management

Developers can browse project parameters, inspect current/recommended values, create drafts, submit rounds, route reviews, merge approved changes, import/export governed data, and inspect history/audit evidence. Parameter and debugging **module taxonomies** are multi-level trees per domain; parent module filters include descendant assignments.

### Log Analysis

Users upload logs, track staged analysis, review evidence and reports, archive or rerun records, and capture feedback. Production-oriented flows store raw files through the object-store seam and job state in PostgreSQL.

### Debugging

Users connect to simulator or HDC-backed targets, read safe nodes, prepare writes with range/risk checks, capture snapshots, verify readback, and record operation history. Device writes remain human-approved and audited.

### Agent Assistance

The Agent may summarize context, search project data, propose drafts, and explain evidence. Mutating tool calls require WiseEff approval records and backend authorization; model output never bypasses product permissions.

## Non-Functional Requirements

- Server-side authz and audit for production writes.
- PostgreSQL as the source of truth.
- Mock runtime retained for demos and component tests only.
- API runtime for productized behavior.
- Target-environment evidence for pilot, release, rollback, queue, observability, backup, HDC, and live provider claims.

## Acceptance

MVP acceptance requires deterministic tests, API contract checks, browser acceptance evidence, manual acceptance where required, and honest readiness states when external target evidence is missing.
