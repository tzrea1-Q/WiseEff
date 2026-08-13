# Reload value shape — deepen shape knowledge into one module

> **Completed 2026-08-12** via PRs #315 (server engine + shared vocabulary) and #318 (frontend mirror replaced by `resolvedValueShape` from the API).

Consolidate DTS reload debugging value-shape knowledge (families, resolution, authored-value
validation, read-back coercion, canonical comparison forms, authoring examples) into a single
`ReloadValueShape` module instead of five copies. Architecture-review candidate C1
(2026-08-12 backend review); design settled through a twelve-decision grilling session.

## Evidence

Three consecutive "add a value shape" commits each fanned out to the same six files:

| Commit | candidates.ts | service.ts | behaviouralVerify.ts | preflight.ts | frontend |
| --- | --- | --- | --- | --- | --- |
| `8f656830` phandle-cells | +99 | +56 | +54 | +46 | +60 |
| `dbbbda26` `/bits/ 8` bytes | +106 | +29 | +5 | +16 | +34 |
| `1a30fa2a` single-string | +8 | +14 | +3 | — | +18 |

The same "what does this shape look like" knowledge lived in four server copies
(`candidates.ts` classification, `service.ts:assertParsedValueMatchesShape` 134 lines,
`behaviouralVerify.ts` coerce helpers, `preflight.ts:normalizeValue`) plus a frontend mirror
in `DtsReloadPage.tsx` that dispatched on raw catalog kinds — a fifth, disguised copy of
shape resolution.

## Design (settled decisions)

1. **Hybrid seam placement.** Vocabulary + authoring expectations (family predicates,
   `isSupportedReloadValueShape`, authoring issue codes, placeholder/example data) live in
   the pure shared file `src/domain/dtsReload/valueShape.ts`. The engine (baseline
   inference, authored-value validation, read-back coercion, canonicalization — everything
   needing `parseDtsValue`) lives in `server/modules/dts-reload/valueShape.ts`, which
   re-exports the shared vocabulary (same shim pattern as
   `parameter-modules/modulePlacement.ts`).
2. **Action-shaped interface.** `resolveReloadValueShape` / `isSupportedReloadValueShape` /
   `validateAuthoredDebugValue` / `compareReloadDebugValue` / `canonicalizeReloadValue` /
   `describeReloadValueShapeAuthoring`. Family entries are implementation detail, not
   interface.
3. **Structured issues, edge-mapped messages.** `validateAuthoredDebugValue` returns
   `{ ok, parsed } | { ok: false, issue }`; the server edge (`service.ts:throwAuthoringIssue`)
   maps issues onto the existing `ApiError` English messages and `details` fields
   verbatim; the frontend edge maps the same issues onto Chinese copy (PR2). Examples and
   placeholders are module data (`describeReloadValueShapeAuthoring`), no longer duplicated
   between server messages and frontend placeholders.
4. **Injected phandle resolution.** `canonicalizeReloadValue(value, fallback, resolvePhandle?)`
   keeps the canonical-decimal-sequence rule whole inside the module; preflight supplies the
   label→numeric map from the decompiled tree as a resolver function.
5. **Range enforcement — evidence amendment.** The grilled design ordered a per-width
   unsigned range check (original Q10). Implementation testing showed the DTS value parser
   already refuses per-width overflow at parse time
   (`valueAst.ts`: `Integer literal "…" overflows a N-bit cell`; signed minima wrap like
   dtc, so `<-1>` stays legal). A module-level range check is unreachable code, so it was
   removed; the parser guarantee is now **pinned by module tests** instead. No behavior
   change; the frontend 0-255 check is a UX mirror of a guarantee the server already made.
6. **Naming.** Resolved vocabulary type `ReloadValueShape`; unresolved catalog input keeps
   `CandidateValueShape`. CONTEXT.md glossary row "Reload value shape" added.

## Files

PR1 (`refactor/reload-value-shape`, contract-neutral):

- `src/domain/dtsReload/valueShape.ts` + `.test.ts` — new shared vocabulary.
- `server/modules/dts-reload/valueShape.ts` + `.test.ts` — new engine (moved logic).
- `server/modules/dts-reload/candidates.ts` — keeps classification + dedupe only.
- `server/modules/dts-reload/service.ts` — `assertParsedValueMatchesShape` (134 lines) and
  the parse try/catch replaced by `validateAuthoredDebugValue` + issue→ApiError mapping.
