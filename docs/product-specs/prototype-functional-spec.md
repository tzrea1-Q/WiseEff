# WiseEff Prototype Functional Spec

> Chinese: [Chinese](../zh-CN/product-specs/prototype-functional-spec.md)

This document describes the prototype behavior that should remain understandable while WiseEff moves toward productized API and operations paths.

## Runtime Boundary

The frontend can run in mock mode for demos and component tests or API mode for productized workflows. Mock data is not a production business data source.

## Parameter Prototype

The prototype supports parameter browsing, filtering, detail/history inspection, draft editing, submission, review, admin governance, import/export affordances, and audit-oriented UI patterns. API-mode work should preserve these user expectations while moving durable writes to backend routes.

## Log Prototype

The log workflow supports upload, staged progress, report/evidence display, history/admin actions, feedback, rerun/archive states, and failure display. Productized behavior uses object storage, worker/job state, and API polling or event seams.

## Debugging Prototype

Debugging supports target discovery, node reads, guarded writes, readback, snapshots, rollback preparation, and operation history. Simulator mode remains useful for tests; HDC evidence is required for real-device claims.

## Agent Prototype

The Agent panel can provide contextual help and propose actions. Productized Agent behavior must route through backend sessions, tool registries, approvals, and audit.

## Compatibility Rule

When replacing mock behavior with API-backed behavior, preserve the user-visible workflow unless a product plan explicitly changes it.
