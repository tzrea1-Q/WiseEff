# Technical Debt Tracker

This tracker captures known work that should not live only in chat or TODO comments. Keep items short, linked, and actionable.

## Open

| ID | Area | Debt | Impact | Next Action |
| --- | --- | --- | --- | --- |
| TD-001 | Runtime | Mock mode still carries most business workflows. | Production behavior can drift from demo behavior unless API seams keep improving. | Continue M1 parameter API migration through `ParameterRepository`. |
| TD-002 | Backend | M0 backend covers auth context and audit skeleton only. | Productized workflows still need real project, parameter, log, debugging, Agent modules. | Follow `active/development-roadmap.md` and create focused M1 plans. |
| TD-003 | Contracts | API contract is documented but not yet enforced by generated schema/client. | Frontend DTOs and backend responses can drift as endpoints grow. | Keep this open after M1 parameter acceptance; introduce OpenAPI or schema generation before the next broad API surface. |
| TD-004 | Generated Docs | `docs/generated/db-schema.md` is manually derived from migration. | Schema summary can become stale if migrations change. | Add a script or CI check when migrations expand. |
| TD-005 | Doc Hygiene | Some historical feature plans are now in completed plans but may not state implementation status clearly. | Future agents may over-trust old implementation details. | Review completed plans during related feature work and mark superseded sections. |
| TD-006 | Log Storage | M2 uses local filesystem object storage through `OBJECT_STORE_ROOT`. | Local/staging behavior does not prove object retention, encryption, lifecycle, or multi-node access. | Replace with production object storage adapter and retention policy. |
| TD-007 | Log Worker | M2 worker is an in-process polling loop without distributed locks. | Multiple API processes could double-process jobs; crashed workers rely on later process logic. | Introduce durable queue leasing, retry/backoff policy, and worker ownership locks. |
| TD-008 | Contracts | Log-analysis client and DTOs are handwritten. | API/frontend drift can break M2 E2E late. | Generate or validate an OpenAPI client for M1/M2 endpoints. |
| TD-009 | AI Adapter | M2 analysis is deterministic fixture/rule-driven logic. | Product behavior does not yet exercise real model latency, cost, hallucination controls, or prompt/version traceability. | Add an AI adapter boundary with golden tests and model trace metadata. |
| TD-010 | Debugging Gateway | M3 uses the simulator gateway for acceptance. | Simulator proves the loop but not real HDC discovery, command timeout, stderr normalization, or device-lab rollout. | Add a production HDC gateway adapter behind the existing `DebugDeviceGateway` contract. |
| TD-012 | Contracts | Parameter, log, and debugging HTTP clients/DTOs are handwritten. | API/frontend drift can break acceptance late and duplicate schema rules. | Generate an OpenAPI client or add schema contract validation across M1-M3 endpoints. |
| TD-013 | Agent Approvals | Agent approvals are documented but not persisted for debugging writes. | Future Agent/device tools could lack a durable approval chain. | Add approval records and require approval ids for mutating Agent/device tool execution. |
| TD-014 | Debugging Catalog | M3 seeds the debugging parameter catalog; CRUD/governance is not productized. | Operators cannot safely manage node definitions, access modes, or risk metadata outside seed scripts. | Add catalog CRUD with admin permissions, validation, import/export, and audit. |
| TD-015 | Debugging UI Runtime | API write snapshots from `/node-debugging` are not promoted into `/debugging` rollback card state. | The backend rollback path works, but the cross-page UI rollback affordance may stay disabled after a node-debugging write. | Hydrate valid latest snapshots into frontend runtime state and enable the rollback confirmation UI. |

## Completed

| ID | Area | Resolution |
| --- | --- | --- |
| TD-000 | Knowledge Base | Reorganized product, design, execution, generated, and reference docs into harness-style structure on 2026-05-25. |
| TD-011 | Debugging Safety | M3.5 added `debug_device_leases`, acquisition/release helpers, and service-level conflict handling before node writes and rollback. |
