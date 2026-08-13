# OpenAPI route parity — the manifest can no longer drift from the router

> **Completed 2026-08-12** via PRs #334 and #346 (hotfix #361 for a PLANS.md marker). Two-way manifest↔registration parity test live; 31 routes and their schemas backfilled.

Architecture-review candidate C8 (2026-08-12 backend review); five-decision grilling
session settled the scope on 2026-08-12.

## Problem

`contract:check` guarded only "generator output == committed `docs/generated/openapi.json`".
The generator's input — the hand-maintained `routeManifest` — had no reconciliation
against the real runtime registration, and the router could not even be enumerated, so
drift was structurally undetectable. Measured on main: 31 registered `/api` routes were
missing from the manifest (the entire parameter-files surface among them) and 7 manifest
entries (agent/xiaoze) did not register under the manifest test's construction.

## Design (settled decisions)

1. **Runtime enumeration is the only honest source**: `router.listRoutes()` plus
   `buildWiseEffRouter(options)` extracted from `createWiseEffServer` (behavior-neutral;
   the server now consumes the returned `{ router, metrics, tracing }`). This is also the
   future home for C3's `defineRoute` if it lands.
2. **Two-way parity test** (`server/modules/contracts/routeParity.test.ts`): every
   registered route must be published, every manifest entry must be registered, and every
   manifest entry must have a schema-registry entry. Registration uses a stub db because
   xiaoze skips registration without one; no query runs during registration.
3. **Explicit exemption list**, one comment per entry; initially only `GET /metrics`
   (private-network operations surface, not part of the client API contract).
4. **Scope split**: this candidate fixes the route layer only. Schema placeholder
   realization (zod v3 has no JSON-Schema export; needs a dependency decision) is a
   separate future candidate.
5. **Backfill**: 31 routes added to `routeManifest` + `schemaRegistry` (new `RouteModule`
   values `parameter-files` and `device-bridge`); `docs/generated/openapi.json`
   regenerated (one-time large artifact diff, reproducible via `contract:openapi`).

## Verification

- `npx vitest run --config vitest.server.config.ts server/modules/contracts` — 20 passed
  (parity both directions green after backfill).
- `npm run contract:openapi` + `npm run contract:check` — artifact current.
- `npm run build`, `npm run docs:check`, `server/app.test.ts` — must pass (router
  extraction is behavior-neutral).

## Git & PR Workflow

Branch `refactor/openapi-route-parity` from `origin/main`; single PR; parent agent
reviews, merges, syncs `main`.

## Documentation Impact Matrix

| Area | File | Action | Note |
| --- | --- | --- | --- |
| Planning | `docs/PLANS.md` | Update | Plan registered (done) |
| Generated | `docs/generated/openapi.json` | Update | Regenerated with 31 backfilled operations (done) |
| API docs | `docs/api/README.md` | Review | States the contract artifact workflow; unchanged commands — recorded no change needed |
| Architecture/design | `docs/design-docs/api-contract.md` (+ zh) | No change | Endpoint tables already documented these routes; only the manifest lagged |
| Repository maps / product specs / security / reliability / quality / references / glossary | — | No change | No product behavior, no domain terms, no operational surface change |

## Documentation Update Gate

All `Update` rows done in-branch; the single `Review` row recorded above with reasoning.
This plan is a one-PR candidate: move to `completed/` once the PR merges.

## UI Interaction Automation Review

No UI or behavior change (route registration refactor is structural; contract artifact is
documentation). No requirement/operation ID impact.
