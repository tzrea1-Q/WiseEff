# Effective Driver Parameter Catalog Reconciliation

> Chinese: [中文运行手册](../zh-CN/runbooks/effective-driver-parameter-catalog-reconciliation.md)

Maintenance-window procedure for Issue #649. It repairs organization draft/platform
active twins without deleting history and leaves the release gate fail-closed until
every effective driver definition has a canonical subject, current active version,
and exactly one organization driver-group placement.

## Preconditions and stop rules

- Deploy migrations `0117_effective_driver_parameter_catalog.sql`,
  `0118_effective_driver_parameter_catalog_contract.sql`,
  `0119_effective_driver_parameter_catalog_finalize.sql`, followed by
  `0120_effective_driver_parameter_catalog_legacy_write_compat.sql`, with the
  application. The last migration is the compatibility boundary for legacy
  active DTS surface writes; it does not make an unlinked definition effective.
- Take a PostgreSQL and object-store snapshot. Keep the write freeze through
  verification and post-deploy observation.
- Stop on any non-zero command, a non-empty blocker report, or a failed verification.
  Do not delete dirty rows, edit applied migrations, or retry an apply against a
  changed database.

## Expand, classify, and repair

```bash
npm run db:migrate
npm run parameter-definitions:reconcile -- --dry-run
npm run parameter-definitions:reconcile -- --dry-run --organization-id '<org-id>'
```

Persisted run/item rows are the evidence record. Inspect `blockers`, candidate
subjects, placement modules, shape compatibility, and the observed binding-module
evidence. Unknown evidence, multiple active platform candidates, missing driver
evidence, curated identity changes, multiple active versions, ambiguous driver
placements, and identity collisions are blockers for human review; they are never
auto-deduplicated.

After the dry-run is approved:

```bash
npm run parameter-definitions:reconcile -- --apply --organization-id '<org-id>'
npm run parameter-definitions:check -- --organization-id '<org-id>'
```

`--apply` is idempotent and commits each organization in one transaction. It keeps
the old spec/version and binding history, mints a successor active version for a
repaired organization row, updates only the latest binding-revision tip, writes the
placement, and records a trusted system audit event. A failed organization rolls
back its catalog, binding, placement, and audit writes together.

## Contract and release gate

Run the check again after application and before releasing any config revision:

```bash
npm run parameter-definitions:check
psql "$DATABASE_URL" -c "select id, phase, status, report from parameter_definition_reconciliation_runs order by created_at desc limit 5;"
```

The check must report `status: "ready"`. The API effective view (`GET
/api/v2/parameter-specs`, default `view=effective`) must contain one row per
canonical driver/property identity. Use `view=governance` to inspect drafts,
deprecated rows, shadowed twins, and blockers. Release validation also blocks
unreviewed recognized driver tips and incomplete/duplicate effective catalog rows.

## Rollback

If an apply or post-deploy gate fails, stop writes and restore the paired database
and object-store snapshots. The reconciliation transaction is atomic, so there is
no supported partial SQL rollback and no destructive cleanup command. After restore,
run `npm run parameter-definitions:check` to establish the restored boundary; fix the
reported blocker in a new maintenance window and repeat dry-run before apply.
