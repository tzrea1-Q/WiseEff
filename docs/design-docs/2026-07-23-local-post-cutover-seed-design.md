# Local post-cutover M1 seed — design

> Date: 2026-07-23  
> Status: approved for implementation  
> Chinese: [`docs/zh-CN/superpowers/specs/2026-07-23-local-post-cutover-seed-design.md`](../zh-CN/superpowers/specs/2026-07-23-local-post-cutover-seed-design.md)  
> Branch: `feat/local-post-cutover-seed`

## Problem

Local `npm run dev:all` seeded **dual-track** identity: flat `parameter_definitions` / PPV / unbound history **plus** semantic DTS bindings. Typed binding draft **create** worked (pre-cutover adapter); **submit** required `parameter_identity_cutovers` and returned 409. Running production `parameter-identities:migrate` on that dual-track DB produced hundreds of ambiguous/unmapped blockers. Runbooks forbid cutting over a dirty shared developer database in place.

## Goals

- Default local path ends **post-cutover** so typed binding drafts can be submitted for review.
- Do not weaken production submit or maintenance-window cutover gates.
- Refuse dirty dual-track local DBs with an actionable wipe message.

## Non-goals

- Auto-mapping dirty production-like dual-track data (`status` / `compatible` collisions).
- Closing TD-042 (production cutover rehearsal).
- Adding cutover SQL to `db:migrate` discovery.

## Design

1. **Semantic-only M1 by default** (`includeLegacyFlatIdentity: false`): seed projects, modules, mappings, DTS files, semantic ingest, vendor docs, binding-revision demo history. Skip flat defs / PPV / PPV history.
2. **`ensureLocalPostCutoverIdentity`**: if cutover marker exists → idempotent return; if flat rows or unbound workflow rows exist → throw wipe guidance; else `migrateParameterIdentities({ mode: "apply", … })` with fixed local token `local-dev-post-cutover`, then `applyParameterIdentityCutover`.
3. **Opt-out**: `WISEEFF_SEED_LEGACY_FLAT_IDENTITY=1` restores dual-track seed and skips local finalize (typed submit remains blocked).
4. **Production path unchanged**: `PARAMETER_IDENTITY_MAINTENANCE_TOKEN` + runbook still govern real cutovers.

## Acceptance

- Fresh volume + `db:seed:m1` → `parameter_identity_cutovers` nonempty; `mustUseSemanticParameterIdentity` true.
- Workbench: create ≥1 typed draft and submit for review without cutover 409.
- Dirty dual-track DB → seed finalize fails with wipe message; no silent apply.
