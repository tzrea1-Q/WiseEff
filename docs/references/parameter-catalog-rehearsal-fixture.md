# Parameter Catalog Populated Rehearsal Fixture

> Chinese: [中文](../zh-CN/references/parameter-catalog-rehearsal-fixture.md)

This branch-only Wayfinder asset produces an executable PostgreSQL rehearsal input for the future replacement parameter-catalog migration. It combines a read-only structural and aggregate profile of the populated self-hosted database with a deterministic, non-sensitive row-level graph. It is planning and migration-design evidence, not a production backup, production migration, or release-readiness claim.

No source database row is copied. The populated graph is generated from checked-in SQL whose identifiers start with `wf671-` and whose values are explicit synthetic placeholders.

## Artifact contract

The exporter obtains every source count and class report in one repeatable-read, read-only transaction, then runs `pg_dump --schema-only`. It refuses a changing migration inventory, data-bearing schema dump, or secret-shaped aggregate output.

The artifact contains exactly these checksum-protected files:

- `schema.sql`: source schema only, without owners, privileges, comments, or data statements;
- `profile-schema.sql`: tables under `wayfinder_rehearsal` for the source profile and fixture case registry;
- `synthetic-fixture.sql`: deterministic populated rows;
- `synthetic-fixture-verify.sql`: fail-closed relational assertions;
- `relations.csv`, `columns.csv`, `constraints.csv`, `indexes.csv`, and `triggers.csv`;
- `migration-inventory.csv`, `row-counts.csv`, `row-classes.csv`, and `invariant-counts.csv`;
- `manifest.csv` with `format_version=2`, `source_data_rows_exported=0`, and `import_populates_synthetic_rows=true`;
- `SHA256SUMS`, with exactly one safe entry for every other required file.

The importer treats this as a closed-world set. It rejects missing files, unknown files or directories, symlinks, missing or duplicate checksum entries, unsafe names, path traversal, checksum mismatch, and manifests that do not describe format 2 of the populated fixture.

The source profile records relation structure, immutable migration names and checksums, exact relation counts, closed-enum/presence/alignment buckets, invariant counts, and logical/schema/file/archive SHA-256 checksums. PostgreSQL's per-run `\restrict` nonce is excluded only from the canonical dump checksum; the file checksum protects the exact dump bytes.

On import, the safe migration names and checksums are also restored into `public.schema_migrations` with a fixed synthetic timestamp. This keeps the restored 0128 schema executable by later append-only migration tooling without exporting original deployment timestamps.

## Deterministic populated graph

`wayfinder_rehearsal.fixture_cases` is the stable public index for the fixture. Migration rehearsals should select by `case_name`, not depend on insertion order or internal IDs.

| Case | Populated relationship |
| --- | --- |
| `formal-platform-driver-definition` | Active Platform Driver definition, version, subject, DriverRegistration, DriverSchema property |
| `formal-platform-node-type-definition` | Active Platform NodeType definition, version, subject, NodeTypeDefinition, DriverSchema property |
| `platform-subjectless-dts-draft` | Platform DTS draft with neither formal subject nor DriverSchema link |
| `organization-manual-node-type-draft` | Organization manual draft attributed to an Organization NodeType |
| `driver-schema-root` | Separate Driver and NodeType root specs, versions, schemas, and schema versions |
| `organization-registration-placement` | Organization modules, mapping, registration category, and authoritative Driver placement |
| `binding-module-identity-mismatch` | Active Platform NodeType definition bound through a differently attributed module |
| `inactive-definition-binding` | Binding and pinned revision that reference a draft definition |
| `pinned-binding-revision` | Three bindings with spec-version-pinned revisions and one synthetic DTS config revision |

The graph creates no user or credential row. It contains no real organization, project, subject, source key, compatible, property key, schema namespace, DTS source, business description, parameter value, default, example, evidence payload, or workflow reason.

## Read-only export

Run from an isolated checkout of this branch. The output directory, archive, and archive checksum file must not already exist.

