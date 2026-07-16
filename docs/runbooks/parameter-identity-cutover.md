# Parameter Identity Cutover Runbook

> Chinese: [Chinese](../zh-CN/runbooks/parameter-identity-cutover.md)

Atomic maintenance-window cutover from path-derived parameter identity to source/effective DTS topology, versioned specs, and stable project bindings.

**Hard rule:** if `--apply` or cutover SQL fails, stop. Restore the whole DB + object-store snapshot. Do **not** continue partially, dual-write, or hand-fix live rows.

Evidence path for rehearsals: `work/cutover-rehearsal/<YYYYMMDD-HHMM>/`.

## Preconditions

- Feature build that includes migration `0048`, semantic APIs under `/api/v2`, and this runbook is already deployed to the maintenance target (or staged beside it).
- Operator holds `PARAMETER_IDENTITY_MAINTENANCE_TOKEN` matching the target env.
- PostgreSQL and object-store backup tooling from [backup-restore.md](backup-restore.md) are available.
- DTS toolchain binaries (`dtc`, `fdtoverlay`, `dt-validate`) are on `PATH` at the pinned versions in `tools/dts-toolchain/versions.json` (dtc/fdtoverlay `1.8.1`, dtschema `2026.6`).
- On macOS, `dt-validate` from pip is often under `~/Library/Python/3.9/bin` — export it onto `PATH` before release checks:
  `export PATH="$HOME/Library/Python/3.9/bin:$PATH"`.

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
npm run dts:toolchain:check -- --required
npm run dtc:check -- --required
npm run dts:config:validate
```

Expected: tools present **and** versions match `tools/dts-toolchain/versions.json`. `dts:toolchain:check --required` fails on missing binaries, unparseable `--version` output, or version mismatch. Abort if the pin check fails — production publish is fail-closed.

## 4. Dry-run migration

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
# Open identity mapping tasks must be zero before apply.
psql "$DATABASE_URL" -c "select count(*) as open_mapping from identity_mapping_tasks where status = 'open';"
# Open parameter spec review tasks must be zero before apply.
psql "$DATABASE_URL" -c "select count(*) as open_spec_reviews from parameter_spec_review_tasks where status = 'open';"
npm run parameter-identities:check
```

Resolve every open mapping/spec review in Admin UI (`/parameter-admin`) before continuing. Preflight blockers are stop-ship.

## 6. Compile-all configs

```bash
npm run dtc:seed:compile
npm run dts:config:validate
# For each production config set under maintenance, run release-mode validation via Admin
# or POST /api/v2/projects/:projectId/config-revisions/:revisionId/validate
```

Every effective DTB / config revision used in production must pass fail-closed toolchain validation.

## 7. Apply migration

```bash
export PARAMETER_IDENTITY_MAINTENANCE_TOKEN='<same token as target env>'
npm run parameter-identities:migrate -- \
  --apply \
  --maintenance-token "$PARAMETER_IDENTITY_MAINTENANCE_TOKEN" \
  --write-lock-confirmed \
  --db-snapshot-id "$DB_SNAPSHOT_ID" \
  --object-snapshot-id "$OBJECT_SNAPSHOT_ID"
```

Capture `migrationRunId` from the report JSON.

**On any failure or non-empty `blockers`:** restore whole snapshot (section 12). Do not retry apply against a dirty DB.

## 8. Atomic schema cutover

```bash
npm run parameter-identities:cutover -- --migration-run-id '<migrationRunId>'
```

This runs `server/cutovers/2026-07-16-parameter-identity-cutover.sql` inside one transaction (not discovered by `db:migrate`).

**On failure:** whole-snapshot restore only. Never continue with partial FK swaps or archived tables.

## 9. Postflight

```bash
npm run parameter-identities:check
psql "$DATABASE_URL" -c "select * from parameter_identity_cutovers;"
curl -sS "$WISEEFF_API_BASE_URL/metrics" | rg 'wiseeff_parameter_identity_|wiseeff_dts_toolchain_ready|wiseeff_identity_mapping'
```

Expected: check `ok: true`, cutover marker present, migration complete gauge `1`, open mapping gauge `0`.

## 10. Application switch

Deploy / enable the semantic-identity application build that:

- serves `/api/v2` parameter-spec / topology / binding routes
- retires flat legacy parameter ID contracts with `410 legacy-parameter-id-retired`
- uses source vs effective topology UI on `/parameters` and `/parameter-admin`

Smoke:

```bash
curl -sS -H "Authorization: $TOKEN" "$WISEEFF_API_BASE_URL/api/v2/parameter-specs?limit=1"
curl -sS -H "Authorization: $TOKEN" "$WISEEFF_API_BASE_URL/health/ready"
```

## 11. Observation window

Watch for at least one release cycle (minimum 30–60 minutes for rehearsal; longer for production):

- Alerts: `WiseEffDtsToolchainUnavailable`, `WiseEffIdentityMappingBacklog`, `WiseEffConfigPublishValidationBypass`
- Grafana: WiseEff Overview panels for DTS toolchain, mapping backlog, cutover status
- Functional: typed binding edit, publish gate, mapping queue empty, no `recommendedValue` business fields

If severity critical fires or mapping backlog reappears, freeze writes again and restore (section 12).

## 12. Whole-snapshot restore (only rollback)

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
- Source hygiene: Vitest `legacyDependencyGuard.test.ts` (migrations/cutovers/adapters allowlist only; not a runtime middleware)
