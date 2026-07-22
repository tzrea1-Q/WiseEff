# Parameter Identity Cutover Runbook

> Chinese: [Chinese](../zh-CN/runbooks/parameter-identity-cutover.md)

Atomic maintenance-window cutover from path-derived parameter identity to source/effective DTS topology, versioned specs, and stable project bindings.

**Hard rule:** if `--apply` or cutover SQL fails, stop. Restore the whole DB + object-store snapshot. Do **not** continue partially, dual-write, or hand-fix live rows.

Evidence path for rehearsals: `work/cutover-rehearsal/<YYYYMMDD-HHMM>/`.

## Preconditions

- Feature build that includes migration `0048`, semantic APIs under `/api/v2`, and this runbook is already deployed to the maintenance target (or staged beside it).
- Operator holds `PARAMETER_IDENTITY_MAINTENANCE_TOKEN` matching the target env.
- PostgreSQL and object-store backup tooling from [backup-restore.md](backup-restore.md) are available.
- Run `npm run dts:toolchain:bootstrap` in the deployed checkout. It prepares the ignored project venv `.wiseeff-tools/dts-toolchain`; the API and release checks use the same resolver and pinned versions in `tools/dts-toolchain/versions.json` (dtc/fdtoverlay `1.8.1`, dtschema `2026.6`). Do not rely on an operator's personal Python PATH.

## 1. Write freeze

Stop parameter and config writes before snapshots:

```bash
# Prefer traffic drain + API write-freeze at the edge. Record wall-clock start.
export CUTOVER_WRITE_FREEZE_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
# Confirm no in-flight parameter/config workers if your deployment runs them.
# Do not accept new parameter drafts, imports, structured edits, or baseline releases.
```

Keep the freeze until post-observation or whole-snapshot restore completes.

## 2. Capture snapshot IDs

Record durable snapshot identifiers (replace with your provider IDs):

```bash
export DB_SNAPSHOT_ID="pg-snap-$(date -u +%Y%m%d%H%M%S)"
export OBJECT_SNAPSHOT_ID="obj-snap-$(date -u +%Y%m%d%H%M%S)"
echo "DB_SNAPSHOT_ID=${DB_SNAPSHOT_ID}"
echo "OBJECT_SNAPSHOT_ID=${OBJECT_SNAPSHOT_ID}"
# Perform the real PostgreSQL + object-store snapshots now, then store both IDs in the rehearsal folder.
```

Whole-snapshot restore later must use **both** IDs together.

## 3. Toolchain health

```bash
npm run dts:toolchain:bootstrap
npm run dts:toolchain:check -- --required
npm run dtc:check -- --required
npm run dts:config:validate
```

Expected: tools present **and** versions match `tools/dts-toolchain/versions.json`. `dts:toolchain:check --required` fails on missing binaries, unparseable `--version` output, or version mismatch. Abort if the pin check fails — production publish is fail-closed.

## 4. Dry-run migration

Apply all forward SQL migrations first. In particular, migrations `0059` through `0063` must exist in `schema_migrations` before accepting post-cutover typed drafts. Migrations 0060/0061 record and delete every candidate-less draft across all origins; 0062 persists `set|delete`; 0063 persists the exact candidate revision on submission items and change requests. Never guess a candidate for an existing workflow row: historical rows left null by 0063 must be rejected and recreated through typed edit.

During the write freeze, capture candidate-less draft counts and open semantic requests with null candidate identity. After 0061, active candidate-less drafts must be zero. After 0063, every newly submitted item/request must share one non-null candidate ID. Exact submission locks draft+candidate/evidence, proves set/delete, and atomically promotes `draft -> pending_approval`. Merge locks and revalidates that exact candidate. Reject and recreate any pre-0063 open semantic request whose candidate is null; do not merge or backfill it.

```bash
psql "$DATABASE_URL" -c "select name from schema_migrations where name between '0059_binding_draft_submission_identity.sql' and '0063_parameter_submission_candidate_identity.sql' order by name;"
psql "$DATABASE_URL" -c "select table_name, column_name from information_schema.columns where table_schema = 'public' and table_name in ('parameter_drafts', 'parameter_submission_items', 'parameter_change_requests') and column_name in ('candidate_config_revision_id', 'action') order by table_name, column_name;"
psql "$DATABASE_URL" -c "select count(*) as active_drafts_without_candidate from parameter_drafts where candidate_config_revision_id is null;"
psql "$DATABASE_URL" -c "select organization_id, project_id, draft_origin, count(*) as invalidated_drafts from parameter_draft_identity_invalidations group by organization_id, project_id, draft_origin order by organization_id, project_id, draft_origin;"
psql "$DATABASE_URL" -c "select count(*) as blocked_open_requests_without_candidate from parameter_change_requests where status not in ('merged','rejected','withdrawn') and project_parameter_binding_id is not null and candidate_config_revision_id is null;"
```

```bash
npm run parameter-identities:migrate
```

