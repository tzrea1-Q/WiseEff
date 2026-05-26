# Quality Score

Date: 2026-05-26

This is a living quality dashboard for WiseEff. Update it when major features land, tests change materially, or a quality gap is closed.

## Current Scores

| Area | Score | Evidence | Main Gap |
| --- | ---: | --- | --- |
| Frontend prototype | 8/10 | Broad Vitest and Testing Library coverage across pages, components, permissions, admin flows, logs, debugging, and Agent UI. | Some workflows remain mock-backed. |
| Backend M0/M1 foundation | 7/10 | TypeScript server skeleton, auth context, audit routes, M1 parameter migrations/services, CORS preflight support, backend tests, and an API-mode Playwright smoke. | E2E currently requires external PostgreSQL setup and API contracts are still handwritten. |
| Product specs | 8/10 | Product spec, prototype spec, MVP scope, onboarding spec. | Future user research and acceptance examples should be added as productization continues. |
| Architecture docs | 8/10 | Full-stack architecture, domain model, API contract, deployment, security, testing docs. | API contract is not yet mechanically enforced. |
| Security model | 7/10 | RBAC, audit, Agent approval, and device safety are documented and partly represented in code. | Production auth, server-side business permissions, and negative tests need expansion. |
| Reliability | 6/10 | Deployment and reliability docs exist; M0 health endpoint exists. | Worker, queue, object storage, retry, and production observability are future work. |
| Harness knowledge base | 8/10 | Docs are indexed and organized into product, design, execution, generated, and reference sections. | Add mechanical link/schema checks later. |

## Required Verification Gates

For code changes:

- Run targeted tests for touched modules.
- Run `npm run build` for TypeScript, Vite, routing, shared type, or package changes.
- Run `npm test` for frontend-impacting changes.
- Run `npm run test:server` for backend-impacting changes.
- Run `npm run test:e2e` for M1 parameter-management acceptance when `DATABASE_URL` and seed data are available.

For documentation-only changes:

- Verify file paths and cross-links.
- Run `git diff --check`.

## Quality Rules

- Every production write path needs authz, validation, audit, and tests.
- Every new state machine needs positive and negative tests.
- Every API contract change needs frontend DTO review.
- Every Agent tool that changes state needs approval and audit coverage.
- Every device write needs permission, range, state, snapshot, and audit coverage.
