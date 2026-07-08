# WiseEff Prototype Functional Spec

> Chinese: [Chinese](../zh-CN/product-specs/prototype-functional-spec.md)

This document describes the prototype behavior that should remain understandable while WiseEff moves toward productized API and operations paths.

## Runtime Boundary

The frontend can run in mock mode for demos and component tests or API mode for productized workflows. Mock data is not a production business data source.

## Internal Beta Product Feedback

The global sidebar feedback entry opens `FeedbackDialog` so authenticated beta users can report product issues from their current page. The dialog preserves page path and page title, accepts one of four feedback types (`experience`, `data`, `export_submit`, `feature`), requires a description, and supports multiple image attachments for UI or data-quality evidence.

The `/feedback-admin` page is an Admin-only triage workspace. Operators can filter and search feedback, inspect page context and ordered attachments, add an admin note, and move items through `open -> in_progress -> closed`. This feedback loop is product-level beta feedback and must remain separate from log-analysis feedback on `/logs` and `/log-admin`.

## Parameter Prototype

The prototype supports parameter browsing, filtering, detail/history inspection, draft editing, submission, review, admin governance, import/export affordances, and audit-oriented UI patterns. API-mode work should preserve these user expectations while moving durable writes to backend routes.

- **Parameter admin import wizard:** Five-step flow on `/parameter-admin` — Step 1 requires a target project (including create-project); Step 2 accepts `.xlsx`, `.csv`, JSON, or DTS fragments with a parse report; Step 3 provides per-row review (diff, edit, skip); Steps 4–5 batch preview and confirm apply.

## Log Prototype

The log workflow supports upload, staged progress, report/evidence display, history/admin actions, feedback, rerun/archive states, and failure display. Productized behavior uses object storage, worker/job state, and API polling or event seams.

## Debugging Prototype

**Node debugging** (`/node-debugging`) is the supported user path for target discovery, node reads, guarded writes, readback, snapshots, rollback preparation, and operation history.

**Parameter debugging** (`/debugging`) is **temporarily hidden** (2026-07-01): the route resolves to an unavailable page because device **parameter reload** is not implemented end-to-end. `src/DebuggingPage.tsx` remains for future reactivation and component tests. See `docs/exec-plans/completed/2026-07-01-wiseeff-parameter-debugging-platform-redesign.md` and **TD-032**.

Simulator mode remains useful for tests; HDC evidence is required for real-device claims.

## Agent Prototype

The Agent panel can provide contextual help and propose actions. Productized Agent behavior routes through Xiaoze (CopilotKit/AG-UI), backend tool registries, approvals, and audit. API mode always mounts Xiaoze; mock mode has no Agent UI.

## Compatibility Rule

When replacing mock behavior with API-backed behavior, preserve the user-visible workflow unless a product plan explicitly changes it.
