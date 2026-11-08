# Create drivers within module structure import

> Chinese: [实施方案](../../zh-CN/exec-plans/completed/2026-11-08-module-import-new-drivers.md)

Date: 2026-11-08. User request: extend the existing module-management JSON import so a batch can create business modules and previously nonexistent driver subjects beneath them. Implementation is complete; current candidate verification and merge evidence are recorded in the PR description. Deployment is not included.

## Outcome and contract

Keep the existing import window and update format. Add optional `newDrivers`, at most 128 entries, with a stable package `ref`, exact singular `compatible`, explicit `driverNature` and `instanceCardinality`, optional `displayAlias`, and `placement: { kind: "module", moduleRef }`. The target can be an existing business module or a new module in the same document. Existing `subjects` retain their identity-based semantics. Export metadata and counts remain unchanged.

New drivers are declaration-only Catalog subjects; no parameter definitions, source files or project instances are invented. Reject duplicate refs/compatibles, existing identities, unknown fields, invalid identifiers, missing driver facts, invalid/deleted targets and creation instructions in copy mode with field-level repair diagnostics.

## Publication and organization application

1. Read-only preview validates the complete document and lists module changes, new drivers and their destination paths.
2. A human confirms publishing the driver declarations to the shared Catalog. Revalidate the preview, persist server-owned candidate/ref mapping, and enqueue through the existing publication authorization path. Only publication-manager activates a release.
3. Observe the exact candidate/job activation receipt. Re-uploading the same document resumes the durable mapping; clients cannot supply allocated identities. Lost responses and retries do not create duplicate drivers.
4. Produce a fresh structure preview against the original export baseline and current state. Explicit final confirmation atomically creates modules, registers new subjects, sets placement and records audit/receipt.

Catalog publication and organization application are separate commits. The interface states when drivers are published but organization application remains pending. Failure in the second phase must retain the published identities for recovery. Existing imports without `newDrivers` keep their single-confirmation path.

## Acceptance and ownership

- Backend: schema, durable migration, authorization, declaration validation, publication adapter, receipt/ref resolution, final atomic application and PostgreSQL/HTTP regression tests.
- Frontend: integrated preview, shared-directory publication confirmation, progress/manual refresh, resume by original upload, final confirmation and actionable diagnostics.
- Coordinator: English/Chinese documentation, generated OpenAPI, real API browser journey at 1440×900, integration checks, independent review and PR delivery.
- Verify two nested modules and two drivers without definitions; duplicate/existing identifiers; invalid targets; read-only preview; human/role/tenant boundaries; frozen publication; stale/concurrent changes; lost responses; publication success with failed organization application; replay and audit rollback.
- Browser evidence must show both confirmations and recovery after reload/re-upload; a publication receipt alone is not a completed import.

## Git & PR Workflow

Branch `feat/module-import-create-drivers`, based on `87dd3709340775ac98ec3d7d221594dec2f3dfaa`. One PR; the coordinator owns external writes and merges after current required CI, inspected browser evidence and independent review. User authorization includes implementation, PR and merge. Do not deploy, change live publication policy, or mutate production data.

## Documentation Impact Matrix

| Category | Action | Files and evidence |
| --- | --- | --- |
| Repository maps | No change | `ARCHITECTURE.md`: existing publication and governance module ownership remains. |
| Planning | Update | This plan and its Chinese companion. |
| Product guidance | Update | `docs/user-guide/module-structure-editing.md`, `docs/zh-CN/user-guide/module-structure-editing.md`: fields, example, confirmations and recovery. |
| Architecture | Update | `docs/adr/0054-module-structure-transfer-is-explicit-organization-governance.md` and Chinese companion: explicit authoring extension and two commits. |
| Testing | Review | `docs/developer/verification-matrix.md`: existing native PostgreSQL, browser, static and build gates apply. |
| Reliability / security | Review | `docs/RELIABILITY.md`, `docs/SECURITY.md`: preserve publication-manager ownership, durable retries, current authorization and tenancy. |
| Frontend | Review | `docs/developer/ui-quality-checklist.md`: existing dialogs and 1440×900 observation. |
| Generated contracts | Update | `docs/generated/openapi.json`, `docs/generated/db-schema.md`, including migration `0335_module_structure_driver_publications.sql`. |
| References | Review | `docs/user-guide/parameter-management.md` and Chinese companion: reference the integrated driver-creation entry point. |

## Documentation Update Gate

The guides, ADR, parameter-management entry points and both generated artifacts are updated. The existing verification tiers and 1440×900 UI policy remain unchanged. Existing security/reliability boundaries still own authorization, tenancy, publication activation and transaction rollback; the two-stage recovery behavior is documented in the ADR and guide. Documentation governance and OpenAPI checks passed locally. The database artifact requires the unchanged native pgvector CI comparison because PostgreSQL is unavailable locally. Current test/CI outcomes, independent review and merge state are recorded in the PR description; this plan does not substitute for required acceptance.
