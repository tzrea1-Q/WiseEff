# ADR-0029: Parameter platform primitives live in a standalone kernel module

- Status: Accepted
- Date: 2026-08-12

## Context

After the parameters repository split (slices 1–3, PRs #321/#340 + the `parameter-drafts` module, ADR-0027), the remaining parameters↔parameter-topology cycle ran entirely through cross-cutting primitives that lived inside `server/modules/parameters/` but were consumed platform-wide: the parameter identity-mode seam (`parameterIdentityMode.ts`), the authorization predicates (`policy.ts`), the sensitive-node write gate (`sensitiveNode.ts`), and the transitional legacy-identity compatibility layer (`legacyParameterIdentityNames.ts`, `legacyParameterIdentityAdapter.ts`). Consumers outside `parameters` at the time of this decision: `parameter-topology` (edit service, routes, service, local post-cutover), `parameter-files` (sync, writeback, conflict, baseline/export/config-set services, routes), `parameter-drafts` (repository), `parameter-specs` and `parameter-modules` (policy predicates), `dts-reload` (policy + sensitive gate), `debugging` (repository), `logs` (worker runner), `agent` (action tools), plus API boot (`server/index.ts`) and the test harness. None of these primitives is workflow logic; they are the platform vocabulary the workflows share.

## Decision

Cross-cutting parameter primitives live in a standalone, routes-less kernel module, `server/modules/parameter-kernel/`. Kernel files may import only node/deps, `server/shared/**`, `server/modules/auth/**` (auth context types and permission helpers), the audit write boundary, and each other — never `parameters`, `parameter-topology`, `parameter-files`, or `parameter-drafts`. There are no compatibility re-exports; every import site points at the kernel directly.

The kernel is populated by verbatim file moves, gated on that import rule:

- **Moved now (import-clean):** `parameterIdentityMode.ts` (identity-mode seam), `legacyParameterIdentityNames.ts` and `legacyParameterIdentityAdapter.ts` (the explicitly transitional pre-cutover compatibility layer).
- **Designated but deferred:** `policy.ts` still imports the `ParameterChangeRequestStatus` type from `parameters/status.ts`, and `sensitiveNode.ts` still imports `nodePathFromSourceNodePath` from `parameters/impact.ts`. Moving them today would carry kernel→parameters back-edges, relabeling the cycle instead of breaking it; they move in a follow-up slice once those two leaf dependencies are re-homed.

## Consequences

- The identity edges of the parameters↔parameter-topology cycle are gone: `parameter-topology/{editService,localPostCutover}.ts`, `parameter-drafts/repository.ts`, `parameter-files/{syncService,writebackService}.ts`, `debugging/repository.ts`, `logs/workerRunner.ts`, and `agent/tools/actionTools.ts` import the identity seam from the kernel, not from `parameters`. `parameter-drafts` now imports nothing from `parameters` or `parameter-topology`, completing its ADR-0027 invariant.
- The cycle is not yet fully broken: `parameter-topology` still imports `policy` (routes, service, edit service), `sensitiveNode` (edit service), and `getProjectById` from `parameters/projectRepository` (service). Those edges close with the deferred `policy`/`sensitiveNode` move and a project-read decision, not with this slice.
- The legacy portion of the kernel (`legacyParameterIdentityNames.ts`, `legacyParameterIdentityAdapter.ts`) is explicitly transitional and is deleted at the TD-042 identity cutover; post-cutover deletion is now one directory-scoped act instead of a hunt through `parameters`. The `legacyDependencyGuard` allowlist tracks the kernel paths.
- The kernel registers no routes: the `RouteModule` union in `contracts/routeManifest.ts` is unchanged.
