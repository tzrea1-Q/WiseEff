# WiseEff Audit Center M2

## Goal

Deliver Phase M2 of the audit center design: organization-wide `/audit` page with cross-module filters, trace investigation, URL-synced query state, and shared audit workspace extracted from parameter-admin modal.

Design reference: `docs/design-docs/2026-06-17-audit-center-design.md`.

## Architecture

- Extract `AuditWorkspace` shared by parameter-admin dialog and `/audit` page.
- Add `useAuditEvents` and `useAuditSearch` hooks for API/mock loading and URL query sync.
- Add `AuditRelatedTimeline` for trace-linked events.
- Register `/audit` route (Admin only) and sidebar utility entry.
- Parameter-admin dialog links to `/audit?app=parameter&projectId=...`.

## Files

- `src/components/admin/AuditWorkspace.tsx`, `AuditRelatedTimeline.tsx`
- `src/hooks/useAuditEvents.ts`, `useAuditSearch.ts`
- `src/domain/audit/auditApps.ts`
- `src/AuditCenterPage.tsx`
- `src/appConfig.ts`, `src/app/permissions.ts`, `src/app/routes.tsx`
- Tests and styles

## Tasks

- [x] Extract shared audit workspace and data hooks.
- [x] Add `/audit` page, routing, permissions, and sidebar entry.
- [x] Trace related timeline and deep-link query params.
- [x] Link parameter-admin dialog to audit center.
- [x] Tests, docs update, browser verification.

## Verification

- Targeted vitest suites for audit domain, hooks, AuditCenterPage, permissions.
- `npx vite build`
- Browser checks on `/audit` (mock mode) desktop/tablet/mobile.

## Follow-Up (M3 / tech debt)

- CSV/JSON export, retention policy UI, immutable export jobs
- Module-scoped audit read permissions
- L1 context audit tabs on parameter/CR/debug/log pages
- API list query documented in `docs/design-docs/api-contract.md`