Dry-run is **read-only**: it never `CREATE`/`ALTER`/`INSERT`/`UPDATE`. Migration infrastructure tables come from formal migration `0049`. The migrator wraps dry-run in a transaction that always rolls back.

Inspect JSON counters before apply:

- `exactMatched` / `reviewedMatched` — releasable mapped definitions only
- `inferredPendingReview` — must be **0** (inferred drafts never count as mapped; unaudited inferred blocks cutover)
- `ambiguousRecords` / `unmappedRecords` / `brokenHistoryChains` / `blockers` — must all be zero / empty

Dry-run must not mask inferred rows as mapped.

**TD-042:** Until a legal clean non-customer snapshot rehearsal (apply → check → cutover → whole-DB restore → old API smoke) completes, treat production cutover as **BLOCKED**. Temp-DB / dirty shared-DB evidence is not enough.

## 5. Ambiguity and spec backlog checks

```bash
# Open identity mapping tasks must be zero before finalize (stage-review may leave open inferred tasks).
psql "$DATABASE_URL" -c "select count(*) as open_mapping from identity_mapping_tasks where status = 'open';"
psql "$DATABASE_URL" -c "select count(*) as open_spec_reviews from parameter_spec_review_tasks where status = 'open';"
npm run parameter-identities:check
```

Resolve every open mapping/spec review in Admin UI (`/parameter-admin`) before **finalize**. Preflight blockers are stop-ship for finalize and cutover; `stage-review` may persist open inferred tasks intentionally.

## 6. Compile-all configs

```bash
npm run dtc:seed:compile
npm run dts:config:validate
# For each production config set under maintenance, run release-mode validation via Admin
# or POST /api/v2/projects/:projectId/config-revisions/:revisionId/validate
```

Every effective DTB / config revision used in production must pass fail-closed toolchain validation. Golden project-primary DTS files (`aurora-board.dts`, `nebula-board.dts`, `atlas-board.dts`) must compile with `failOnSchema: true` and pass real `dt-validate`. Tests lock **176** semantic property occurrences per ingest revision and **684** structural `dts_properties` rows in M1 seed (228 parsed properties × 3 projects).

## 7. Stage review (inferred specs and evidence)

Production cutover with inferred parameter specs uses a durable two-phase migration. `stage-review` commits inferred drafts, review tasks, definition-level evidence, and a `staged` migration run in its **own** PostgreSQL transaction. It does **not** write activity/workflow semantic foreign keys (bindings, history FKs, drafts, change requests).

```bash
export PARAMETER_IDENTITY_MAINTENANCE_TOKEN='<same token as target env>'
npm run parameter-identities:migrate -- \
  --stage-review \
  --maintenance-token "$PARAMETER_IDENTITY_MAINTENANCE_TOKEN" \
  --write-lock-confirmed \
  --db-snapshot-id "$DB_SNAPSHOT_ID" \
  --object-snapshot-id "$OBJECT_SNAPSHOT_ID"
```

Capture `migrationRunId` from the report JSON. The run status is `staged` even when `blockers` lists inferred pending review — resolve those in Admin before finalize. Each `stage-review` also appends an immutable row to `parameter_identity_migration_phases` (phase=`stage-review`); finalize appends a separate phase row and only then flips the logical run to `finalized` without overwriting the staged report. Inferred spec-review and identity-mapping tasks created during staging carry `migration_run_id` so finalize can require backlog clearance for **that run only**.

**On failure:** whole-snapshot restore (section 13). Do not retry against a dirty DB.

## 8. Resolve inferred / mapping backlog

In `/parameter-admin`, resolve every open inferred spec review and identity mapping task tied to the staged run (`migration_run_id = '<migrationRunId>'`). Re-run checks:

```bash
psql "$DATABASE_URL" -c "select count(*) as open_inferred from parameter_spec_review_tasks where status = 'open' and migration_run_id = '<migrationRunId>';"
psql "$DATABASE_URL" -c "select count(*) as open_mapping_for_run from identity_mapping_tasks where status = 'open' and migration_run_id = '<migrationRunId>';"
npm run parameter-identities:check
```

For unmatched inferred properties, use `createSpec: true` on resolve to create an org-owned **draft** spec, then Admin **activate** (`POST /api/v2/parameter-specs/:specId/activate`) before resolving the review task. Only active+complete specs may resolve.

## 9. Finalize migration (activity FKs + bindings)

`finalize` references the staged `migrationRunId`, requires all review/mapping tasks **for that run** resolved, and atomically writes bindings, binding revisions, value evidence, and activity/workflow semantic FKs in **one** transaction. Failure rolls back finalize only; staged artifacts and the `stage-review` phase row remain. On success, a new `parameter_identity_migration_phases` row (phase=`finalize`) is appended and the logical run status becomes `finalized`.

```bash
npm run parameter-identities:migrate -- \
  --finalize \
  --migration-run-id '<migrationRunId>' \
  --maintenance-token "$PARAMETER_IDENTITY_MAINTENANCE_TOKEN" \
  --write-lock-confirmed
```

