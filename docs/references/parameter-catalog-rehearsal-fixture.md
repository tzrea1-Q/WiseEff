# Parameter Catalog Populated Rehearsal Fixture

> Chinese: [中文](../zh-CN/references/parameter-catalog-rehearsal-fixture.md)

This checksum-locked Wayfinder asset produces an executable PostgreSQL rehearsal input for the future replacement parameter-catalog migration. It combines a read-only structural and aggregate profile of the populated self-hosted database with a deterministic, non-sensitive row-level graph. It is planning and migration-design evidence, not a production backup, production migration, or release-readiness claim.

No source database row is copied. The populated graph is generated from checked-in SQL whose identifiers start with `wf671-` and whose values are explicit synthetic placeholders.

The historical source commit is `6c3adfc35c0e3be6d5d381013dace9408190380e`; its historical bundle SHA-256 is `017b3e614f1f4eba5a70f0c6b0cd3316b7e5ebd1aa9ccec4cf8e514c56dba7ff`. Both are immutable provenance only. They are not executable trust and are never recomputed from repaired bytes. The external source-lock test pins the repair commit `R`, the exact original 18 paths and regular-file modes, every repaired blob hash, and the new length-framed bundle checksum `B` without including itself.

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

The importer treats this as a closed-world set. It rejects missing files, unknown entries, symlinks, directories, devices, sockets, FIFOs, other non-regular entries, missing or duplicate checksum entries, unsafe names, path traversal, checksum mismatch, and manifests that do not describe format 2 of the populated fixture. These checks happen before hashing or database access. The manifest retains the historical source/checksum and pins the exact `synthetic-fixture-verify.sql` checksum.

The exporter applies the same closed-world regular-file check to its registered repository SQL inputs and generated artifact set. It secret-scans every registered source and every generated schema, profile, manifest, output, and log before publishing the archive. Import repeats the scan over every registered artifact. A failure cleans every exporter-owned staging/output path; partial output is never retained.

The source profile records relation structure, immutable migration names and checksums, exact relation counts, closed-enum/presence/alignment buckets, invariant counts, and logical/schema/file/archive SHA-256 checksums. PostgreSQL's per-run `\restrict` nonce is excluded only from the canonical dump checksum; the file checksum protects the exact dump bytes.

On import, the schema, profile CSVs, safe migration names/checksums, synthetic graph, and graph verification execute in one transaction. The migration ledger uses a fixed synthetic timestamp, keeping the restored 0128 schema executable by later append-only migration tooling without exporting original deployment timestamps. Any late failure rolls the entire target back to checked-empty, verifies that cleanup, removes importer-owned temporary output, and only then emits `CLEANUP_OK`; cleanup failure fails the command.

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
| `legacy-twin-r6-r8` | One R6 subjectless/unlinked Platform DTS staging row and one R8 Organization manual NodeType proposal share `synthetic.legacy-twin` while retaining separate identities and relation graphs |

The legacy twin deliberately isolates the same-key hazard from the formal catalog examples. The R6 row keeps `semantic_module=synthetic.unlinked`, no organization, no subject, no schema link, and no binding. The R8 row keeps `semantic_module=synthetic.node`, its Organization NodeType subject, and its module/binding/revision graph. Neither formal Platform definition uses `synthetic.legacy-twin`.

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
loaded_fixture_cases=10
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

Prepare two absolute, regular non-symlink files:

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

Before opening a database session, the PostgreSQL-aware input lexer rejects transaction, session, and psql escape. This includes `COMMIT WORK`, top-level `END`, prepared transactions, savepoints, `COPY ... FROM STDIN`, every psql meta-command (including `\i`, `\ir`, `\gexec`, `\gset`, `\copy`, `\connect`, `\!`, and `\q`), autocommit changes, role/search-path/session mutation, and dynamically executed control SQL. PostgreSQL comments, strings, quoted identifiers, nested block comments, dollar quoting, and PL/pgSQL block `BEGIN`/`END` are distinguished rather than checked by a text grep.

The runner checksum-matches the locked verifier to the imported manifest, secret-scans both SQL inputs and every generated dump/log, and executes `synthetic-fixture-verify.sql` exactly three times: before candidate mutation; after candidate plus validation and immediately before rollback; and after rollback. It hashes canonical full database dumps before and after and succeeds only if both hashes are identical. All runner-owned temporary files and child processes must be gone before the one success marker `CLEANUP_OK` is emitted. Expected output includes:

```text
FIXTURE_VERIFY_BEFORE_OK
FIXTURE_VERIFY_AFTER_CANDIDATE_OK
FIXTURE_VERIFY_AFTER_ROLLBACK_OK
REHEARSAL_ROLLBACK_OK
target_database=wiseeff_wayfinder671_restore_<suffix>
before_sha256=<64 lowercase hex characters>
after_sha256=<the same value>
fixture_cases=10
CLEANUP_OK
```

This proves that a transaction-safe candidate can map and validate the populated graph without leaving durable changes. It does not prove that an as-yet undesigned replacement migration has correct destination semantics.

Candidate validation for `legacy-twin-r6-r8` must preserve both legacy IDs and their source attribution graphs. R6 may become only `Observation`, `ReviewEvidence`, or `Archive`; R8 may become only `Proposal`, `Observation`, or `Archive`. Property-key equality must never merge them, reattribute either row, infer a formal subject, activate either legacy row, or materialize one or more current Definitions. A future authoritative Platform definition can only come from the separately governed Catalog Release synchronizer, not from this twin.

## Automated PostgreSQL gate

The integration test requires a reachable real PostgreSQL instance and its Docker container:

```bash
npm run test:scripts -- scripts/wayfinder/parameter-catalog-rehearsal.integration.test.ts
```

It proves the source/artifact closed worlds, lexer/session/psql denial matrix, full generated-artifact secret scanning, cleanup failure behavior, atomic populated export/import, all fixture cohorts, strict manifest rejection, true empty-database rejection, candidate validation, same-key R6/R8 separation, rejection of a property-key merge candidate, three graph verifications, and canonical-dump rollback equality.

When finished, drop only the explicitly named disposable database:

```bash
docker exec -i <local-postgres-container> \
  dropdb -U wiseeff wiseeff_wayfinder671_restore_<suffix>
```

## Evidence boundary

The retained source profile remains aggregate evidence from the populated self-hosted database. The `wf671-` graph is representative synthetic data derived from those observed cohorts, not a redacted row-for-row production clone. Static/source-lock results are D/L evidence. A selected, non-skipped run against a real local PostgreSQL server is PG evidence only. Neither local synthetic nor local PG results imply Hosted, target-host, release, production approval, or compatibility-window evidence.
