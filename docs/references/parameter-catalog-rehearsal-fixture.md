# Parameter Catalog Populated and Zero-Inventory Rehearsal Fixture

> Chinese: [中文](../zh-CN/references/parameter-catalog-rehearsal-fixture.md)

This checksum-locked Wayfinder asset produces executable PostgreSQL rehearsal inputs for the future replacement parameter-catalog migration. Explicit `populated` mode combines a read-only structural and aggregate profile with a deterministic, non-sensitive row-level graph. Explicit `zero` mode retains the schema/profile and migration ledger, injects no synthetic graph, and executes zero-catalog-inventory predicates. It is planning and migration-design evidence, not a production backup, production migration, or release-readiness claim.

No source database row is copied. The populated graph is generated from checked-in SQL whose identifiers start with `wf671-` and whose values are explicit synthetic placeholders.

The historical source commit is `6c3adfc35c0e3be6d5d381013dace9408190380e`; its historical bundle SHA-256 is `017b3e614f1f4eba5a70f0c6b0cd3316b7e5ebd1aa9ccec4cf8e514c56dba7ff`. Both are immutable provenance only. They are not executable trust and are never recomputed from repaired bytes. The external source-lock test pins the exact checked-out 18 paths and regular-file modes, every repaired blob hash, and the new length-framed bundle checksum `B` without including itself. In a complete clone, the test reads and verifies repair commit `R`, its exact 18-path tree, parent/ancestry, and its single lock-only child. In a depth-one checkout, `R` may be unavailable and is never claimed as read: the test first requires the `HEAD` parent hash to equal the locked `R`, then verifies the `HEAD` tree and working-tree bytes and modes for all 18 paths against the embedded manifest and recomputes `B`. A shallow pass is checked-out source-lock evidence only; it is not evidence that the `R` object or historical provenance was read.

## Artifact contract

The exporter obtains every source count and class report in one repeatable-read, read-only transaction, then runs `pg_dump --schema-only`. It refuses a changing migration inventory, data-bearing schema dump, or secret-shaped aggregate output.

The artifact contains exactly these checksum-protected files:

- `schema.sql`: source schema only, without owners, privileges, comments, or data statements;
- `profile-schema.sql`: tables under `wayfinder_rehearsal` for the source profile and fixture case registry;
- `synthetic-fixture.sql`: deterministic populated rows, executed only in `populated` mode;
- `synthetic-fixture-verify.sql`: fail-closed mode-aware relational assertions;
- `relations.csv`, `columns.csv`, `constraints.csv`, `indexes.csv`, and `triggers.csv`;
- `migration-inventory.csv`, `row-counts.csv`, `row-classes.csv`, and `invariant-counts.csv`;
- `manifest.csv` with `format_version=2`, explicit `fixture_mode`, `source_data_rows_exported=0`, and a matching `import_populates_synthetic_rows` policy;
- `SHA256SUMS`, with exactly one safe entry for every other required file.

The importer accepts only the archive plus an externally supplied lowercase SHA-256 for those exact archive bytes. It opens the caller archive once, copies it through that file descriptor into a private immutable snapshot, verifies the external digest before extraction, and then treats the archive members as a closed-world set. The archive's sidecar and in-artifact `SHA256SUMS` are secondary integrity evidence, never the trust anchor. Missing or unknown members, unsafe roots, symlinks, directories, devices, sockets, FIFOs, other non-regular entries, missing or duplicate checksum entries, unsafe names, path traversal, checksum mismatch, psql meta-commands, and manifests whose format, mode, artifact kind, or import policy disagree all fail before database access. The manifest retains the historical source/checksum and pins the exact `synthetic-fixture-verify.sql` checksum.

The exporter applies the same closed-world regular-file check to its registered repository SQL inputs and generated artifact set. It secret-scans every registered source and every generated schema, profile, manifest, output, and log before publishing the archive. Import repeats the scan over every registered artifact. Publication uses private staging, an ownership marker, and same-inode links. Failure cleanup opens the parent and owned directory with `O_NOFOLLOW`, verifies inode and marker ownership, and deletes only through those directory file descriptors; a concurrent foreign replacement is preserved and makes cleanup fail closed.

The source profile records relation structure, immutable migration names and checksums, exact relation counts, closed-enum/presence/alignment buckets, invariant counts, and logical/schema/file/archive SHA-256 checksums. PostgreSQL's per-run `\restrict` nonce is excluded only from the canonical dump checksum; the file checksum protects the exact dump bytes.

On import, the schema, profile CSVs, safe migration names/checksums, optional populated graph, and mode-aware verification execute in one transaction. The migration ledger uses a fixed synthetic timestamp, keeping the restored 0128 schema executable by later append-only migration tooling without exporting original deployment timestamps. Any late failure rolls the entire target back to checked-empty, verifies that cleanup, removes importer-owned temporary output, and only then emits `CLEANUP_OK`; cleanup failure fails the command.

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
  --fixture-mode populated \
  --compose-file ops/self-hosted/compose.yaml \
  --env-file /absolute/path/to/ops/self-hosted/.env \
  --output-dir /absolute/path/to/wiseeff-wayfinder-671-export-YYYYMMDDTHHMMSSZ