- `server/modules/dts-reload/behaviouralVerify.ts` — coerce/compare moved out.
- `server/modules/dts-reload/preflight.ts` — `normalizeValue`/`decimal` moved out.
- Tests migrated with their logic; `service.test.ts` start-run rejection tests unchanged
  (refactor equivalence sentinels) plus one new overflow sentinel.
- `CONTEXT.md`, `docs/PLANS.md`, this plan.

PR2 (follow-up, contract + frontend):

- `ReloadCandidateDto` + OpenAPI schema registry + `src/domain/dtsReload/types.ts`: add
  `resolvedValueShape` (keep `valueShapeKind` for display).
- Mock runtime serves the same field (ADR-0002).
- `DtsReloadPage.tsx`: delete local shape validators; consume shared vocabulary +
  issue→Chinese mapping; placeholders from `describeReloadValueShapeAuthoring`.
- Frontend verification via playwright-cli per AGENTS.md.

## Verification

- `npx vitest run --config vitest.server.config.ts server/modules/dts-reload` — 167 passed.
- `npx vitest run src/domain/dtsReload` — 13 passed.
- `npm run build` — must pass (server + frontend TypeScript).
- `npm run docs:check` — must pass.

## Git & PR Workflow

- Branch: `refactor/reload-value-shape` from `origin/main` (isolated worktree).
- One PR per stage: PR1 this branch; PR2 branches from `main` after PR1 merges.
- Parent agent reviews, opens the PR, merges, syncs local `main`.

## Documentation Impact Matrix

| Area | File | Action | Note |
| --- | --- | --- | --- |
| Repository maps | `AGENTS.md`, `ARCHITECTURE.md` | No change | Module boundaries unchanged; dts-reload stays one module |
| Planning | `docs/PLANS.md` | Update | Plan registered (done, PR1) |
| Planning (zh) | `docs/zh-CN/PLANS.md` | No change | Page states the active list is governed by the English page |
| Domain glossary | `CONTEXT.md` | Update | "Reload value shape" row (done, PR1) |
| Product specs | `docs/product-specs/*` | No change | No product behavior change |
| Architecture/design | `docs/design-docs/domain-model.md` | Reviewed (PR2) | No change: the domain model documents the reload run/snapshot state, not the value-shape vocabulary, which is captured in the CONTEXT.md glossary and the api-contract candidate row |
| API contract | `docs/design-docs/api-contract.md` (+ zh) | Updated (PR2) | `resolvedValueShape` added to the candidates row in both English and the required Chinese companion |
| Frontend | `docs/FRONTEND.md` | Reviewed (PR2) | No change: the page still renders state and calls the port; validation now reads a server-provided DTO field instead of re-deriving, no new frontend architecture rule |
| Quality/testing | `docs/QUALITY_SCORE.md`, `docs/design-docs/testing-strategy.md` | No change | Test counts move between files; strategy unchanged |
| Reliability/runbooks | `docs/RELIABILITY.md`, `docs/runbooks/*` | No change | No operational surface change |
| Security | `docs/SECURITY.md`, `docs/security/*` | No change | No authz/audit surface change |
| Generated | `docs/generated/*` | No change | No schema change |
| References | `docs/references/*` | No change | — |

## Documentation Update Gate

- PR1: `CONTEXT.md` and `docs/PLANS.md` updated in-branch; all other rows recorded
  `No change` with reasons above; `npm run docs:check` green before merge.
- PR2: `docs/design-docs/api-contract.md` and its Chinese companion updated for
  `resolvedValueShape`; domain-model and FRONTEND rows reviewed and recorded `No change`
  with reasons above; `npm run docs:check` green before merge. Both documentation `Review`
  rows are now resolved, so this plan is eligible to move to `completed/` after PR2 merges.

## UI Interaction Automation Review

PR1 changes no user-facing interaction: routes, request/response contracts, error codes,
messages, and `details` fields are byte-identical (verified by the unchanged
`service.test.ts` start-run rejection suite). Covering acceptance spec for the reload flow:
`e2e/acceptance/dts-reload-deploy.acceptance.spec.ts`; no requirement or operation ID
changes needed for PR1. PR2 changes the candidate DTO and page validation and must re-review
coverage IDs plus run real-browser verification before completion.

## Expected outcomes

- Adding a value shape = one engine entry + one vocabulary row, not a six-file fanout.
- Shape rules testable as pure functions (zero DB, zero mocks) — 36 module tests replace
  logic previously reachable only through `startReloadRun` scaffolding.
- Frontend (PR2) consumes the same vocabulary instead of re-deriving families from catalog
  kinds, deleting the fifth copy.
