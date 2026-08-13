# HCI Wave 2 — language & efficiency

> Status: **Active**
> Date: 2026-08-13
> Origin: TD-097 (deferred scope of `completed/2026-08-12-hci-interaction-trust-repair.md`)
> Branch: `feat/hci-wave-2-language`
> Chinese: [`docs/zh-CN/exec-plans/active/2026-08-13-hci-wave2-language-efficiency.md`](../../zh-CN/exec-plans/active/2026-08-13-hci-wave2-language-efficiency.md)

## Scope decision

The audit's Wave 2 list was re-triaged against what parallel workstreams already shipped: the audit center now has app-group/project/severity/trace filters, cursor paging, a detail dialog, and Chinese kind labels (`presentAuditEvent.ts`), so the remaining gaps are narrower than the original finding. AI Chinese output lives in `server/modules/agent/**` (owned by the approval-chain program) and stays out of scope here.

| # | Task | Why |
| --- | --- | --- |
| W2-1 | **Permission-denied page in Chinese** (`src/app/routes.tsx`): heading, role lines, and action button localized; role names via existing role labels. | Last full-English page in the product shell. |
| W2-2 | **Server-error user messaging seam**: `src/infrastructure/http/userErrorMessage.ts` maps `WiseEffApiError.code` (+ known `details.reason` values) to Chinese copy with the server message as fallback detail and `requestId` as a technical suffix; wire it into the runtime notification builders (`parameterRuntime` / `logRuntime` / `debuggingRuntime`) and leave dialog-local projections free to adopt it incrementally. | Raw English server messages ("Parameter edit role is required for this project.") currently surface verbatim in toasts. |
| W2-3 | **Audit search pushdown + time window**: `GET /api/v1/audit-events` gains `q` (ILIKE over action/actor/kind) and `from`/`to`; the workspace search stops being page-local, adds a time-window select (今天/7 天/30 天/全部), and the footer count reflects server filtering. Read-path only — no contact with the audited-write seam migration. | Search currently filters only the loaded page (50 rows), silently lying about coverage. |
| W2-4 | **Audit CSV export**: export the current filter's full result (paged fetch, capped with a progress note) as UTF-8-BOM CSV with Chinese headers. | Auditors need evidence extracts; today they screenshot. |

Deferred within Wave 2 (stay in TD-097): review batching (needs product decision on partial-failure semantics), macOS shortcut conventions, deep links, a11y systemics, responsive convergence.

## Verification

- Unit: message-map table test (every mapped code renders Chinese; unknown code falls back to server text + code); audit repository test for `q`/`from`/`to`; workspace test for pushdown wiring + export blob.
- `npm test`, `npm run build`, `npm run docs:check` before PR.
- Browser: `/audit` search + time window + export on desktop 1440; permission-denied page via a non-admin role.

## Documentation Impact Matrix

| Area | Files | Action |
| --- | --- | --- |
| Planning docs | `docs/PLANS.md` | Update (register; completed entry at the end) |
| API docs | `docs/api/examples.md`, `docs/design-docs/api-contract.md` | Update (audit list `q`/`from`/`to`) |
| Frontend docs | `docs/FRONTEND.md`, `docs/zh-CN/frontend.md` | Update (error-message seam, audit center capabilities) |
| Quality/testing | coverage maps | Review (audit export/search ids if acceptance is added) |
| Chinese companions | zh plan + frontend | Update |
| Others (AGENTS/ARCHITECTURE/SECURITY/RELIABILITY/generated) | — | No change expected; re-check at completion |

## Documentation Update Gate

Blocking: resolve every Update/Review row with evidence before moving to `completed/`; run `npm run docs:check`.