```

Use `--fixture-mode zero` only with a source whose profiled parameter-catalog relations are empty. Baseline platform organizations created by historical migrations are allowed; the importer still requires every catalog relation and `fixture_cases` to remain empty.

The exporter records the database's exact applied migration inventory; it does not require the latest repository migration. It refuses to continue unless the required catalog relations exist and PostgreSQL proves the diagnostic transaction is read-only.

## Import into isolated PostgreSQL

Create a new database with the dedicated name prefix. The importer never creates, drops, truncates, or merges a database. It checks for relations, schemas, functions, types, operators, text-search objects, non-default extensions/languages, large objects, event triggers, publications, and foreign servers before restoring anything.

```bash
docker exec -i <local-postgres-container> \
  createdb -U wiseeff wiseeff_wayfinder671_restore_<suffix>

scripts/wayfinder/import-parameter-catalog-rehearsal.sh \
  --container <local-postgres-container> \
  --database wiseeff_wayfinder671_restore_<suffix> \
  --archive /absolute/path/to/wiseeff-wayfinder-671-export-YYYYMMDDTHHMMSSZ.tar.gz \
  --expected-archive-sha256 '<archive_sha256 copied from the authenticated exporter result>'
```

Expected terminal markers include:

```text
IMPORT_OK
target_database=wiseeff_wayfinder671_restore_<suffix>
loaded_fixture_cases=10
fixture_mode=populated
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

Before opening a database session, the runner reads each caller input once through a non-symlink file descriptor, writes the exact bytes into a private read-only snapshot, and uses only that snapshot for validation, secret scanning, and execution. It never re-reads or newline-rewrites the caller path. The PostgreSQL-aware lexer accepts only the fixture's transactional DDL/DML subset. It rejects every procedural statement or callable expression outside the explicit pure-function list, `FUNCTION`, `PROCEDURE`, `DO`, `CALL`, extensions, FDWs, foreign servers/user mappings, dblink, large-object and server-file functions, every SQL `COPY` form, transaction/session control, and every psql meta-command before opening PostgreSQL. Unknown capabilities fail closed rather than being inferred safe from keyword fragments.

The exporter and importer likewise snapshot their closed input worlds once. The caller must transport the authenticated exporter digest out of band; recomputing a digest from caller-modified archive bytes does not establish trust. PostgreSQL credential forms (including FDW user-mapping options, libpq keyword strings, credential URIs, `PGPASSWORD`, tokens, and private keys) are rejected before publication or import. Import structural/profile verification runs before commit; any later log, metrics, or cleanup failure compensates the dedicated database back to checked-empty. Temporary and publication cleanup requires the creating run's random owner marker and fd-relative directory/file identity; a replaced path is preserved and fails the run.

The runner checksum-matches the snapshotted locked verifier to the imported manifest, secret-scans both SQL snapshots and every generated dump/log, and executes `synthetic-fixture-verify.sql` exactly three times: before candidate mutation; after candidate plus validation and immediately before rollback; and after rollback. It hashes canonical full database dumps before and after and succeeds only if both hashes are identical. All runner-owned temporary files and child processes must be gone before the one success marker `CLEANUP_OK` is emitted. Expected output includes:

```text
FIXTURE_VERIFY_BEFORE_OK
FIXTURE_VERIFY_AFTER_CANDIDATE_OK
FIXTURE_VERIFY_AFTER_ROLLBACK_OK
REHEARSAL_ROLLBACK_OK
target_database=wiseeff_wayfinder671_restore_<suffix>
before_sha256=<64 lowercase hex characters>
after_sha256=<the same value>
fixture_cases=10
fixture_mode=populated
CLEANUP_OK
```

In zero mode the corresponding output is `fixture_mode=zero` and `fixture_cases=0`. This proves that a transaction-safe candidate can execute either the populated or fresh zero-inventory path without leaving durable changes. It does not prove that an as-yet undesigned replacement migration has correct destination semantics.

Candidate validation for `legacy-twin-r6-r8` must preserve both legacy IDs and their source attribution graphs. R6 may become only `Observation`, `ReviewEvidence`, or `Archive`; R8 may become only `Proposal`, `Observation`, or `Archive`. Property-key equality must never merge them, reattribute either row, infer a formal subject, activate either legacy row, or materialize one or more current Definitions. A future authoritative Platform definition can only come from the separately governed Catalog Release synchronizer, not from this twin.

## Automated PostgreSQL gate

The integration test requires a reachable real PostgreSQL instance and its Docker container:

```bash
npm run test:scripts -- scripts/wayfinder/parameter-catalog-rehearsal.integration.test.ts
```

It proves the source/artifact closed worlds, lexer/session/psql denial matrix, full generated-artifact secret scanning, ownership-safe cleanup behavior, atomic populated and zero export/import, all populated fixture cohorts, executable zero-inventory predicates, strict manifest rejection, true empty-database rejection, candidate validation, same-key R6/R8 separation, rejection of a property-key merge candidate, three mode-aware verifications, and canonical-dump rollback equality.

When finished, drop only the explicitly named disposable database:

```bash
docker exec -i <local-postgres-container> \
  dropdb -U wiseeff wiseeff_wayfinder671_restore_<suffix>
```

## Evidence boundary

The retained source profile remains aggregate evidence from the populated self-hosted database. The `wf671-` graph is representative synthetic data derived from those observed cohorts, not a redacted row-for-row production clone. Static/source-lock results are D/L evidence. A complete-clone source-lock pass includes R-object tree and ancestry evidence; a depth-one pass, when R is absent, is limited to the checked-out HEAD/working-tree manifest and does not assert unavailable-object evidence. A selected, non-skipped run against a real local PostgreSQL server is PG evidence only. Neither local synthetic nor local PG results imply Hosted, target-host, release, production approval, or compatibility-window evidence.
