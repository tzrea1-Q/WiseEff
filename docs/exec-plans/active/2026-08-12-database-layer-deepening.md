# Database Layer Deepening Program (C1–C5)

Status: **Active** (C1/C5/C3 merged; C2 conversion and C4 continue under shared/other ownership — see table) · Started 2026-08-12 · Owner: architecture session 2026-08-12

## Goal

Execute the five deepening candidates from the 2026-08-12 database-layer architecture review, in dependency order. The aim is testability and AI-navigability: shrink interfaces, concentrate behaviour behind seams, and make the test surface behavioural instead of SQL-text-shaped.

| Candidate | One-line goal | Status |
| --- | --- | --- |
| C1 Transaction seam | `Database.transaction` hands the callback a full `Database` (savepoint-backed nesting); delete inline fakes, casts, duck-typing | **Merged** — #317 |
| C5 Migration paper cuts | Directory-computed pending expectations; consolidated runner with `{ before \| through }`; advisory lock + checksum in `applyMigrations`; generated `db-schema.md` with check gate (closes TD-004) | **Merged** — #329 (replaced auto-closed #320) |
| C3 Identity single seam | `parameterIdentityMode.ts` resolved once at wiring; all 33 fork sites dispatch synchronously; `cutoverAwareIdentity.ts` deleted; per-call DB probes gone | **Merged** — #328. Legacy SQL text intentionally stays inline until the repository split re-homes each function once (see C4) |
| C2 Test surface | Per-worker template databases (fixture) + behavioural repository tests | **Split ownership**: the per-worker fingerprinted-template fixture was implemented by a parallel session (in flight); the behavioural test conversion is tracked as **TD-079** and rides on that fixture once it lands |
| C4 Parameters repository split | Split the function bag by domain subject; shared change-request projection; concentrate legacy SQL into `legacyParameterIdentityAdapter` | **Ceded to** `docs/exec-plans/active/2026-08-12-parameters-repository-split.md` (slice 1 merged as #321: `projectRepository`, `reviewWorkflowRepository`). Carry-over asks for that plan: consolidate the six change-request projections (they differ subtly — `source_node_path` source and `getChangeRequestById` extra columns are intentional, design before merging), move legacy SQL branches into the adapter, and require `Database` in signatures of lock-taking functions |

TD-042 still gates deleting the legacy identity adapter; `legacyDependencyGuard.test.ts` keeps fencing legacy tokens.

## Background (review evidence)

- `server/shared/database/client.ts` `transaction()` downgrades its callback to `Queryable`; callers respond with inline fake `Database` objects (`server/modules/logs/service.ts:196-298`), `db as Database` casts (`server/modules/parameter-files/releaseReadinessService.ts:383`), and runtime duck-typing (`server/modules/agent/tools/actionTools.ts:59-88`, `server/modules/parameter-topology/migration.ts:82-87`). Nested transactions are silently flattened; no savepoints. ~35 test files hand-copy `transaction: (fn) => fn(tx)` stubs.
- `applyMigrations` takes `Queryable` and hand-writes `begin`/`commit`; on a pooled `Database` atomicity is accidental. No concurrency lock (the test path has one; the production path does not), no content checksum.
- `server/modules/parameter-topology/schemaMigration.test.ts:54-89` hard-codes the full pending list with `toEqual`; five registration-only commits in three months (0091, 0092, 0093, 0095, 0101). `applyMigrationsThrough` is copied in 4 files.
- `docs/generated/db-schema.md` claims to be generated but is hand-written, stale (header says 0092 / 2026-07-18), and unchecked by `npm run docs:check` — in contrast to the OpenAPI `contract:openapi` / `contract:check` pair.
- Repository unit tests queue canned rows into hand-rolled fake DBs (copied into 36+ files) and assert on SQL substrings — 115 assertions in `parameters/repository.test.ts`, 99 in `debugging`. The real-DB fixture (`server/testing/testDatabase.ts`) serialises every DB test on advisory lock `4_201_658` (vitest `maxWorkers` pinned to 2) and implements `transaction()` as a passthrough, so commit/rollback semantics are never tested. Because fake stubs answer the cutover probe with "not cut over", unit tests exercise the legacy identity SQL branch.
- `mustUseSemanticParameterIdentity(db)` forks 19 repository functions in `server/modules/parameters/repository.ts` (plus service, debugging, parameter-files call sites), each branch carrying a complete duplicate SQL query; the ~30-column change-request projection appears 6 times verbatim (L3741/3798/3856/3914/3987/4047). TD-042 blocks deleting the legacy path (production cutover rehearsal pending), so C3 collapses the seam without deleting the legacy adapter.

## Architecture decisions

1. **`Database.transaction<T>(fn: (tx: Database) => Promise<T>)`** — the callback receives the same interface. Nesting maps to `SAVEPOINT sp_<depth>` / `RELEASE` / `ROLLBACK TO`. `Queryable` stays the parameter type for repository functions that only need to participate; `Database` is the parameter type for functions that must own a transaction.
2. **Migrations run through the client's own transaction primitive** (`applyMigrations(db: Database, dir)`), take `pg_advisory_xact_lock` per file, re-check pendingness inside the lock, and record a SHA-256 checksum in `schema_migrations`; a mismatch on an already-applied file fails loudly.
3. **Test isolation moves from one shared advisory lock to one database per vitest worker** (created from a migrated template), with the outer BEGIN + rollback pattern kept per test and `transaction()` implemented with real savepoints. `createInMemoryTestDatabase` keeps its call signature (rename is follow-up).
4. **`docs/generated/db-schema.md` becomes machine-generated** from `information_schema` of a freshly migrated disposable database, with a check script wired into `npm run docs:check` (skips with a warning when no database is reachable, mirroring test behaviour).
5. **Identity model is resolved once at wiring time** (C3): repository modules receive the mode (or the composed adapter) instead of probing per call. Legacy SQL variants concentrate in `legacyParameterIdentityAdapter.ts` (already exists) so post-TD-042 deletion is one file removal. `legacyDependencyGuard.test.ts` continues to fence tokens.

## Tasks

### C1 — `refactor/db-transaction-seam`

1. `server/shared/database/client.ts`: savepoint-backed nested `transaction`; shared helper reused by both factories; callback type becomes `Database`.
2. `server/shared/database/migrations.ts`: accept `Database`, use `db.transaction` per migration file (lock/checksum deferred to C5).
3. `server/testing/testDatabase.ts`: fixture `transaction()` becomes savepoint-based inside the outer BEGIN.
4. Delete footguns: `logs/service.ts` inline fake `Database`; `releaseReadinessService.ts:383` cast; `actionTools.ts` duck-typing forks; `parameter-topology/migration.ts` `requireTransactionalDb` (require `Database` in signatures instead).
5. Mechanically fix hand-rolled test stubs (`transaction: (fn) => fn(self)`), or route them through one shared helper.
6. Update `client.test.ts` / `testDatabase.test.ts` with nested-commit, nested-rollback, and aborted-state-recovery coverage.

### C5 — `refactor/db-migration-pipeline`

1. `schemaMigration.test.ts`: compute expected pending tails from `server/migrations/` directory listing; keep fixed-point constants only where they define `applyMigrationsThrough` boundaries. Add a numbering invariant (unique 4-digit prefixes, monotonic ordering) to `shared/database/migrations.test.ts`.
2. Extract one shared `applyMigrationsThrough` test helper; delete the 4 copies.
3. `applyMigrations`: `pg_advisory_xact_lock` + pending re-check per file; `checksum` column (added via `alter table if not exists` bootstrap) with fail-loud mismatch.
4. New `scripts/generate-db-schema-doc.ts` + `scripts/check-db-schema-doc.ts`; npm scripts `db:schema-doc` / `db:schema-doc:check`; wire the check into `npm run docs:check` with database-unavailable skip; regenerate `docs/generated/db-schema.md`.

### C2 — `refactor/db-test-fixture`

1. `server/testing/testDatabase.ts`: template database (`wiseeff_test_template`) migrated once; per-worker databases (`wiseeff_test_w<id>`) created from the template; drop the global advisory lock; keep outer BEGIN + rollback per test; savepoint `transaction`.
2. `vitest.server.config.ts`: unpin `maxWorkers`; revisit the 30s timeout.
3. Convert `parameters/repository.test.ts` exemplar cases (tenancy, draft upsert, change-request list/find/get) from SQL-substring assertions to behavioural assertions against the fixture; extract the one shared `createFakeDb` for the few remaining SQL-shape checks.
4. Record the conversion pattern in `docs/design-docs/testing-strategy.md`; file remaining bulk conversion as a tech-debt entry with counts.

### C3 — `refactor/parameter-identity-single-seam`

1. Resolve identity mode once (startup wiring in `server/index.ts` / app options; tests choose explicitly).
2. For each of the 19 forked repository functions: keep the semantic query in place, move the legacy query into `legacyParameterIdentityAdapter.ts` (or a sibling), dispatch at module wiring rather than per call.
3. Remove probe special-casing from test stubs; delete `cachedCutoverComplete` global.
4. Amber constraint: **do not delete** the legacy adapter while TD-042 is open.

### C4 — `refactor/parameters-repository-split`

1. Split `parameters/repository.ts` by domain subject: binding drafts, submission/change-request workflow, projects, imports (+ existing dashboard/ and parameterModuleRepository seams).
2. One shared change-request projection fragment (follow `users/repository.ts:75-96` precedent).
3. Functions that take row locks require `Database` (or a transaction-witness type) in their signature.
4. Re-point the 8 cross-module import sites and `routes.ts` read endpoints through the new module interfaces.
5. Collect `dateTimeToIso` (×20) and `addCondition` (×4) into `server/shared/database/`.

## Verification

- `npm run test:server` (requires local Postgres; per-worker fixture must keep `isTestDatabaseAvailable` skip behaviour)
- `npm run test:all` before each PR
- `npm run build` (server TS surface changes)
- `npm run docs:check` (C5 wires db-schema check in)
- Concurrency: two parallel `npm run db:migrate` runs against one database must serialise (C5)

## Git & PR Workflow

Feature branches from latest `main`, one per candidate as tabled above. This session's parent agent implements, verifies, opens PRs, and merges in dependency order (C1 → C5 → C2 → C3 → C4), syncing local `main` between merges. No pushes to `main`; no force pushes. User worktree changes under `packages/device-*`, `server/modules/dts-reload/{deploy,kernelSignal}*`, `docs/zh-CN/design-docs/domain-model.md`, and `src/components/admin/ReloadConfigurationAdminPanel.tsx` are untouched and never staged.

## Documentation Impact Matrix

| Area | File(s) | Impact |
| --- | --- | --- |
| Repository maps | `AGENTS.md`, `ARCHITECTURE.md` | No change (module layout unchanged until C4; revisit in C4 PR) |
| Planning docs | `docs/PLANS.md` (§ Current Active Plan), this plan | Update |
| Product specs | `docs/product-specs/*` | No change (no product behaviour change) |
| Architecture docs | `docs/design-docs/full-stack-architecture.md` | Review in C1 (transaction semantics), C3 (identity wiring) |
| Domain model | `docs/design-docs/domain-model.md` | No change (C3 keeps domain semantics; only wiring changes) |
| Quality/testing docs | `docs/design-docs/testing-strategy.md`, `docs/QUALITY_SCORE.md` | Update in C2 (fixture + behavioural-test pattern) |
| Reliability/runbooks | `docs/runbooks/parameter-identity-cutover.md` | Review in C3 (probe → wiring note) |
| Security/governance | `docs/SECURITY.md` | No change |
| Frontend/design docs | `docs/FRONTEND.md` | No change |
| Generated artifacts | `docs/generated/db-schema.md`, `docs/generated/openapi.json` | Update in C5 (db-schema becomes generated); openapi no change |
| References | `docs/references/*` | No change |
| Chinese companions | `docs/zh-CN/…` mirrors of any updated developer-facing page | Update alongside each English page touched |
| Tech debt | `docs/exec-plans/tech-debt-tracker.md` | Update (bulk test conversion residue after C2; legacy adapter deletion blocked on TD-042) |

## Documentation Update Gate

Blocking before this plan moves to `completed/`:

- [x] `docs/PLANS.md` entry added; plan status kept current (this revision)
- [x] `docs/generated/db-schema.md` regenerated and gated via `docs:check` (C5)
- [x] `docs/design-docs/full-stack-architecture.md` reviewed for C1/C3 — unchanged: it states transaction/authz rules at a level that is unaffected (no callback-type or probe wording)
- [x] `docs/runbooks/parameter-identity-cutover.md` reviewed for C3 — unchanged: it documents the maintenance-window procedure, not the runtime probe; `localPostCutover` still resolves the mode after applying cutover
- [x] Deferred work recorded: behavioural test conversion → TD-079; legacy adapter deletion → TD-042 (unchanged blocker); repository split carry-overs → `2026-08-12-parameters-repository-split.md`
- [ ] Remaining before `completed/`: TD-079 conversion done or explicitly re-scoped, and the C4 carry-overs above absorbed by the split plan
- Testing-strategy doc note: the behavioural-test pattern write-up moves with TD-079 (the fixture that enables it landed outside this plan), so `docs/design-docs/testing-strategy.md` is intentionally not updated in this revision
