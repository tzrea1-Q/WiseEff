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

## Completed

| ID | Area | Resolution |
| --- | --- | --- |
| TD-000 | Knowledge Base | Reorganized product, design, execution, generated, and reference docs into harness-style structure on 2026-05-25. |
