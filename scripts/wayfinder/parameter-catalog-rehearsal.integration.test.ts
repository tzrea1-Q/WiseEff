import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";
import { describe, expect, it } from "vitest";

import { createDatabase } from "../../server/shared/database/client";
import { applyMigrations } from "../../server/shared/database/migrations";
import { isTestDatabaseAvailable } from "../../server/testing/testDatabase";
import {
  adminConnectionString,
  migrationsDir,
  withAdminClient,
  withTempDatabase,
} from "../../server/testing/tempDatabase";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const exporter = path.join(
  projectRoot,
  "scripts/wayfinder/export-parameter-catalog-rehearsal.sh",
);
const importer = path.join(
  projectRoot,
  "scripts/wayfinder/import-parameter-catalog-rehearsal.sh",
);
const rehearser = path.join(
  projectRoot,
  "scripts/wayfinder/rehearse-parameter-catalog-replacement.sh",
);
const containerName =
  process.env.WAYFINDER_POSTGRES_CONTAINER?.trim() || "wiseeff-postgres-1";
const databaseAvailable = await isTestDatabaseAvailable();
const containerAvailable =
  spawnSync("docker", ["inspect", containerName], { stdio: "ignore" }).status === 0;

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(
      [
        `${command} ${args.join(" ")} failed with ${result.status}`,
        result.stdout,
        result.stderr,
      ].join("\n"),
    );
  }
  return result;
}

