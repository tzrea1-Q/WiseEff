# ADR-0030: Projects are a standalone module

- Status: Accepted
- Date: 2026-08-13

## Context

The project entity (`projects`, `project_modules` tables) is the organization-scoped container that parameter workflows, topology, files, and debugging surfaces all hang off — it is not parameter-workflow state. Its repository nevertheless lived inside `server/modules/parameters/` (as `projectRepository.ts`, split out of the god repository in slice 1 of the parameters repository split), so every other domain that needed a project row had to import the parameters module. After the ADR-0028 kernel moves, exactly one parameters↔parameter-topology cycle edge remained: `parameter-topology/service.ts` importing `getProjectById` from `parameters/projectRepository`. Topology has no reason to depend on the submission/review workflow module just to resolve a project.

## Decision

Project reads and CRUD live in a standalone, routes-less `server/modules/projects/` module: `repository.ts` (the former `parameters/projectRepository.ts`, moved verbatim) and `types.ts` (the project DTO vocabulary — `ProjectDto`, `ProjectAdminSummaryDto`, `ProjectAdminDetailDto`, `ProjectModuleDto` — moved verbatim out of `parameters/types.ts`). There are no compatibility re-exports; every import site points at `projects/` directly.

The module boundary is the entity, not the admin workflow: project-admin HTTP endpoints stay in `parameters/routes.ts` and the authz- and audit-wrapping project admin service stays in `parameters/projectService.ts`; both import from `projects/`. Import rule: `projects/` may import only node/deps, `server/shared/**`, `server/modules/auth/**`, and `parameter-kernel` (it uses the identity-mode seam and the transitional legacy-identity adapter for pre-cutover project deletion) — never `parameters`, `parameter-topology`, `parameter-files`, or `parameter-drafts`.

## Consequences

- The fifth and final parameters↔parameter-topology cycle edge is gone: `parameter-topology/service.ts` resolves projects from `projects/repository`. Combined with the ADR-0028 kernel moves, `parameter-topology` non-test code imports nothing from `parameters`; the dependency between the two workflow modules is now one-directional (`parameters` → `parameter-topology` write-lock/initialization/migration imports remain).
- Other domains can read projects without touching parameter workflow code; `parameters` consumers of project rows (`routes.ts`, `service.ts`, `projectService.ts`) import from `projects/` like everyone else.
- The module registers no routes: the `RouteModule` union in `contracts/routeManifest.ts` is unchanged.
- Pre-cutover project deletion keeps its transitional dependency on the kernel legacy-identity adapter; the TD-042 cutover deletion sweep is unaffected (kernel paths unchanged).
