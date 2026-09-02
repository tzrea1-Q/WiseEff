# Catalog Launch Operating Rules

> Chinese: [Chinese](../zh-CN/agents/catalog-launch-operating-rules.md)

These rules apply to remaining Wayfinder #668 launch Issues (#683–#735 that are still open). They do not change acceptance criteria, CD/CF/ID/RE edges, owned paths, or evidence layers. They are the Issue-facing operating contract for how those frozen tickets are executed.

The parent posts a pointer from map Issue #668. Individual launch Issue bodies stay frozen.

## What stays frozen

- D / L / PG / B / H / T / R remain distinct. Local or Hosted output is never labeled target, release, or production evidence.
- Skipped jobs stay skipped.
- Issue-named commands stay mandatory unless an accepted run profile names the exact Hosted job that runs the same command or a proven superset.
- Safety, authorization, and human-approval boundaries still outrank this document.

## Dedicated lane database

Every node whose evidence includes real PostgreSQL:

1. Run `npm run catalog:lane:env -- provision --issue <n>` from an isolated worktree.
2. Export the printed `DATABASE_URL` / `TEST_DATABASE_URL` (database `wiseeff_lane_<n>` on `127.0.0.1:55438`, image `pgvector/pgvector:pg16`).
3. Do not use the default compose app database `postgres://wiseeff:wiseeff@127.0.0.1:5432/wiseeff`. That instance is `postgres:16-alpine`, is shared across checkouts, and is not catalog evidence.

`npm run catalog:lane:env -- doctor --issue <n>` fails closed on the forbidden URL, missing pgvector, or a `catalog_migration_owner` SELECT failure against `public.parameter_specs`.

## Local acceptance before a PR

Hosted confirms; it does not discover.

```bash
npm run catalog:lane:accept -- --issue <n> -- <issue-named command>
```

The command must be the Issue-owned focused suite (Vitest paths, schema tests, compiler tests, or the named PG command). Zero collected test files is a hard failure — that output is usually a `globalSetup` crash, not an empty suite. RBAC and migration nodes must pass the role canary as `catalog_migration_owner`, not only as the bootstrap superuser.

Do not open the final PR until this local gate is green on the exact candidate.

## Concurrency

- Merge stays serial: one feature Hosted PR at a time.
- Development does not stay serial. Path-disjoint Scratch lanes continue through `SEALED` while the merge lane is in `HOSTED`.
- While Hosted is running, the parent dispatches or continues at least one other disjoint lane, or records that none exists. Waiting on CI with idle hands is a protocol violation.
- Process-only amendments (protocol, operating rules, lane-env scripts, bilingual docs) are an independent merge wave and may land beside an already-open feature PR.

Shared migrations, generated `docs/generated/db-schema.md`, OpenAPI, and fingerprint files still serialize. Those lanes keep WIP 2.

## Inventory and fingerprints

Lock occurrence counts, allow-lists, schema fingerprints, and lock files once at `THREAT-READY` from a complete scan of the trusted base. A second patch of the same invariant is a circuit breaker. If only one option can pass Hosted, the parent records that choice and continues; it does not park the merge lane on a publisher question that cannot produce a green merge bar.

## Unrelated failures

Classify once. An unrelated Hosted flake gets one `gh run rerun --failed`. The lane does not patch unrelated tests.

## Issue bodies

Do not edit frozen acceptance criteria to “make Hosted easier.” Process changes belong in this file, the [Agent Delivery Execution Protocol](agent-delivery-protocol.md), and the G0.3 run profile in the Wayfinder plan.
