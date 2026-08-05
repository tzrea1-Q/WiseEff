# Parameter admin audit hints → audit projection (C3)

> Status: **Active** — planning only until implementation starts
> Date: 2026-08-05
> Parent: [`2026-08-05-path-reachable-mock-gap-program.md`](./2026-08-05-path-reachable-mock-gap-program.md)
> Tracks: **TD-061** (opened with this program)
> Chinese: [`docs/zh-CN/exec-plans/active/2026-08-05-parameter-admin-audit-hints.md`](../../zh-CN/exec-plans/active/2026-08-05-parameter-admin-audit-hints.md)

## Goal

Stop treating local `PUSH_AUDIT_HINT` as an audit source of truth on `/parameter-admin`. Replace the in-memory hint strip with a **projection of real audit-center events** (and ensure every admin mutation that currently only pushes a local hint also persists `createAuditEvent` server-side when it does not already).

## Non-goals

- Building a second audit table or admin-only audit schema.
- Redesigning the global audit center UX beyond what admin needs for “recent actions”.
- Changing governance decision semantics (spec review, identity mapping, etc.).
- Mock-mode-only demos that have no API audit path may show an empty recent list or a clear “API mode only” note — do not fake durable events in production API mode.

## Locked decisions

1. **SSOT = audit module** (`createAuditEvent` / `listAuditEvents` in [`server/modules/audit/repository.ts`](../../../server/modules/audit/repository.ts)).
2. Remove `PUSH_AUDIT_HINT` as the write path for “what just happened”; panels may still show optimistic UI chrome, but durable text comes from audit list refresh.
3. Map existing `ParameterAdminAuditHint.kind` values to audit `action` / `resourceType` filters where possible; do not invent parallel kind enums in DB.
4. If a panel mutation already writes audit server-side, the UI only **refetches** recent events — no duplicate client invent.
5. If a panel mutation lacks server audit today, **add** `createAuditEvent` in that service path in the same PR as the UI change for that panel (fail closed for API mode).

## Git & PR Workflow

| Role | Allowed |
| --- | --- |
| Implementation agent | Commit on `feat/parameter-admin-audit-hints`; no PR open/merge |
| Parent agent | Review, PR, merge, sync `main`; close TD-061 |

Branch: `feat/parameter-admin-audit-hints` from latest `main`.

## File map

| Area | Paths |
| --- | --- |
| Local hints today | `src/application/parameters/parameterAdminState.ts` |
| Dispatch sites | `OrganizationSpecGovernancePanel.tsx`, `OrganizationModuleGovernancePanel.tsx`, `OrganizationIdentityMappingPanel.tsx`, `OrganizationBulkImportPanel.tsx`, `ProjectsOperationsPanel.tsx`, others via grep `PUSH_AUDIT_HINT` |
| Audit API | `server/modules/audit/routes.ts`, `repository.ts`; frontend audit client if present |
| Admin shell | parameter-admin-next layout / audit drawer entry |

## Tasks

### Batch 0 — Inventory

- [ ] Enumerate every `PUSH_AUDIT_HINT` call site with: triggering mutation, whether server already audits, audit action name if any.
- [ ] Produce a checklist table in the PR description (kinds → audit action → gap Y/N).

### Batch 1 — Server gaps

- [ ] For each gap (mutation without audit), add `createAuditEvent` with stable `action`, resource ids, and non-sensitive summary.
- [ ] Unit tests per module service asserting audit write on success and no write on authz failure.

### Batch 2 — Admin recent-events projection

- [ ] Add/reuse HTTP client method to list recent org-scoped audit events (existing list API + query filters).
- [ ] Replace `auditHints: ParameterAdminAuditHint[]` with `recentAuditEvents` (or keep UI type as a view-model mapped from audit DTOs).
- [ ] Remove `PUSH_AUDIT_HINT` reducer action once call sites are gone.
- [ ] After successful admin mutations, invalidate/refetch recent events instead of pushing local hints.
- [ ] Empty / error / loading states that do not look like “no activity forever” on fetch failure.

### Batch 3 — Tests, acceptance, docs

- [ ] Component tests: after mocked mutation success, recent list shows server event.
- [ ] Review browser acceptance for parameter-admin audit affordances; add `PARAM-ADMIN-AUDIT-RECENT-001` if a visible strip/drawer is user-facing.
- [ ] Update FRONTEND / admin docs; close TD-061.
- [ ] Tick parent program C3 after merge.

## UI interaction coverage

If the recent-events strip is visible:

| ID | Behavior |
| --- | --- |
| `PARAM-ADMIN-AUDIT-RECENT-001` | After an admin mutation that audits server-side, the admin recent list shows a matching event without relying on local-only hint state |

Register in coverage map + operation matrix (+ zh-CN). If the product only deep-links to the existing audit center page, document that and cover navigation instead — still no local SSOT.

## Verification

```bash
rg "PUSH_AUDIT_HINT" src  # expect zero after Batch 2
npm test -- src/application/parameters/parameterAdminState.test.ts src/components/parameter-admin-next --run
npm run test:server -- server/modules/audit --run
# plus module tests touched for new createAuditEvent calls
npm run build
npm run docs:check
```

Frontend-visible: playwright-cli on `/parameter-admin` at 1440×900 / 768×1024 / 390×844; confirm recent list or audit link after one mutation; console errors = 0.

## Documentation Impact Matrix

| Area | Action | Paths |
| --- | --- | --- |
| Planning | Update | Parent program; this plan |
| Tech debt | Update | Close **TD-061** |
| Product specs | Review | Admin / audit mentions in prototype-functional-spec |
| Frontend | Update | `docs/FRONTEND.md`, `docs/zh-CN/frontend.md` — admin audit projection |
| Security | Update | `docs/SECURITY.md` / zh-CN if audit write coverage expands |
| API | Review | Audit list query usage; no new parallel API unless list filters missing |
| Design / ADR | No change | ADR-0001/0002 unchanged |
| Quality / acceptance | Update | coverage map + operation matrix if new ID |
| Reliability | No change | — |
| Generated | No change | — |
| Chinese companions | Update | This plan’s zh-CN summary |

## Documentation Update Gate

- [ ] Zero `PUSH_AUDIT_HINT` in `src/`
- [ ] Inventory gaps closed with server audit or explicit non-mutating UI-only explanation
- [ ] TD-061 Completed
- [ ] `npm run docs:check`
- [ ] Parent program C3 ready to tick

## Success criteria

1. Admin “what just happened” reflects durable audit events in API mode.
2. No local hint array as SSOT.
3. Mutations that previously only hinted locally now audit server-side (or were already covered).
4. TD-061 closed.