Run status becomes `finalized`. Cutover accepts **only** `finalized` runs that also have a successful `finalize` phase row; forged run status or staged-only runs are rejected.

**On failure:** staged data remains; fix blockers and retry finalize, or whole-snapshot restore (section 13).

### One-shot apply (rehearsal / temp DB only)

For clean snapshots with zero inferred blockers, `--apply` remains a single-transaction shortcut that writes staging + activity together and records `finalized`. It is not suitable when inferred review tasks are still open — use stage → finalize instead.

```bash
npm run parameter-identities:migrate -- \
  --apply \
  --maintenance-token "$PARAMETER_IDENTITY_MAINTENANCE_TOKEN" \
  --write-lock-confirmed \
  --db-snapshot-id "$DB_SNAPSHOT_ID" \
  --object-snapshot-id "$OBJECT_SNAPSHOT_ID"
```

**On any failure or non-empty `blockers`:** restore whole snapshot (section 13). Direct apply rollback must not remove artifacts from a prior committed `stage-review`.

## 10. Atomic schema cutover

```bash
npm run parameter-identities:cutover -- --migration-run-id '<migrationRunId>'
```

This runs `server/cutovers/2026-07-16-parameter-identity-cutover.sql` inside one transaction (not discovered by `db:migrate`).

**On failure:** whole-snapshot restore only. Never continue with partial FK swaps or archived tables.

## 11. Postflight

```bash
npm run parameter-identities:check
psql "$DATABASE_URL" -c "select * from parameter_identity_cutovers;"
curl -sS "$WISEEFF_API_BASE_URL/metrics" | rg 'wiseeff_parameter_identity_|wiseeff_dts_toolchain_ready|wiseeff_identity_mapping'
```

Expected: check `ok: true`, cutover marker present, migration complete gauge `1`, open mapping gauge `0`.

### Dedicated topology acceptance database

The full submit→review→merge→writeback acceptance is a **post-cutover** test. `parameter-topology.acceptance.spec.ts` creates its own `wiseeff_acceptance_disposable_*` database on the PostgreSQL server named by `DATABASE_URL`, applies all migrations plus identity apply/cutover, and writes a test-only marker. It starts isolated API/frontend ports and drops the database only after rechecking the generated name, marker purpose, and exact cutover migration run.

```bash
psql "$DATABASE_URL" -c "select id, migration_run_id, applied_at from parameter_identity_cutovers;"
```

The acceptance suite checks that marker before creating the typed-edit business write. Never point cleanup at a shared database, cut over a shared developer database in place, or treat a draft preview revision as the semantic merge candidate. This disposable flow does not replace the TD-042 clean non-customer snapshot apply→cutover→whole-DB restore rehearsal.

## 12. Application switch

Deploy / enable the semantic-identity application build that:

- serves `/api/v2` parameter-spec / topology / binding routes
- retires flat legacy parameter ID contracts with `410 legacy-parameter-id-retired`
- uses source vs effective topology UI on `/parameters` and `/parameter-admin`

Smoke:

```bash
curl -sS -H "Authorization: $TOKEN" "$WISEEFF_API_BASE_URL/api/v2/parameter-specs?limit=1"
curl -sS -H "Authorization: $TOKEN" "$WISEEFF_API_BASE_URL/health/ready"
```

## 13. Observation window

Watch for at least one release cycle (minimum 30–60 minutes for rehearsal; longer for production):

- Alerts: `WiseEffDtsToolchainUnavailable`, `WiseEffIdentityMappingBacklog`, `WiseEffConfigPublishValidationBypass`
- Grafana: WiseEff Overview panels for DTS toolchain, mapping backlog, cutover status
- Functional: typed binding edit, publish gate, mapping queue empty, no `recommendedValue` business fields

If severity critical fires or mapping backlog reappears, freeze writes again and restore (section 14).

## 14. Whole-snapshot restore (only rollback)

```bash
# Stop API/workers again if needed, then restore BOTH snapshots together.
# Use provider-specific restore with the IDs captured in section 2.
echo "Restoring DB_SNAPSHOT_ID=${DB_SNAPSHOT_ID}"
echo "Restoring OBJECT_SNAPSHOT_ID=${OBJECT_SNAPSHOT_ID}"
# After restore, redeploy the pre-cutover application build and prove it starts:
curl -sS "$WISEEFF_API_BASE_URL/health/ready"
npm run smoke:m5
```

Partial schema undo is forbidden. Restore is the only supported rollback.

## Related

- [backup-restore.md](backup-restore.md)
- [rollback.md](rollback.md)
- [observability-operations.md](observability-operations.md)
- Plan: `docs/exec-plans/active/2026-07-16-parameter-topology-schema-management.md`
- Workflow review: `docs/exec-plans/active/2026-07-16-parameter-topology-cutover-workflow-review.md`
- Round 4 blockers: `docs/exec-plans/active/2026-07-16-parameter-topology-round4-review-blockers.md`
- Source hygiene: Vitest `legacyDependencyGuard.test.ts` (migrations/cutovers/adapters allowlist only; not a runtime middleware)
