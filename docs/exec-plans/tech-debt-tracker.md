# Technical Debt Tracker

This tracker captures known work that should not live only in chat or TODO comments. Keep items short, linked, and actionable.

## Open

| ID | Area | Debt | Impact | Next Action |
| --- | --- | --- | --- | --- |
| TD-001 | Runtime | Mock mode still carries most business workflows. | Production behavior can drift from demo behavior unless API seams keep improving. | Continue M1 parameter API migration through `ParameterRepository`. |
| TD-002 | Backend | M0 backend covers auth context and audit skeleton only. | Productized workflows still need real project, parameter, log, debugging, Agent modules. | Follow `active/development-roadmap.md` and create focused M1 plans. |
| TD-003 | Contracts | API contract is documented and guarded by a static route manifest, but not yet generated from schema/client tooling. | Frontend DTOs and backend responses can drift as endpoints grow beyond the manifest. | Introduce OpenAPI or schema generation before the next broad API surface. |
| TD-004 | Generated Docs | `docs/generated/db-schema.md` is manually derived from migration. | Schema summary can become stale if migrations change. | Add a script or CI check when migrations expand. |
| TD-005 | Doc Hygiene | Some historical feature plans are now in completed plans but may not state implementation status clearly. | Future agents may over-trust old implementation details. | Review completed plans during related feature work and mark superseded sections. |
| TD-007 | Log Worker | M2 worker is an in-process polling loop with database leases but without a separate durable queue service. | Multiple API processes are protected by job leases, but crashed workers still rely on lease expiry and later process logic. | Add retry/backoff policy, dead-letter handling, and a dedicated worker/queue deployment. |
| TD-008 | Contracts | Log-analysis client and DTOs are handwritten. | API/frontend drift can break M2 E2E late. | Generate or validate an OpenAPI client for M1/M2 endpoints. |
| TD-009 | AI Adapter | M2 analysis is deterministic fixture/rule-driven logic. | Product behavior does not yet exercise real model latency, cost, hallucination controls, or prompt/version traceability. | Add an AI adapter boundary with golden tests and model trace metadata. |
| TD-012 | Contracts | Parameter, log, debugging, and Agent HTTP clients/DTOs are handwritten. | API/frontend drift can break acceptance late and duplicate schema rules. | Generate an OpenAPI client or add schema contract validation across M1-M4 endpoints. |
| TD-013 | Agent Approvals | M4 covers persisted approval records for Agent tools, but standalone device writes still use confirmation tokens rather than Agent approval ids. | Future Agent/device convergence could split approval evidence across two models. | Unify high-risk device writes with approval records when Agent-driven device tools are enabled. |
| TD-014 | Debugging Catalog | M3 seeds the debugging parameter catalog; CRUD/governance is not productized. | Operators cannot safely manage node definitions, access modes, or risk metadata outside seed scripts. | Add catalog CRUD with admin permissions, validation, import/export, and audit. |
| TD-015 | Debugging UI Runtime | API write snapshots from `/node-debugging` are not promoted into `/debugging` rollback card state. | The backend rollback path works, but the cross-page UI rollback affordance may stay disabled after a node-debugging write. | Hydrate valid latest snapshots into frontend runtime state and enable the rollback confirmation UI. |
| TD-019 | Release Operations | M5 now has a pilot readiness route and smoke command, but the repo still needs real staging evidence for backup, device-lab, and pilot signoff. | The code can report blocked gates correctly, but commercial pilot readiness should not be claimed from local checks alone, and local smoke skips must be explicit. | Run the M5 smoke in staging or against a live API, record the external evidence in `docs/generated/m5-pilot-acceptance.md`, and keep the rollback drill current. |
| TD-018 | Agent API Clients | Agent API clients and DTO mappers are not generated while TD-012 remains broad. | Agent session/tool/approval envelopes can drift from backend schemas as the surface expands. | Include Agent endpoints in the generated OpenAPI client or add contract tests that validate frontend DTOs against server schemas. |

## Completed

| ID | Area | Resolution |
| --- | --- | --- |
| TD-000 | Knowledge Base | Reorganized product, design, execution, generated, and reference docs into harness-style structure on 2026-05-25. |
| TD-006 | Log Storage | M5 added `OBJECT_STORE_MODE=s3`, an S3/OSS-compatible adapter seam, a minimal HTTP HEAD/GET/PUT transport with WiseEff signing headers, checksum/retention/encryption metadata, and readiness checks. Cloud SDK/SigV4 wiring, provider bucket provisioning, lifecycle/KMS policy, replication, and credential rotation remain deployment work. |
| TD-017 | Agent Provider | M5 added the live provider registry seam, provider trace metadata, health fallback handling, and safety tests. Prompt optimization and broader eval coverage remain future work. |
| TD-011 | Debugging Safety | M3.5 added `debug_device_leases`, acquisition/release helpers, and service-level conflict handling before node writes and rollback. |
| TD-016 | Commercial Readiness | M3.5 added health/readiness endpoints, production config gates, route manifest tests, object-store readiness, job/device leases, and request/audit correlation. |
| TD-010 | Debugging Gateway | M5 added an HDC adapter behind `DebugDeviceGateway`, production env gates, argv-safe command execution, timeout/stderr/nonzero normalization, and fake-runner coverage. Real hardware evidence remains a pilot/device-lab acceptance artifact. |
