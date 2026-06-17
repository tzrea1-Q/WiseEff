# WiseEff Audit Center M1

## Goal

Deliver Phase M1 of the audit center design: upgrade parameter-admin audit from a flat timeline to an investigable module audit with API integration, filters, and structured detail drill-down.

Design reference: `docs/design-docs/2026-06-17-audit-center-design.md`.

## Architecture

- Extend `GET /api/v1/audit-events` with query filters, cursor pagination, and optional actor name join.
- Introduce frontend `AuditEventView` mapped from API DTO and mock events.
- Add `auditClient` HTTP adapter.
- Replace flat `AuditTimeline`-only modal with master-detail `ParameterAuditDialog`: list + `AuditEventDetail`.
- API mode fetches `app=parameter-management` events for the active project; mock mode keeps `parameter-admin` mock events.

## Files

- Design: `docs/design-docs/2026-06-17-audit-center-design.md`, `docs/zh-CN/design-docs/2026-06-17-audit-center-design.md`
- Backend: `server/modules/audit/types.ts`, `listTypes.ts`, `repository.ts`, `routes.ts`, tests
- Contracts: `server/modules/contracts/schemaRegistry.ts`, `docs/generated/openapi.json`
- Frontend domain: `src/domain/audit/*`
- Frontend HTTP: `src/infrastructure/http/auditClient.ts`
- Frontend UI: `src/components/admin/AuditTimeline.tsx`, `AuditEventDetail.tsx`, `ParameterAuditDialog.tsx`
- Page: `src/ParameterAdminPage.tsx`, `src/styles.css`
- Tests: component/page/client/domain tests

## Tasks

- [x] Write audit center design docs (EN + ZH) and update design-doc indexes.
- [x] Extend audit repository list query (filters, cursor, actor name).
- [x] Extend audit routes with query parsing and paginated response.
- [x] Add frontend audit domain types and mappers.
- [x] Add audit HTTP client.
- [x] Build `AuditEventDetail` and upgrade `AuditTimeline` for selection.
- [x] Build `ParameterAuditDialog` with filters and API fetch.
- [x] Wire `ParameterAdminPage` to new dialog; fix app filter for API mode.
- [x] Update tests, regenerate OpenAPI, run build and docs check.
- [x] Browser verification (desktop/tablet/mobile).

## Verification

- `npm test -- server/modules/audit src/domain/audit src/infrastructure/http/auditClient.test.ts src/components/admin/AuditTimeline.test.tsx src/components/admin/AuditEventDetail.test.tsx src/ParameterAdminPage.test.tsx` passed on 2026-06-17.
- `npx vite build` passed on 2026-06-17.
- `npm run contract:openapi` passed on 2026-06-17.
- `npm run docs:check` passed on 2026-06-17.
- Browser verification passed on 2026-06-17 with mock runtime at `http://127.0.0.1:5175/parameter-admin`. Checked desktop `1440x900`, tablet `768x1024`, and mobile `390x844`; audit modal shows list + detail diff; console errors: none. Screenshots: `work/ui-checks/20260617-audit-m1-*-open.png`.

## Documentation Impact Matrix

| Area | Status | Files |
| --- | --- | --- |
| Repository maps | Review | `AGENTS.md`, `ARCHITECTURE.md` — no change required for M1 |
| Planning docs | Update | `docs/PLANS.md`, this plan |
| Product specs | Review | `docs/product-specs/product-spec.md` — no change |
| Architecture | Review | `docs/design-docs/full-stack-architecture.md` — no change |
| Design docs | Update | `docs/design-docs/2026-06-17-audit-center-design.md`, index files |
| API contract | Review | OpenAPI regenerated; formal api-contract.md update deferred to M2 |
| Security | Review | `docs/security/audit-retention.md` — aligned, no change |
| Frontend | Review | `docs/FRONTEND.md` — no change |
| Generated | Update | `docs/generated/openapi.json` |
| References | No change | — |
| Chinese docs | Update | `docs/zh-CN/design-docs/2026-06-17-audit-center-design.md`, index |

## Documentation Update Gate

- [x] Design docs and indexes updated.
- [x] OpenAPI regenerated.
- [x] `npm run docs:check` passes.
- [ ] API list query documented in api-contract — deferred to M2 when `/audit` route lands.

## Browser Acceptance

- Existing coverage: `PARAM-HAPPY-001` audit API assertions remain valid (`items` + `nextCursor` response).
- M1 UI enhancement covered by component tests and browser checks above.

## Follow-Up (M2 / tech debt)

- `/audit` org-wide center
- Module-scoped audit read permissions
- L1 context audit tabs on parameter/CR/debug/log pages
- Scheduled export and retention (M3) — add to tech-debt tracker if deferred
