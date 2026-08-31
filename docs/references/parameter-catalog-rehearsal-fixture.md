# Parameter Catalog Rehearsal Fixture

> Chinese: [中文](../zh-CN/references/parameter-catalog-rehearsal-fixture.md)

This branch-only Wayfinder asset captures the shape of a current populated PostgreSQL database without copying business rows. It is planning evidence for the replacement parameter-catalog migration, not a production backup, migration, or release-readiness artifact.

The exporter uses one repeatable-read, read-only PostgreSQL snapshot for every count and class report, then `pg_dump --schema-only`. It refuses the result if the migration inventory changes while the schema dump is captured. Its archive contains:

- schema-only DDL without owners, privileges, comments, or data statements;
- relation, column, constraint, index, and trigger metadata;
- the applied migration names and immutable checksums;
- exact counts for parameter/catalog/DTS relations;
- aggregate row classes built only from closed lifecycle/kind/source values and presence/alignment buckets; databases predating trusted-invocation columns report `initiator=column-absent` instead of reading a nonexistent field;
- aggregate invariant and migration-input counts;
- logical source-database, schema-metadata, canonicalized dump, file, and archive SHA-256 checksums. The canonical dump checksum excludes PostgreSQL's per-run `\\restrict` nonce; the file checksum still protects the exact dump bytes.

The archive deliberately contains no row identifiers, organization/project/user names, source keys, compatible strings, property keys, schema namespaces, descriptions, DTS source, evidence JSON, credentials, parameter values, defaults, examples, or workflow reasons. `data_rows_exported=0` is an import-time assertion.

## Export

Run from an isolated checkout of this branch. The output directory and archive must not already exist.

```bash
scripts/wayfinder/export-parameter-catalog-rehearsal.sh \
  --compose-file ops/self-hosted/compose.yaml \
  --env-file /absolute/path/to/ops/self-hosted/.env \
  --output-dir /absolute/path/to/wiseeff-wayfinder-671-export-YYYYMMDDTHHMMSSZ
```

The exporter records the exact applied migration inventory rather than requiring the latest repository migration. It refuses a database that is missing required catalog relations, cannot prove a read-only transaction, or produces a data-bearing schema dump or secret-shaped aggregate output.

## Local import

Create a fresh isolated PostgreSQL database whose name starts with `wiseeff_wayfinder671_restore_`. The importer never creates, drops, truncates, or overwrites a database.

```bash
scripts/wayfinder/import-parameter-catalog-rehearsal.sh \
  --container <local-postgres-container> \
  --database wiseeff_wayfinder671_restore_<suffix> \
  --artifact-dir /absolute/path/to/unpacked-export
```

The import restores the empty source schema and loads the aggregate profile into `wayfinder_rehearsal`. Query the planning evidence there; do not treat it as a row-level production clone or target-environment readiness evidence.
