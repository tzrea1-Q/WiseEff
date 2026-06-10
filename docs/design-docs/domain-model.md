# WiseEff Domain Model

> Chinese: [Chinese](../zh-CN/design-docs/domain-model.md)

Date: 2026-05-25

## Modeling Principles

The product model separates prototype display data into durable, auditable business entities. Parameter definitions differ from project parameter values; submission rounds differ from individual change requests; log files, analysis runs, stages, and evidence are separate; devices, sessions, snapshots, and node operations are separate; Agent sessions, messages, tool calls, approvals, and traces are separate.

## Core Domains

- Organization and users define tenant boundaries, identity source bindings, role bindings, and disabled-user behavior.
- Projects group modules, members, and workflow state.
- Parameter management centers on definitions, project values, drafts, submission rounds, change requests, review decisions, imports, history, and audit.
- Log analysis separates uploaded object references, business records, analysis runs, stages, evidence, archive state, and feedback.
- Debugging separates devices, detected targets, debug parameters, sessions, snapshots, node operations, and events.
- Agent state separates sessions, messages, tool calls, approvals, and run traces.
- Audit events connect cross-domain writes through actor, target, action, severity, metadata, and trace ID.

## State Machines

Parameter requests, log analysis runs, debugging sessions, and Agent approvals should move through explicit states. Tests and browser acceptance should verify invalid transitions, terminal-state behavior, and audit invariants.