```bash
scripts/wayfinder/export-parameter-catalog-rehearsal.sh \
  --compose-file ops/self-hosted/compose.yaml \
  --env-file /absolute/path/to/ops/self-hosted/.env \
  --output-dir /absolute/path/to/wiseeff-wayfinder-671-export-YYYYMMDDTHHMMSSZ
```

The exporter records the database's exact applied migration inventory; it does not require the latest repository migration. It refuses to continue unless the required catalog relations exist and PostgreSQL proves the diagnostic transaction is read-only.

## Import into isolated PostgreSQL

Create a new database with the dedicated name prefix. The importer never creates, drops, truncates, or merges a database. It checks for relations, schemas, functions, types, operators, text-search objects, non-default extensions/languages, large objects, event triggers, publications, and foreign servers before restoring anything.

```bash
docker exec -i <local-postgres-container> \
  createdb -U wiseeff wiseeff_wayfinder671_restore_<suffix>

scripts/wayfinder/import-parameter-catalog-rehearsal.sh \
  --container <local-postgres-container> \
  --database wiseeff_wayfinder671_restore_<suffix> \
  --artifact-dir /absolute/path/to/unpacked-export
```

Expected terminal markers include:

```text
IMPORT_OK
target_database=wiseeff_wayfinder671_restore_<suffix>
loaded_fixture_cases=9
loaded_migration_ledger_rows=126
data_rows_exported=0
source_data_rows_exported=0
```

Inspect the populated contract without reading synthetic values:

```bash
docker exec -i <local-postgres-container> \
  psql -X -U wiseeff -d wiseeff_wayfinder671_restore_<suffix> \
  -c 'select case_name, relation_family, expected_rows from wayfinder_rehearsal.fixture_cases order by case_name'
```

## Candidate migration, validation, and rollback

Prepare two absolute, non-symlink files:

- the future candidate replacement migration, without transaction-control statements;
- candidate-specific validation SQL that raises an error if its destination invariants are not satisfied.

Then run both inside one PostgreSQL transaction:

```bash
scripts/wayfinder/rehearse-parameter-catalog-replacement.sh \
  --container <local-postgres-container> \
  --database wiseeff_wayfinder671_restore_<suffix> \
  --migration-file /absolute/path/to/candidate-migration.sql \
  --validation-file /absolute/path/to/candidate-validation.sql
```

The runner verifies all nine fixture cases first, hashes a canonical full database dump, executes candidate plus validation SQL with `ON_ERROR_STOP`, issues `ROLLBACK`, hashes the database again, and succeeds only if both hashes are identical. Expected output is:

```text
REHEARSAL_ROLLBACK_OK
target_database=wiseeff_wayfinder671_restore_<suffix>
before_sha256=<64 lowercase hex characters>
after_sha256=<the same value>
fixture_cases=9
```

This proves that a transaction-safe candidate can map and validate the populated graph without leaving durable changes. It does not prove that an as-yet undesigned replacement migration has correct destination semantics.

## Automated PostgreSQL gate

The integration test requires a reachable real PostgreSQL instance and its Docker container:

```bash
npx vitest run --config vitest.scripts.config.ts \
  scripts/wayfinder/parameter-catalog-rehearsal.integration.test.ts
```

It proves populated export/import, all fixture cohorts, strict manifest rejection, true empty-database rejection, candidate validation, and canonical-dump rollback equality.

When finished, drop only the explicitly named disposable database:

```bash
docker exec -i <local-postgres-container> \
  dropdb -U wiseeff wiseeff_wayfinder671_restore_<suffix>
```

## Evidence boundary

The retained source profile remains aggregate evidence from the populated self-hosted database. The `wf671-` graph is representative synthetic data derived from those observed cohorts, not a redacted row-for-row production clone. Local import and rollback success are local PostgreSQL evidence only; target migration and release readiness still require the later Wayfinder decisions and target-environment gates.
