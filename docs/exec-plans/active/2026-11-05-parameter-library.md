# Parameter library implementation

> Chinese: [Chinese](../../zh-CN/exec-plans/active/2026-11-05-parameter-library.md)

Implement [specification #1513](https://github.com/tzrea1-Q/WiseEff/issues/1513) and the [accepted design](../../design-docs/2026-11-05-parameter-library-design.md). Reuse the published Catalog, canonical current Binding/value ownership and existing project editor. Keep global definitions separate from Organization-scoped configuration reads; preserve write authorization and source integrity. No second value store or deployment is planned.

## Tasks and ownership

| Issue | Slice | Prerequisites | Status |
| --- | --- | --- | --- |
| #1514 | Global entry and complete definition reading | None | Integrated; focused HTTP/PG 51/51, frontend 77/77, browser 1/1 passed |
| #1515 | Organization-scoped configuration reading | None | Integrated; scoped HTTP/PG 22/22, related 58/58, browser 1/1 passed |
| #1516 | Current instances and exact usage | #1514, #1515 | Integrated; scoped HTTP/PG 62/62, focused frontend 22/22, browser 1/1 passed |
| #1517 | Usage filters and unconfigured coverage | #1516 | Integrated; frontend 73/73 and real API browser 1/1 with axe passed; combined HTTP covered by #1518 |
| #1518 | Explicit instance comparison | #1516 | Integrated; HTTP/PG 37/37 plus array/type case, frontend 74/74, combined browser 1/1 with comparison axe passed |
| #1519 | Exact project edit and return | #1516 | In progress |
| #1520 | Share current view and copy full values | #1517, #1518 | In progress |

The coordinator owns integration, runtime setup, expensive verification and the PR. Each issue is implemented with TDD in a managed worktree by a GPT-6.1 Terra agent at xhigh reasoning. Merger agents integrate completed slices. Independent Standards and Spec reviews run after all slices; one implementation agent fixes findings.

## Git & PR Workflow

Base: `origin/main` at `d867166f5332dbceacbce348f7e73f1b16911ac1`. Integration branch: `codex/parameter-library`. The user explicitly invoked `implement-spec`, selecting a single integration PR in place of the ordinary per-slice PR convention. Open a draft after the first worker merge, closing #1513–#1520 when eventually merged. Finish with a verified, reviewed PR ready for review; no main merge or deployment is authorized.

## Verification

Approved behavior seams are public HTTP plus real PostgreSQL, and browser journeys against a real API. Each worker runs focused red/green checks and affected static checks. The coordinator runs `npm run test:impact -- --base d867166f5332dbceacbce348f7e73f1b16911ac1`, honors both fallback flags, and owns selected native regression, `npm run build`, `npm run ui:check` and `npm run docs:check`. No skipped or mock result counts as backend acceptance.

Browser ownership: `e2e/acceptance/parameter-library.acceptance.spec.ts`, requirement and operation IDs `PARLIB-READ-001`, `PARLIB-SCOPE-001`, `PARLIB-INSTANCES-001`, `PARLIB-FILTER-001`, `PARLIB-COMPARE-001`, `PARLIB-RETURN-001`, `PARLIB-SHARE-001`. Record real operation evidence through the native acceptance runner. Inspect 1440×900 and a compact 1280×800 state for dense table/comparison layout; cover DTS and software configuration, keyboard focus, long values, errors and stale responses. Use isolated runtime/database lane names. Existing Catalog and project-workbench regression owners remain intact.

Draft [PR #1521](https://github.com/tzrea1-Q/WiseEff/pull/1521) is open. Initial selection has both Vitest and browser full-fallback flags; the coordinator retains the full selected gates for the integrated candidate. Focused worker results above do not complete those gates. Scope browser coverage lives in `e2e/acceptance/parameter-library-scope.acceptance.spec.ts`. Independent review, final visual approval and final regression remain pending.

## Documentation Impact Matrix

| Area | Action | Paths and decision |
| --- | --- | --- |
| Repository maps | Review | `ARCHITECTURE.md`, `CONTEXT.md`; add only changed ownership/terminology. |
| Planning | Update | `docs/PLANS.md`, this plan and Chinese companions. |
| Product | Update | `docs/design-docs/2026-11-05-parameter-library-design.md` and Chinese companion; record final status. |
| Architecture | Update | `docs/adr/0055-parameter-configuration-reads-share-organization-scope.md`, `docs/design-docs/domain-model.md` and companions. |
| Quality | Update | `docs/developer/browser-acceptance-coverage-map.md`, `e2e/acceptance/operationMatrix.ts`, generated `docs/developer/user-operation-coverage-matrix.md` and companions. |
| Reliability | Review | `docs/RELIABILITY.md`; no new runtime service or deployment expected. |
| Security | Update | `docs/SECURITY.md` and Chinese companion; current-configuration reads only. |
| Frontend and users | Review | `docs/FRONTEND.md`, `docs/design-docs/ui-design-system.md`, applicable user guides and companions. |
| Generated artifacts | Review | `docs/generated/openapi.json`, `docs/generated/db-schema.md`; regenerate the native API contract, no schema change planned. |
| References | Review | Linked Catalog and parameter-workbench docs; preserve historical acceptance. |

## Documentation Update Gate

Before moving this plan to completed, resolve every Update/Review row with changes or an explicit unchanged finding, run documentation checks, and record actual runtime evidence and PR state. No acceptance has run at plan creation.
