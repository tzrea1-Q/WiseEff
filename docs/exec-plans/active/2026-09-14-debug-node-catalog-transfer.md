# Debug node catalog transfer (#846)

> Chinese: [Chinese](../../zh-CN/exec-plans/active/2026-09-14-debug-node-catalog-transfer.md)

Status: **Active — reviewable candidate on a Scratch branch**. No PR, merge, or deployment is
authorized by this plan.

Accepted base: `origin/main` `6d72e17cb` (PR #845 merge). Scratch branch:
`feat/846-full-node-catalog-transfer`.

## Goal

An Org Admin can export the current organization's **complete** saved debug-node library to
one file, upload that file, see a server-classified merge preview, confirm it, and get an
atomic merge — all through the real browser → real HTTP API → real PostgreSQL → file /
re-read boundary.

## Stop boundary

This wave does not authorize: production data operations, deployment, PR merge, cross-org
reads or writes, device connections, device writes, sharding or background queues, new
dependencies, or a general backup/restore framework. The reported field defect in the
original deployment is **not** reproduced here: the import capacity inconsistency is a
separate confirmed defect and is not claimed as its root cause.

## Delivered scope

| Area | Change |
| --- | --- |
| Format | `wiseeff.debug-node-catalog.v2` (source/counts/objects, presence-aware optionals); v1 stays importable with its defaults |
| Export | One org-scoped snapshot of every module, node (archived/disabled/unbound included) and binding; response carries counts, organization and byte size; 20 MiB contract with a whole-failure `413` |
| Preview | New `POST …/catalog/import-preview`: classification, conflicts, warnings, per-object field differences, `previewDigest`; read-only |
| Import | `POST …/catalog/import` requires the digest, re-verifies approved targets under an org advisory lock, and applies every change plus the audit event in one transaction |
| Capacity | 500-module / 2,000-node caps removed; bounded HTTP body collection returns `413 PAYLOAD_TOO_LARGE` |
| UI | "Export all nodes" / "Import nodes" buttons, a preview dialog with counts, conflicts, warnings and per-field differences, digest-confirmed submit, structured error surfacing |
| Errors | `PAYLOAD_TOO_LARGE` (413) added to the shared error table |

## Evidence

| Level | Evidence |
| --- | --- |
| Real local PostgreSQL | `server/modules/debugging/catalogTransfer.test.ts` (24 cases: full export, export refusal over an unrepresentable target, v1/v2 semantics, conflicts incl. ambiguous target and duplicate input, declared-count mismatch, digest guard, archive rules, idempotence, rollback, 2,001/501 capacity, 20 MiB boundary) |
| Route contract | `server/modules/debugging/routes.test.ts`, `schemas.test.ts`, `server/shared/http/server.test.ts`, `server/modules/contracts/routeParity.test.ts` |
| Browser-real | `e2e/acceptance/debugging-admin.acceptance.spec.ts` → `DEBUG-ADMIN-001`, `DEBUG-ADMIN-846-CAPACITY`, `DEBUG-ADMIN-846-VIEWPORTS`, `DEBUG-ADMIN-846-GUARD` (5 passed, real API + PostgreSQL) |
| Browser UI | Committed three-viewport case inside the acceptance spec, plus `work/846-ui-checks/*` at 1440×900, 768×1024, 390×844 from `work/846-ui-check.mts` (ignored evidence path): download, upload, preview, cancel, confirm, unknown-outcome notice, error path, focus, console/network |

## Documentation Impact Matrix

| Area | Paths | Action |
| --- | --- | --- |
| Repository maps | `AGENTS.md` | Review — no new top-level map or command |
| Planning | this plan + Chinese pair | Update |
| Product specs | `docs/product-specs/*` | No change — node-library transfer is a governance surface, not a new workflow |
| Architecture / ADR | `docs/design-docs/debug-node-catalog-transfer.md` + Chinese, `docs/design-docs/index.md` + Chinese | Update |
| API contract | `docs/design-docs/api-contract.md` + Chinese, `server/modules/contracts/routeManifest.ts`, `schemaRegistry.ts` | Update |
| Quality / testing | `docs/developer/browser-acceptance-coverage-map.md` + Chinese, `docs/developer/user-operation-coverage-matrix.md` + Chinese, `e2e/acceptance/requirements.ts`, `e2e/acceptance/operationMatrix.ts` | Update |
| Reliability / runbooks | `docs/runbooks/*` | No change — no new operator procedure |
| Security | `docs/SECURITY.md`, `docs/security/*` | Review — permission, audit and redaction behavior follows existing rules |
| Frontend / design | `docs/design-docs/ui-design-system.md`, `docs/developer/ui-quality-checklist.md` | Review — reused `ModalDialog` tiers and design tokens |
| Generated | `docs/generated/openapi.json` | Update — regenerated from the route/schema registry and verified with `npm run contract:check` |
| References | `docs/references/*` | No change |

## Documentation Update Gate

Blocking: the bilingual `debug-node-catalog-transfer` design page, both API-contract pages,
both acceptance coverage maps, both operation matrices, `scripts/bilingual-docs.ts`, and
`npm run docs:check`.

## Verification

```bash
DATABASE_URL=<scratch pg> npx vitest run --config vitest.server.config.ts \
  server/modules/debugging/catalogTransfer.test.ts server/modules/debugging/routes.test.ts \
  server/modules/debugging/schemas.test.ts server/shared/http/server.test.ts \
  server/modules/contracts/routeParity.test.ts
npx vitest run src/DebuggingAdminPage.test.tsx src/components/admin/DebugNodeCatalogImportDialog.test.tsx
npm run ui:check && npm run contract:check
npx playwright test --config playwright.acceptance.config.ts e2e/acceptance/debugging-admin.acceptance.spec.ts
npx tsx work/846-ui-check.mts
npm run typecheck && npm run build && npm run docs:check
```

## Success

The candidate is reviewable when the focused suites, `npm run build`, `npm run ui:check`,
`npm run contract:check`, `npm run docs:check` and the five acceptance cases pass on the
recorded SHA, and the browser evidence shows no overflow, blocked action or console error
at all three viewports.

## Open items

- The original deployment's missing-entry report is **not reproduced**; no root cause is claimed.
- None beyond the un-reproduced field report below.