function runResult(command: string, args: string[]) {
  return spawnSync(command, args, {
    cwd: projectRoot,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
}

function databaseName(connectionString: string) {
  return new URL(connectionString).pathname.slice(1);
}

describe.skipIf(!(databaseAvailable && containerAvailable))(
  "parameter catalog rehearsal artifact",
  () => {
    it(
      "imports a deterministic populated graph that replays the observed migration cohorts",
      async () => {
        const tempRoot = await mkdtemp(
          path.join(os.tmpdir(), "wiseeff-wayfinder671-populated-"),
        );
        const artifactDir = path.join(tempRoot, "artifact");
        const restoreDatabase = `wiseeff_wayfinder671_restore_populated_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;

        try {
          await withTempDatabase(
            { prefix: "wayfinder671_source", migrate: false },
            async ({ db, connectionString }) => {
              await applyMigrations(db, migrationsDir, {
                through: "0128_repair_driver_placement_subject_cutover.sql",
              });
              run("bash", [
                exporter,
                "--container",
                containerName,
                "--database",
                databaseName(connectionString),
                "--output-dir",
                artifactDir,
              ]);
            },
          );

          expect(
            await readFile(path.join(artifactDir, "synthetic-fixture.sql"), "utf8"),
          ).toContain("wf671-platform-driver-definition");
          expect(
            await readFile(
              path.join(artifactDir, "synthetic-fixture-verify.sql"),
              "utf8",
            ),
          ).toContain("wayfinder_rehearsal.fixture_cases");

          await withAdminClient(async (admin) => {
            await admin.query(`create database ${restoreDatabase}`);
          });
          run("bash", [
            importer,
            "--container",
            containerName,
            "--database",
            restoreDatabase,
            "--artifact-dir",
            artifactDir,
          ]);

          const client = new pg.Client({
            connectionString: adminConnectionString(restoreDatabase),
          });
          await client.connect();
          try {
            const cases = await client.query<{ case_name: string }>(
              `select case_name
               from wayfinder_rehearsal.fixture_cases
               order by case_name`,
            );
            expect(cases.rows.map((row) => row.case_name)).toEqual([
              "binding-module-identity-mismatch",
              "driver-schema-root",
              "formal-platform-driver-definition",
              "formal-platform-node-type-definition",
              "inactive-definition-binding",
              "legacy-twin-r6-r8",
              "organization-manual-node-type-draft",
              "organization-registration-placement",
              "pinned-binding-revision",
              "platform-subjectless-dts-draft",
            ]);

            const graph = await client.query<{
              formal_definitions: string;
              formal_driver_definitions: string;
              formal_node_definitions: string;
              subjectless_drafts: string;
              organization_drafts: string;
              driver_schema_roots: string;
              registrations: string;
              placements: string;
              modules: string;
              module_mappings: string;
              bindings: string;
              revisions: string;
              module_mismatches: string;
              inactive_definition_bindings: string;
            }>(`
              select
                (select count(*)::text
                 from parameter_specs ps
                 join dts_property_specs dps on dps.parameter_spec_id = ps.id
                 where ps.source_kind = 'dts'
                   and ps.definition_lifecycle = 'active'
                   and ps.attribution_subject_id is not null
                   and dps.driver_schema_id is not null) as formal_definitions,
                (select count(*)::text
                 from parameter_specs ps
                 join attribution_subjects subject
                   on subject.id = ps.attribution_subject_id
                 join driver_registrations registration
                   on registration.attribution_subject_id = subject.id
                 join dts_property_specs dps on dps.parameter_spec_id = ps.id
                 where ps.organization_id is null
                   and ps.definition_lifecycle = 'active'
                   and subject.subject_kind = 'driver-registration'
                   and dps.driver_schema_id is not null)
                  as formal_driver_definitions,
                (select count(*)::text
                 from parameter_specs ps
                 join attribution_subjects subject
                   on subject.id = ps.attribution_subject_id
                 join node_type_definitions node_type
                   on node_type.attribution_subject_id = subject.id
                 join dts_property_specs dps on dps.parameter_spec_id = ps.id
                 where ps.organization_id is null
                   and ps.definition_lifecycle = 'active'
                   and subject.subject_kind = 'node-type-definition'
                   and dps.driver_schema_id is not null)
                  as formal_node_definitions,
                (select count(*)::text
                 from parameter_specs ps
                 join dts_property_specs dps on dps.parameter_spec_id = ps.id
                 where ps.source_kind = 'dts'
                   and ps.definition_lifecycle = 'draft'
                   and ps.organization_id is null
                   and ps.attribution_subject_id is null
                   and dps.driver_schema_id is null) as subjectless_drafts,
                (select count(*)::text
                 from parameter_specs ps
                 join attribution_subjects subject
                   on subject.id = ps.attribution_subject_id
                 join node_type_definitions node_type
                   on node_type.attribution_subject_id = subject.id
                 join dts_property_specs dps on dps.parameter_spec_id = ps.id
                 where ps.source_kind = 'manual'
                   and ps.definition_lifecycle = 'draft'
                   and ps.organization_id is not null
                   and subject.organization_id = ps.organization_id
                   and dps.driver_schema_id is null) as organization_drafts,
                (select count(*)::text
                 from driver_schemas ds
                 join parameter_specs ps on ps.id = ds.parameter_spec_id
                 where ps.property_key is null) as driver_schema_roots,
                (select count(*)::text from driver_registrations) as registrations,
                (select count(*)::text from driver_registration_placements) as placements,
                (select count(*)::text from parameter_modules) as modules,
                (select count(*)::text from parameter_module_mappings)
                  as module_mappings,
                (select count(*)::text from project_parameter_bindings) as bindings,
                (select count(*)::text from project_parameter_binding_revisions) as revisions,
                (select count(*)::text
                 from project_parameter_bindings ppb
                 join parameter_specs ps on ps.id = ppb.parameter_spec_id
                 join parameter_modules pm on pm.id = ppb.module_id
                 where pm.attribution_subject_id is distinct from ps.attribution_subject_id)
                  as module_mismatches,
                (select count(*)::text
                 from project_parameter_bindings ppb
                 join parameter_specs ps on ps.id = ppb.parameter_spec_id
                 where ps.definition_lifecycle <> 'active')
                  as inactive_definition_bindings
            `);
            expect(graph.rows[0]).toEqual({
              formal_definitions: "2",
              formal_driver_definitions: "1",
              formal_node_definitions: "1",
              subjectless_drafts: "1",
              organization_drafts: "1",
              driver_schema_roots: "2",
              registrations: "1",
              placements: "1",
              modules: "3",
              module_mappings: "2",
              bindings: "3",
              revisions: "3",
              module_mismatches: "1",
              inactive_definition_bindings: "1",
            });

            const migrationLedger = await client.query<{
              applied_migrations: string;
              required_0128_rows: string;
            }>(`
              select
                count(*)::text as applied_migrations,
                count(*) filter (
                  where name = '0128_repair_driver_placement_subject_cutover.sql'
                )::text as required_0128_rows
              from schema_migrations
            `);
            expect(migrationLedger.rows[0]).toEqual({
              applied_migrations: "126",
              required_0128_rows: "1",
            });
            const restoredDb = createDatabase({
              query: async (text, values = []) => {
                const result = await client.query(text, values);
                return { rows: result.rows, rowCount: result.rowCount };
              },
            });
            await expect(
              applyMigrations(restoredDb, migrationsDir, {
                through: "0128_repair_driver_placement_subject_cutover.sql",
              }),
            ).resolves.toEqual([]);

          } finally {
            await client.end();
          }

        } finally {
          await withAdminClient(async (admin) => {
            await admin
              .query(`drop database if exists ${restoreDatabase} with (force)`)
              .catch(() => undefined);
          });
          await rm(tempRoot, { recursive: true, force: true });
        }
      },
      60_000,
    );

    it(
      "rejects an artifact directory containing a file outside the closed manifest",
      async () => {
        const tempRoot = await mkdtemp(
          path.join(os.tmpdir(), "wiseeff-wayfinder671-unknown-file-"),
        );
        const artifactDir = path.join(tempRoot, "artifact");
        try {
          await withTempDatabase(
            { prefix: "wayfinder671_unknown", migrate: false },
            async ({ db, connectionString }) => {
              await applyMigrations(db, migrationsDir, {
                through: "0128_repair_driver_placement_subject_cutover.sql",
              });
              run("bash", [
                exporter,
                "--container",
                containerName,
                "--database",
                databaseName(connectionString),
                "--output-dir",
                artifactDir,
              ]);
            },
          );
          await writeFile(path.join(artifactDir, "unexpected.txt"), "not allowed\n");

          const result = runResult("bash", [
            importer,
            "--container",
            containerName,
            "--database",
            "wiseeff_wayfinder671_restore_unknown_file",
            "--artifact-dir",
            artifactDir,
          ]);
          expect(result.status).not.toBe(0);
          expect(result.stderr).toContain("Unknown artifact entry: unexpected.txt");
        } finally {
          await rm(tempRoot, { recursive: true, force: true });
        }
      },
      60_000,
    );

    it(
      "requires one safe checksum entry for every required artifact file",
      async () => {
        const tempRoot = await mkdtemp(
          path.join(os.tmpdir(), "wiseeff-wayfinder671-checksums-"),
        );
        const artifactDir = path.join(tempRoot, "artifact");
        const invoke = (directory: string) =>
          runResult("bash", [
            importer,
            "--container",
            containerName,
            "--database",
            "wiseeff_wayfinder671_restore_checksum_validation",
            "--artifact-dir",
            directory,
          ]);

        try {
          await withTempDatabase(
            { prefix: "wayfinder671_checksums", migrate: false },
            async ({ db, connectionString }) => {
              await applyMigrations(db, migrationsDir, {
                through: "0128_repair_driver_placement_subject_cutover.sql",
              });
              run("bash", [
                exporter,
                "--container",
                containerName,
                "--database",
                databaseName(connectionString),
                "--output-dir",
                artifactDir,
              ]);
            },
          );

          const checksumText = await readFile(
            path.join(artifactDir, "SHA256SUMS"),
            "utf8",
          );
          const checksumLines = checksumText.trimEnd().split("\n");

          const missingFileDir = path.join(tempRoot, "missing-file");
          await cp(artifactDir, missingFileDir, { recursive: true });
          await rm(path.join(missingFileDir, "manifest.csv"));
          expect(invoke(missingFileDir).stderr).toContain(
            "Required artifact file is missing: manifest.csv",
          );

          const missingChecksumDir = path.join(tempRoot, "missing-checksum");
          await cp(artifactDir, missingChecksumDir, { recursive: true });
          await writeFile(
            path.join(missingChecksumDir, "SHA256SUMS"),
            `${checksumLines.filter((line) => !line.endsWith("  schema.sql")).join("\n")}\n`,
          );
          expect(invoke(missingChecksumDir).stderr).toContain(
            "Checksum entry is missing: schema.sql",
          );

          const duplicateDir = path.join(tempRoot, "duplicate-checksum");
          await cp(artifactDir, duplicateDir, { recursive: true });
          await writeFile(
            path.join(duplicateDir, "SHA256SUMS"),
            `${checksumText}${checksumLines[0]}\n`,
          );
          expect(invoke(duplicateDir).stderr).toContain(
            `Duplicate checksum entry: ${checksumLines[0]?.split("  ")[1]}`,
          );

          const traversalDir = path.join(tempRoot, "traversal-checksum");
          await cp(artifactDir, traversalDir, { recursive: true });
          await writeFile(
            path.join(traversalDir, "SHA256SUMS"),
            `${checksumText}${"0".repeat(64)}  ../escape.sql\n`,
          );
          expect(invoke(traversalDir).stderr).toContain(
            "Unsafe or malformed SHA256SUMS entry",
          );
        } finally {
          await rm(tempRoot, { recursive: true, force: true });
        }
      },
      60_000,
    );

    it(
      "rejects a target with user-defined objects even when it has no tables",
      async () => {
        const tempRoot = await mkdtemp(
          path.join(os.tmpdir(), "wiseeff-wayfinder671-nonempty-target-"),
        );
        const artifactDir = path.join(tempRoot, "artifact");
        const restoreDatabase = `wiseeff_wayfinder671_restore_nonempty_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;

        try {
          await withTempDatabase(
            { prefix: "wayfinder671_nonempty", migrate: false },
            async ({ db, connectionString }) => {
              await applyMigrations(db, migrationsDir, {
                through: "0128_repair_driver_placement_subject_cutover.sql",
              });
              run("bash", [
                exporter,
                "--container",
                containerName,
                "--database",
                databaseName(connectionString),
                "--output-dir",
                artifactDir,
              ]);
            },
          );

          await withAdminClient(async (admin) => {
            await admin.query(`create database ${restoreDatabase}`);
          });
          const client = new pg.Client({
            connectionString: adminConnectionString(restoreDatabase),
          });
          await client.connect();
          try {
            await client.query("create schema wf671_preexisting");
            await client.query(`
              create function public.wf671_preexisting_function()
              returns integer
              language sql
              immutable
              as 'select 1'
            `);
          } finally {
            await client.end();
          }

          const result = runResult("bash", [
            importer,
            "--container",
            containerName,
            "--database",
            restoreDatabase,
            "--artifact-dir",
            artifactDir,
          ]);
          expect(result.status).not.toBe(0);
          expect(result.stderr).toContain(
            "Target database contains user-defined objects; refusing to overwrite or merge.",
          );
        } finally {
          await withAdminClient(async (admin) => {
            await admin
              .query(`drop database if exists ${restoreDatabase} with (force)`)
              .catch(() => undefined);
          });
          await rm(tempRoot, { recursive: true, force: true });
        }
      },
      60_000,
    );

    it(
      "runs candidate SQL plus validation and proves a full database rollback",
      async () => {
        const tempRoot = await mkdtemp(
          path.join(os.tmpdir(), "wiseeff-wayfinder671-rollback-"),
        );
        const artifactDir = path.join(tempRoot, "artifact");
        const candidateFile = path.join(tempRoot, "candidate.sql");
        const validationFile = path.join(tempRoot, "validation.sql");
        const restoreDatabase = `wiseeff_wayfinder671_restore_rollback_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;

        try {
          await withTempDatabase(
            { prefix: "wayfinder671_rollback", migrate: false },
            async ({ db, connectionString }) => {
              await applyMigrations(db, migrationsDir, {
                through: "0128_repair_driver_placement_subject_cutover.sql",
              });
              run("bash", [
                exporter,
                "--container",
                containerName,
                "--database",
                databaseName(connectionString),
                "--output-dir",
                artifactDir,
              ]);
            },
          );
          await withAdminClient(async (admin) => {
            await admin.query(`create database ${restoreDatabase}`);
          });
          run("bash", [
            importer,
            "--container",
            containerName,
            "--database",
            restoreDatabase,
            "--artifact-dir",
            artifactDir,
          ]);

          await writeFile(
            candidateFile,
            `
              create schema wf671_candidate_replacement;
              create table wf671_candidate_replacement.definition_map as
              select id, attribution_subject_id, property_key, definition_lifecycle
              from parameter_specs;
              update project_parameter_bindings
              set module_id = 'wf671-business-module'
              where id = 'wf671-mismatch-binding';
            `,
          );
          await writeFile(
            validationFile,
            `
              do $$
              declare mapped bigint;
              begin
                select count(*) into mapped
                from wf671_candidate_replacement.definition_map;
                if mapped <> 6 then
                  raise exception 'expected six mapped definitions, got %', mapped;
                end if;
              end
              $$;
            `,
          );

          const result = run("bash", [
            rehearser,
            "--container",
            containerName,
            "--database",
            restoreDatabase,
            "--migration-file",
            candidateFile,
            "--validation-file",
            validationFile,
          ]);
          expect(result.stdout).toContain("REHEARSAL_ROLLBACK_OK");
          expect(result.stdout).toMatch(/before_sha256=[0-9a-f]{64}/);
          expect(result.stdout).toMatch(/after_sha256=[0-9a-f]{64}/);

          const client = new pg.Client({
            connectionString: adminConnectionString(restoreDatabase),
          });
          await client.connect();
          try {
            const rollbackState = await client.query<{
              candidate_schema: string | null;
              mismatch_module: string;
            }>(`
              select
                to_regnamespace('wf671_candidate_replacement')::text
                  as candidate_schema,
                (select module_id
                 from project_parameter_bindings
                 where id = 'wf671-mismatch-binding') as mismatch_module
            `);
            expect(rollbackState.rows[0]).toEqual({
              candidate_schema: null,
              mismatch_module: "wf671-org-node-module",
            });
          } finally {
            await client.end();
          }

          await writeFile(candidateFile, "select 1; commit;\n");
          const unsafeResult = runResult("bash", [
            rehearser,
            "--container",
            containerName,
            "--database",
            restoreDatabase,
            "--migration-file",
            candidateFile,
            "--validation-file",
            validationFile,
          ]);
          expect(unsafeResult.status).not.toBe(0);
          expect(unsafeResult.stderr).toContain(
            "SQL input contains transaction control and cannot be rollback-contained",
          );
        } finally {
          await withAdminClient(async (admin) => {
            await admin
              .query(`drop database if exists ${restoreDatabase} with (force)`)
              .catch(() => undefined);
          });
          await rm(tempRoot, { recursive: true, force: true });
        }
      },
      60_000,
    );

    it(
      "keeps the same-key R6 staging row and R8 proposal distinct during migration rehearsal",
      async () => {
        const tempRoot = await mkdtemp(
          path.join(os.tmpdir(), "wiseeff-wayfinder671-legacy-twin-"),
        );
        const artifactDir = path.join(tempRoot, "artifact");
        const candidateFile = path.join(tempRoot, "candidate.sql");
        const validationFile = path.join(tempRoot, "validation.sql");
        const restoreDatabase = `wiseeff_wayfinder671_restore_legacy_twin_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;

        try {
          await withTempDatabase(
            { prefix: "wayfinder671_legacy_twin", migrate: false },
            async ({ db, connectionString }) => {
              await applyMigrations(db, migrationsDir, {
                through: "0128_repair_driver_placement_subject_cutover.sql",
              });
              run("bash", [
                exporter,
                "--container",
                containerName,
                "--database",
                databaseName(connectionString),
                "--output-dir",
                artifactDir,
              ]);
            },
          );
          await withAdminClient(async (admin) => {
            await admin.query(`create database ${restoreDatabase}`);
          });
          run("bash", [
            importer,
            "--container",
            containerName,
            "--database",
            restoreDatabase,
            "--artifact-dir",
            artifactDir,
          ]);

          const client = new pg.Client({
            connectionString: adminConnectionString(restoreDatabase),
          });
          await client.connect();
          try {
            const fixtureCase = await client.query<{
              expected_rows: string;
            }>(`
              select expected_rows::text
              from wayfinder_rehearsal.fixture_cases
              where case_name = 'legacy-twin-r6-r8'
            `);
            expect(fixtureCase.rows).toEqual([{ expected_rows: "2" }]);

            const twin = await client.query<{
              id: string;
              source_kind: string;
              organization_id: string | null;
              attribution_subject_id: string | null;
              driver_schema_id: string | null;
              binding_count: string;
              property_key: string;
            }>(`
              select
                ps.id,
                ps.source_kind,
                ps.organization_id,
                ps.attribution_subject_id,
                dps.driver_schema_id,
                count(binding.id)::text as binding_count,
                ps.property_key
              from parameter_specs ps
              join dts_property_specs dps on dps.parameter_spec_id = ps.id
              left join project_parameter_bindings binding
                on binding.parameter_spec_id = ps.id
              where ps.property_key = 'synthetic.legacy-twin'
              group by ps.id, dps.driver_schema_id
              order by ps.id
            `);
            expect(twin.rows).toEqual([
              {
                id: "wf671-org-manual-node-draft",
                source_kind: "manual",
                organization_id: "wf671-org",
                attribution_subject_id: "wf671-org-node-subject",
                driver_schema_id: null,
                binding_count: "1",
                property_key: "synthetic.legacy-twin",
              },
              {
                id: "wf671-platform-subjectless-draft",
                source_kind: "dts",
                organization_id: null,
                attribution_subject_id: null,
                driver_schema_id: null,
                binding_count: "0",
                property_key: "synthetic.legacy-twin",
              },
            ]);
          } finally {
            await client.end();
          }

          await writeFile(
            validationFile,
            `
              do $$
              declare
                source_rows bigint;
                r6_rows bigint;
                r8_rows bigint;
                mapped_rows bigint;
              begin
                select count(*) into source_rows
                from parameter_specs
                where property_key = 'synthetic.legacy-twin';
                if source_rows <> 2 then
                  raise exception 'legacy twin source must contain exactly two rows, got %', source_rows;
                end if;

                select count(*) into r6_rows
                from parameter_specs ps
                join dts_property_specs dps on dps.parameter_spec_id = ps.id
                where ps.id = 'wf671-platform-subjectless-draft'
                  and ps.property_key = 'synthetic.legacy-twin'
                  and ps.source_kind = 'dts'
                  and ps.organization_id is null
                  and ps.attribution_subject_id is null
                  and ps.definition_lifecycle = 'draft'
                  and dps.property_key = ps.property_key
                  and dps.driver_schema_id is null
                  and not exists (
                    select 1 from project_parameter_bindings binding
                    where binding.parameter_spec_id = ps.id
                  );
                if r6_rows <> 1 then
                  raise exception 'legacy twin requires one R6 staging row, got %', r6_rows;
                end if;

                select count(*) into r8_rows
                from parameter_specs ps
                join dts_property_specs dps on dps.parameter_spec_id = ps.id
                join attribution_subjects subject on subject.id = ps.attribution_subject_id
                join node_type_definitions node_type
                  on node_type.attribution_subject_id = subject.id
                where ps.id = 'wf671-org-manual-node-draft'
                  and ps.property_key = 'synthetic.legacy-twin'
                  and ps.source_kind = 'manual'
                  and ps.organization_id = 'wf671-org'
                  and ps.definition_lifecycle = 'draft'
                  and subject.organization_id = ps.organization_id
                  and subject.subject_kind = 'node-type-definition'
                  and dps.property_key = ps.property_key
                  and dps.driver_schema_id is null
                  and exists (
                    select 1 from project_parameter_bindings binding
                    where binding.parameter_spec_id = ps.id
                      and binding.module_id = 'wf671-org-node-module'
                  );
                if r8_rows <> 1 then
                  raise exception 'legacy twin requires one R8 proposal row, got %', r8_rows;
                end if;

                select count(*) into mapped_rows
                from wf671_candidate_replacement.legacy_twin_dispositions;
                if mapped_rows <> 2 then
                  raise exception 'R6/R8 twin migration must preserve two source identities, got %', mapped_rows;
                end if;

                if (
                  select count(distinct legacy_id)
                  from wf671_candidate_replacement.legacy_twin_dispositions
                ) <> 2 or exists (
                  select legacy_id
                  from wf671_candidate_replacement.legacy_twin_dispositions
                  group by legacy_id
                  having count(*) <> 1
                ) then
                  raise exception 'R6/R8 twin migration duplicated or omitted a source identity';
                end if;

                if exists (
                  select 1
                  from wf671_candidate_replacement.legacy_twin_dispositions
                  where (legacy_id = 'wf671-platform-subjectless-draft'
                         and legacy_class <> 'R6')
                     or (legacy_id = 'wf671-org-manual-node-draft'
                         and legacy_class <> 'R8')
                     or legacy_id not in (
                          'wf671-platform-subjectless-draft',
                          'wf671-org-manual-node-draft'
                        )
                ) then
                  raise exception 'R6/R8 twin migration changed a source classification';
                end if;

                if exists (
                  select 1
                  from wf671_candidate_replacement.legacy_twin_dispositions candidate
                  join parameter_specs source on source.id = candidate.legacy_id
                  where candidate.property_key <> 'synthetic.legacy-twin'
                     or candidate.source_attribution_subject_id
                        is distinct from source.attribution_subject_id
                ) then
                  raise exception 'R6/R8 twin migration changed a source identity';
                end if;

                if exists (
                  select 1
                  from wf671_candidate_replacement.legacy_twin_dispositions
                  where target_formal_subject_id is not null
                ) then
                  raise exception 'property key must not infer a formal subject for the R6/R8 twin';
                end if;

                if exists (
                  select 1
                  from wf671_candidate_replacement.legacy_twin_dispositions
                  where (legacy_class = 'R6' and destination_kind not in (
                           'Observation', 'ReviewEvidence', 'Archive'
                         ))
                     or (legacy_class = 'R8' and destination_kind not in (
                           'Proposal', 'Observation', 'Archive'
                         ))
                     or legacy_class not in ('R6', 'R8')
                ) then
                  raise exception 'R6/R8 twin migration selected a forbidden disposition';
                end if;

                if exists (
                  select 1
                  from wf671_candidate_replacement.legacy_twin_dispositions
                  where destination_kind = 'Definition'
                     or is_current_definition
                ) then
                  raise exception 'R6/R8 twin migration must not create or activate a current Definition';
                end if;

                if exists (
                  select destination_identity
                  from wf671_candidate_replacement.legacy_twin_dispositions
                  group by destination_identity
                  having count(*) > 1
                ) then
                  raise exception 'R6/R8 twin migration must not merge destination identities';
                end if;
              end
              $$;
            `,
          );

          await writeFile(
            candidateFile,
            `
              create schema wf671_candidate_replacement;
              create table wf671_candidate_replacement.legacy_twin_dispositions as
              select
                min(id) as legacy_id,
                'merged-by-property-key'::text as legacy_class,
                property_key,
                'Definition'::text as destination_kind,
                property_key as destination_identity,
                min(attribution_subject_id) as source_attribution_subject_id,
                max(attribution_subject_id) as target_formal_subject_id,
                true as is_current_definition
              from parameter_specs
              where property_key = 'synthetic.legacy-twin'
              group by property_key;
            `,
          );
          const mergedResult = runResult("bash", [
            rehearser,
            "--container",
            containerName,
            "--database",
            restoreDatabase,
            "--migration-file",
            candidateFile,
            "--validation-file",
            validationFile,
          ]);
          expect(mergedResult.status).not.toBe(0);
          expect(mergedResult.stderr).toContain(
            "R6/R8 twin migration must preserve two source identities",
          );

          await writeFile(
            candidateFile,
            `
              create schema wf671_candidate_replacement;
              create table wf671_candidate_replacement.legacy_twin_dispositions as
              select
                id as legacy_id,
                case id
                  when 'wf671-platform-subjectless-draft' then 'R6'
                  when 'wf671-org-manual-node-draft' then 'R8'
                end as legacy_class,
                property_key,
                case id
                  when 'wf671-platform-subjectless-draft' then 'Observation'
                  when 'wf671-org-manual-node-draft' then 'Proposal'
                end as destination_kind,
                case id
                  when 'wf671-platform-subjectless-draft' then 'wf671-observation-r6'
                  when 'wf671-org-manual-node-draft' then 'wf671-proposal-r8'
                end as destination_identity,
                attribution_subject_id as source_attribution_subject_id,
                null::text as target_formal_subject_id,
                false as is_current_definition
              from parameter_specs
              where property_key = 'synthetic.legacy-twin';
            `,
          );
          const acceptedResult = run("bash", [
            rehearser,
            "--container",
            containerName,
            "--database",
            restoreDatabase,
            "--migration-file",
            candidateFile,
            "--validation-file",
            validationFile,
          ]);
          expect(acceptedResult.stdout).toContain("REHEARSAL_ROLLBACK_OK");
        } finally {
          await withAdminClient(async (admin) => {
            await admin
              .query(`drop database if exists ${restoreDatabase} with (force)`)
              .catch(() => undefined);
          });
          await rm(tempRoot, { recursive: true, force: true });
        }
      },
      60_000,
    );
  },
);
