# WiseEff Product Spec

> Chinese: [Chinese](../zh-CN/product-specs/product-spec.md)

WiseEff is an AI-assisted enterprise efficiency platform for governed engineering workflows. It focuses on parameter management, log analysis, debugging, and the knowledge base, with an Agent layer that can help search, summarize, prepare drafts, and explain evidence while humans retain approval over risky changes.

## Users

- Hardware engineers review and prepare parameter changes, device reads, and debugging evidence.
- Software engineers review software-side parameter impact, logs, and workflow status.
- Committers review and approve high-risk parameter changes.
- Admins govern users, permissions, project configuration, audit, and pilot readiness.
- Operators collect staging, self-hosted, backup, rollback, monitoring, and device-lab evidence.

## Core Workflows

### Parameter Management

Developers can browse project parameters, inspect current/recommended values, create drafts, submit rounds, route reviews, merge approved changes, import/export governed data, and inspect history/audit evidence. **New projects** go through governed parameter initialization (semantic binding snapshot or empty library → Admin approve/reject) before normal typed binding submits unlock. Parameter and debugging **module taxonomies** are multi-level trees per domain; parent module filters include descendant assignments.

### Log Analysis

Users upload logs — optionally bound to an Admin-registered log domain (business-specific format profile and analysis emphasis; unbound uploads use the built-in uncategorized domain) — track staged analysis, review evidence-grounded reports with visible analyzer provenance, archive or rerun records, and capture feedback. Analysis runs on an LLM kernel whose conclusions must cite real log lines; when the provider is unavailable or the budget cannot produce a grounded answer, the result degrades to the deterministic rule engine and is clearly marked as a degraded analysis instead of impersonating a full one. Production-oriented flows store raw files through the object-store seam and job state in PostgreSQL.

### Debugging

**Node debugging** (`/node-debugging`) connects to simulator or HDC/ADB-backed targets, reads safe nodes, prepares writes with range/risk checks, captures undoable snapshots, verifies readback, and records operation history. Device writes remain human-approved and audited.

**Parameter debugging** (`/dts-reload`, shell title/nav **Parameter debugging**) validates candidate library parameter values on a real device by generating, compiling, and deploying a debug overlay through the local device bridge, then capturing a reload snapshot (baselines, artifact integrity, optional kernel log, behavioural verification). Debug values never mutate the parameter library. Sensitive-node rules and `confirm-dts-reload` / `confirm-sensitive-reload` gate privileged steps. Admins govern reload configuration on `/debugging-admin` (parameter-debug scope; node catalog at `/debugging-admin/nodes`). The technical capability remains DTS overlay reload and must not be confused with the retired M1-era parameter-reload surface.

**Legacy parameter debugging workspace** (`/debugging`) remains product-offline (TD-032). Do not confuse it with the `/dts-reload` product title.

### Knowledge Base

The knowledge base (`/knowledge`) is the organization-scoped home for enterprise engineering knowledge: tuning experience, fault cases, hardware manuals, and process norms. Entries are flat and multi-tagged (project tags included) in exactly one content form — `markdown` written in the product's split edit/preview editor, or `file` uploaded through the object store with server-side text extraction and a visible extraction status. The lifecycle is `draft → published → archived`: every save produces an immutable revision, restore brings a prior revision back as a new revision, and publishing is the single gate into search — drafts and archived entries never appear in results. `knowledge:view` is the default for organization members, `knowledge:edit` governs own entries, and `knowledge:manage` governs any entry including audited hard delete from `/knowledge-admin`. Xiaoze grounds knowledge questions in published entries with cited sources, and knowledge flows back in through the distillation loop: a completed log-analysis conclusion becomes a pre-filled draft through the distil-to-knowledge action on the log result page, and Xiaoze can distil conversation outcomes into new drafts through the approval-gated `action.createKnowledgeDraft` tool. Agent drafts land in the `/knowledge-admin` publish queue (creator, session origin, source analysis link) where the distilling engineer (`knowledge:edit`, own sessions) or a knowledge manager publishes or archive-rejects them — a human always publishes.

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
