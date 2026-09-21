import { describe, expect, it, vi } from "vitest";
import { mkdtemp, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalObjectStore } from "../../logs/objectStore";
import { makeTestAuthContext } from "../../../testing/authContext";
import { exportCanonicalBindingSource, verifyCanonicalSourceReimport } from "../catalogProjectValueSync";
import pg from "pg";
import { createHash } from "node:crypto";

import { compileCatalogRelease } from "../../catalog-kernel/compiler/index";
import { validCatalogReleaseBundle } from "../../catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import { jsonCatalogReleaseSource } from "../../catalog-kernel/interface";
import { installPublishedRelease } from "../../catalog-kernel/install/installer";
import { createDatabase, type Database } from "../../../shared/database/client";
import { applyMigrations } from "../../../shared/database/migrations";
import {
  CatalogReleaseId,
  serializeContract,
  type ContractJsonValue,
} from "../../parameter-catalog-contract/index";
import { createEvidenceIngest, fingerprintCanonical } from "../../parameter-governance/evidence";
import { isTestDatabaseAvailable } from "../../../testing/testDatabase";
import {
  migrationsDir,
  withTempDatabase as withSharedTempDatabase
} from "../../../testing/tempDatabase";

const databaseAvailable = await isTestDatabaseAvailable();

async function withTempDatabase(fn: (db: Database, connectionString: string) => Promise<void>) {
  await withSharedTempDatabase({ prefix: "src_occ_0151", migrate: false }, ({ db, connectionString }) =>
    fn(db, connectionString)
  );
}

async function seedPopulatedGraph(
  db: Database,
  connectionString: string,
  sourceRef = "source.dts!/fixture"
) {
  const pool = new pg.Pool({ connectionString, max: 2 });
  try {
    const full = validCatalogReleaseBundle();
    const first = structuredClone(full.releases[0]!);
    const bundle = {
      schemaVersion: full.schemaVersion,
      targetReleaseId: first.manifest.release.id,
      releases: [first]
    };
    const compiled = compileCatalogRelease(bundle);
    if (!compiled.ok) throw new Error(`fixture release did not compile: ${compiled.error.kind}`);
    const installed = await installPublishedRelease(pool, {
      mode: "bootstrap",
      source: jsonCatalogReleaseSource(bundle),
      expectedTargetDigest: compiled.value.aggregateDigest
    });
    if (!installed.ok) throw new Error(`fixture release did not install: ${JSON.stringify(installed)}`);

    const organizationId = "org-src-occ-0151";
    const projectId = "project-src-occ-0151";
    const userId = "user-src-occ-0151";
    const configSetId = "config-set-src-occ-0151";
    const configRevisionId = "config-revision-src-occ-0151";
    const fileId = "file-src-occ-0151";
    const historicalVersionId = "file-version-src-occ-0151-historical";
    const currentVersionId = "file-version-src-occ-0151-current";
    const logicalNodeId = "logical-node-src-occ-0151";
    const logicalNodeRevisionId = "logical-node-revision-src-occ-0151";
    const nodeOccurrenceId = "node-occurrence-src-occ-0151";
    const propertyOccurrenceId = "property-occurrence-src-occ-0151";
    const bindingId = "binding-src-occ-0151";
    const valueId = "value-src-occ-0151";

    await pool.query("insert into organizations (id, name) values ($1, $2)", [
      organizationId,
      "Source occurrence fixture"
    ]);
    await pool.query(
      `insert into users (id, organization_id, name, email, title, is_active)
       values ($1, $2, 'Source occurrence fixture', 'source-occurrence@example.com', 'Admin', true)`,
      [userId, organizationId]
    );
    await pool.query(
      `insert into projects (id, organization_id, name, code, status)
       values ($1, $2, 'Source occurrence fixture', 'SRC0151', 'initialized')`,
      [projectId, organizationId]
    );
    await pool.query(
      `insert into dts_config_set (id, organization_id, project_id, name)
       values ($1, $2, $3, 'default')`,
      [configSetId, organizationId, projectId]
    );
    await pool.query(
      `insert into project_parameter_files (
         id, organization_id, project_id, file_name, format, config_set_id, config_set_role
       ) values ($1, $2, $3, 'source.dts', 'dts', $4, 'base')`,
      [fileId, organizationId, projectId, configSetId]
    );
    await pool.query(
      `insert into project_parameter_file_versions (
         id, file_id, version_number, storage_key, checksum, size_bytes, origin, created_by_user_id
       ) values ($1, $2, 1, 'source-historical', 'checksum-historical', 1, 'upload', $3),
               ($4, $2, 2, 'source-current', 'checksum-current', 1, 'writeback', $3)`,
      [historicalVersionId, fileId, userId, currentVersionId]
    );
    await pool.query(`update project_parameter_files set current_version_id = $1 where id = $2`, [
      currentVersionId,
      fileId
    ]);
    await pool.query(
      `insert into dts_config_revisions (
         id, organization_id, project_id, config_set_id, revision_number, status, created_by_user_id
       ) values ($1, $2, $3, $4, 1, 'resolved', $5)`,
      [configRevisionId, organizationId, projectId, configSetId, userId]
    );
    await pool.query(
      `insert into dts_config_revision_members (
         id, config_revision_id, file_id, file_version_id, role, sort_order
       ) values ('member-src-occ-0151', $1, $2, $3, 'base', 0)`,
      [configRevisionId, fileId, historicalVersionId]
    );
    await pool.query(
      `insert into dts_logical_nodes (id, organization_id, project_id, config_set_id)
       values ($1, $2, $3, $4)`,
      [logicalNodeId, organizationId, projectId, configSetId]
    );

    const definition = await pool.query<{
      release_id: string;
      definition_id: string;
      revision_id: string;
      subject_id: string;
      subject_kind: string;
      property_key: string;
    }>(
      `select head.release_id, head.definition_id, head.revision_id,
              definition.subject_id, subject.kind as subject_kind, definition.property_key
         from parameter_catalog.catalog_release_definition_heads head
         join parameter_catalog.parameter_definitions definition
           on definition.id = head.definition_id
         join parameter_catalog.catalog_subjects subject
           on subject.id = definition.subject_id
        where head.release_id = $1
        order by head.definition_id
        limit 1`,
      [first.manifest.release.id]
    );
    const selectedDefinition = definition.rows[0];
    if (!selectedDefinition) throw new Error("fixture release has no definition head");

    const moduleId = "module-src-occ-0151";
    const registrationId = "registration-src-occ-0151";
    const placementId = "placement-src-occ-0151";
    const attributionSubjectId = "attribution-subject-src-occ-0151";
    await pool.query(
      `insert into attribution_subjects (
         id, organization_id, subject_kind, display_name, origin, source_key
       ) values ($1, $2, $3, 'Source fixture', 'curated', $4)`,
      [
        attributionSubjectId,
        organizationId,
        selectedDefinition.subject_kind === "driver" ? "driver-registration" : "node-type-definition",
        `source-occurrence:0151:${organizationId}`
      ]
    );
    await pool.query(
      `insert into parameter_modules (
         id, organization_id, name, path, depth, kind, origin, attribution_subject_id
       ) values ($1, $2, 'Source fixture', $1, 1, $3, 'curated', $4)`,
      [
        moduleId,
        organizationId,
        selectedDefinition.subject_kind === "driver" ? "driver-group" : "node-type",
        attributionSubjectId
      ]
    );
    const registrationClient = await pool.connect();
    try {
      await registrationClient.query("begin");
      await registrationClient.query("set constraints all deferred");
      await registrationClient.query(
        `insert into parameter_catalog.organization_subject_registrations (
           id, organization_id, subject_id, status, registration_method, proof, current_placement_id
         ) values ($1, $2, $3, 'active', 'explicit', '{}'::jsonb, $4)`,
        [registrationId, organizationId, selectedDefinition.subject_id, placementId]
      );
      await registrationClient.query(
        `insert into parameter_catalog.subject_placements (
           id, registration_id, organization_id, module_id, origin
         ) values ($1, $2, $3, $4, 'curated')`,
        [placementId, registrationId, organizationId, moduleId]
      );
      await registrationClient.query("set constraints all immediate");
      await registrationClient.query("commit");
    } catch (error) {
      await registrationClient.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      registrationClient.release();
    }

    await pool.query(
      `insert into dts_logical_node_revisions (
         id, logical_node_id, config_revision_id, node_locator, name, compatible
       ) values ($1, $2, $3, '/fixture', 'fixture', 'fixture')`,
      [logicalNodeRevisionId, logicalNodeId, configRevisionId]
    );
    await pool.query(
      `insert into dts_node_occurrences (
         id, config_revision_id, file_version_id, name, node_path,
         start_offset, end_offset, start_line, start_column, end_line, end_column, raw_text
       ) values ($1, $2, $3, 'fixture', '/fixture', 0, 10, 1, 1, 1, 10, 'fixture')`,
      [nodeOccurrenceId, configRevisionId, historicalVersionId]
    );
    await pool.query(
      `insert into dts_property_occurrences (
         id, config_revision_id, node_occurrence_id, file_version_id, property_name,
         start_offset, end_offset, start_line, start_column, end_line, end_column, raw_text
       ) values ($1, $2, $3, $4, $5, 1, 2, 1, 2, 1, 3, '1')`,
      [propertyOccurrenceId, configRevisionId, nodeOccurrenceId, historicalVersionId, selectedDefinition.property_key]
    );
    await pool.query(
      `insert into dts_occurrence_effects (
         id, config_revision_id, logical_node_revision_id, property_occurrence_id,
         node_occurrence_id, property_name, effect_kind, source_order
       ) values ('effect-src-occ-0151', $1, $2, $3, $4, $5, 'set', 0)`,
      [configRevisionId, logicalNodeRevisionId, propertyOccurrenceId, nodeOccurrenceId, selectedDefinition.property_key]
    );

    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("set constraints all deferred");
      await client.query(
        `insert into parameter_catalog.project_parameter_bindings (
           id, organization_id, catalog_release_id, project_id, logical_node_id,
           registration_id, subject_id, definition_id, effective_revision_id, current_value_id
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          bindingId,
          organizationId,
          first.manifest.release.id,
          projectId,
          logicalNodeId,
          registrationId,
          selectedDefinition.subject_id,
          selectedDefinition.definition_id,
          selectedDefinition.revision_id,
          valueId
        ]
      );
      await client.query(
        `insert into parameter_catalog.project_parameter_values (
           id, binding_id, definition_id, definition_revision_id, source_ref,
           config_revision_id, value_digest, value_kind, value
         ) values ($1, $2, $3, $4, $6, $5,
                   'digest-src-occ-0151', 'number', '1'::jsonb)`,
        [valueId, bindingId, selectedDefinition.definition_id, selectedDefinition.revision_id, configRevisionId, sourceRef]
      );
      await client.query("set constraints all immediate");
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

async function seedPopulatedObservations(db: Database) {
  const ids = await db.query<{
    organization_id: string;
    project_id: string;
    logical_node_id: string;
    config_revision_id: string;
    catalog_release_id: string;
    registration_id: string;
    subject_id: string;
    definition_id: string;
    definition_revision_id: string;
    property_name: string;
  }>(
    `select binding.organization_id, binding.project_id, binding.logical_node_id,
            value.config_revision_id, binding.catalog_release_id, binding.registration_id,
            binding.subject_id, binding.definition_id, value.definition_revision_id,
            definition.property_key as property_name
       from parameter_catalog.project_parameter_bindings binding
       join parameter_catalog.project_parameter_values value
         on value.id = binding.current_value_id
       join parameter_catalog.parameter_definitions definition
         on definition.id = binding.definition_id
      where binding.id = 'binding-src-occ-0151'`
  );
  const row = ids.rows[0];
  if (!row) throw new Error("populated source fixture binding is missing");

  await db.query(
    `insert into dts_property_occurrences (
       id, config_revision_id, node_occurrence_id, file_version_id, property_name,
       start_offset, end_offset, start_line, start_column, end_line, end_column, raw_text
     ) values ('property-occurrence-src-occ-0151-secondary', $1, 'node-occurrence-src-occ-0151',
               'file-version-src-occ-0151-historical', 'fixture-secondary', 3, 4, 1, 4, 1, 5, '2')`,
    [row.config_revision_id]
  );
  await db.query(
    `insert into dts_occurrence_effects (
       id, config_revision_id, logical_node_revision_id, property_occurrence_id,
       node_occurrence_id, property_name, effect_kind, source_order
     ) values ('effect-src-occ-0151-secondary', $1, 'logical-node-revision-src-occ-0151',
               'property-occurrence-src-occ-0151-secondary', 'node-occurrence-src-occ-0151',
               'fixture-secondary', 'set', 1)`,
    [row.config_revision_id]
  );

  const observations = [
    {
      id: "observation-src-occ-0151",
      propertyOccurrenceId: "property-occurrence-src-occ-0151",
      propertyName: row.property_name,
      matchId: "match-src-occ-0151",
      reviewId: "review-evidence-src-occ-0151"
    },
    {
      id: "observation-src-occ-0151-secondary",
      propertyOccurrenceId: "property-occurrence-src-occ-0151-secondary",
      propertyName: "fixture-secondary",
      matchId: "match-src-occ-0151-secondary",
      reviewId: null
    }
  ] as const;
  for (const [index, observation] of observations.entries()) {
    const locator = {
      kind: "dts-property",
      propertyOccurrenceId: observation.propertyOccurrenceId,
      nodeOccurrenceId: "node-occurrence-src-occ-0151",
      fileVersionId: "file-version-src-occ-0151-historical",
      propertyName: observation.propertyName
    } as const;
    const evidenceFingerprint = fingerprintCanonical({
      kind: "parameter-observation",
      organizationId: row.organization_id,
      sourceIdentity: `legacy-observation-src-occ-0151-${index}`,
      catalogReleaseId: row.catalog_release_id,
      matcherRevision: "matcher-src-occ-0151",
      matcherOutput: { status: "matched" },
      projectId: row.project_id,
      logicalNodeId: row.logical_node_id,
      configRevisionId: row.config_revision_id,
      sourceLocator: locator,
    } as ContractJsonValue);
    await db.query(
      `insert into parameter_catalog.parameter_observations (
         id, organization_id, project_id, logical_node_id, config_revision_id,
         source_identity, source_locator, catalog_release_id, matcher_revision,
         evidence_fingerprint
       ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)`,
      [
        observation.id,
        row.organization_id,
        row.project_id,
        row.logical_node_id,
        row.config_revision_id,
        `legacy-observation-src-occ-0151-${index}`,
        JSON.stringify(locator),
        row.catalog_release_id,
        "matcher-src-occ-0151",
        evidenceFingerprint
      ]
    );
    await db.query(
      `insert into parameter_catalog.parameter_observation_matches (
         id, observation_id, organization_id, project_id, logical_node_id,
         registration_id, subject_id, definition_id, definition_revision_id,
         binding_id, catalog_release_id, matcher_revision
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'binding-src-occ-0151', $10, $11)`,
      [
        observation.matchId,
        observation.id,
        row.organization_id,
        row.project_id,
        row.logical_node_id,
        row.registration_id,
        row.subject_id,
        row.definition_id,
        row.definition_revision_id,
        row.catalog_release_id,
        "matcher-src-occ-0151"
      ]
    );
    if (observation.reviewId) {
      await db.query(
        `insert into parameter_catalog.parameter_review_evidence (
           id, organization_id, observation_id, reason, candidate_safe_digest,
           r_class, source_graph_ref, evidence
         ) values ($1, $2, $3, 'unknown', $4, null, 'legacy-src-occ-0151', $5::jsonb)`,
        [
          observation.reviewId,
          row.organization_id,
          observation.id,
          "legacy-review-digest-src-occ-0151",
          JSON.stringify({ kind: "linked-review", sourceIdentity: "legacy-review-src-occ-0151" })
        ]
      );
    }
  }
}

describe.skipIf(!databaseAvailable)("0151 source occurrence identity migration", () => {
  it.each(["missing-entry","malformed-overlay"])("refuses historical %s metadata through public export and reimport before object reads", async (kind) => {
    await withTempDatabase(async (db,connectionString) => {
      await applyMigrations(db,migrationsDir,{ through: "0150_product_feedback_v2.sql" });
      await seedPopulatedGraph(db,connectionString);
      await db.query(`update dts_config_revisions set manifest_state='complete',entry_file=$1,
        include_search_paths='[]',overlay_order=$2::jsonb where id='config-revision-src-occ-0151'`,
      [kind === "missing-entry" ? "absent.dts" : "source.dts",kind === "malformed-overlay" ? "[42]" : "[]"]);
      await db.query("update project_parameter_file_versions set checksum=$1",["0".repeat(64)]);
      await db.query(`insert into parameter_catalog.binding_history_events
        (id,binding_id,new_effective_revision_id,new_current_value_id,reason,success_audit_ref,catalog_release_id)
        select 'export-history',id,effective_revision_id,current_value_id,'source fixture','export-audit',catalog_release_id
        from parameter_catalog.project_parameter_bindings where id='binding-src-occ-0151'`);
      await applyMigrations(db,migrationsDir);
      const directory = await mkdtemp(join(tmpdir(),"wiseeff-export-refusal-"));
      const store = createLocalObjectStore(directory);
      const reads = vi.spyOn(store,"getBounded");
      const auth = makeTestAuthContext({ userId: "user-src-occ-0151",organizationId: "org-src-occ-0151",permissions: ["parameter:view"] });
      const input = { projectId: "project-src-occ-0151",bindingId: "binding-src-occ-0151" };
      try {
        const before = (await db.query("select * from dts_config_revisions order by id")).rows;
        await expect(exportCanonicalBindingSource(db,store,auth,input))
          .rejects.toMatchObject({ code: "CONFLICT",details: { reason: "source-proof-invalid" } });
        await expect(verifyCanonicalSourceReimport(db,store,auth,{ ...input,source: { currentValueId: "value-src-occ-0151" } }))
          .rejects.toMatchObject({ code: "CONFLICT",details: { reason: "source-proof-invalid" } });
        expect(reads).not.toHaveBeenCalled();
        expect((await db.query("select * from dts_config_revisions order by id")).rows).toEqual(before);
      } finally {
        reads.mockRestore();
        await rm(directory,{ recursive: true,force: true });
      }
    });
  },120_000);

  it("rolls back a disconnected populated upgrade, resumes after reconnect, and refuses an older migration inventory", async () => {
    await withTempDatabase(async (db, connectionString) => {
      await applyMigrations(db, migrationsDir, { through: "0150_product_feedback_v2.sql" });
      await seedPopulatedGraph(db, connectionString);
      await seedPopulatedObservations(db);
      const before = (await db.query("select * from parameter_catalog.project_parameter_bindings order by id")).rows;
      const observations = (await db.query("select * from parameter_catalog.parameter_observations order by id")).rows;
      const runner = new pg.Client({ connectionString });
      await runner.connect();
      let interrupted = false;
      const interruptedDb = createDatabase({ query: async (text, values = []) => {
        if (text.startsWith("insert into schema_migrations") && values[0] === "0151_source_occurrence_identity.sql") {
          // Disconnect only this test-owned client after all migration SQL, before its receipt/commit.
          interrupted = true;
          await runner.end();
        }
        const result = await runner.query(text, values);
        return { rows: result.rows, rowCount: result.rowCount };
      } });
      try {
        await expect(applyMigrations(interruptedDb, migrationsDir)).rejects.toThrow(/closed|ended|not queryable/i);
        expect(interrupted).toBe(true);
      } finally { await runner.end().catch(() => undefined); }
      expect((await db.query("select to_regclass('parameter_catalog.project_parameter_source_occurrences') as relation")).rows[0]?.relation).toBeNull();
      expect((await db.query("select * from parameter_catalog.project_parameter_bindings order by id")).rows).toEqual(before);
      expect((await db.query("select * from parameter_catalog.parameter_observations order by id")).rows).toEqual(observations);
      expect((await db.query("select name from schema_migrations where name >= '0151'")).rows).toEqual([]);

      const reconnected = new pg.Client({ connectionString });
      await reconnected.connect();
      const resumedDb = createDatabase({ query: async (text, values = []) => {
        const result = await reconnected.query(text, values);
        return { rows: result.rows, rowCount: result.rowCount };
      } });
      const olderInventory = await mkdtemp(join(tmpdir(), "wiseeff-t11-older-inventory-"));
      try {
        expect(await applyMigrations(resumedDb, migrationsDir)).toEqual([
          "0151_source_occurrence_identity.sql",
          "0152_pinned_source_graph_immutability.sql",
          "0153_source_occurrence_integrity.sql",
          "0154_plane_disposal_residue.sql",
          "0155_plane_disposal_grants.sql",
          "0156_plane_disposal_disposer_acl.sql",
          "0157_plane_disposal_regenerable_grants.sql",
          "0158_plane_disposal_allows_delete_acl.sql",
          "0159_plane_disposal_definer_select.sql",
          "0160_canonical_dts_delete_source_pin.sql",
          "0161_canonical_property_delete_tombstone.sql",
        ]);
        expect(await applyMigrations(resumedDb, migrationsDir)).toEqual([]);
        const receipt = (await resumedDb.query("select * from schema_migrations order by name")).rows;
        const bindings = (await resumedDb.query("select * from parameter_catalog.project_parameter_bindings order by id")).rows;
        expect(bindings.map(({ id }) => id)).toEqual(before.map(({ id }) => id));
        for (const name of (await readdir(migrationsDir)).filter((name) => name.endsWith(".sql") && name < "0151")) {
          await symlink(join(migrationsDir, name), join(olderInventory, name));
        }
        await expect(applyMigrations(resumedDb, olderInventory)).rejects.toThrow(/Applied migration files are missing/);
        expect((await resumedDb.query("select * from schema_migrations order by name")).rows).toEqual(receipt);
        expect((await resumedDb.query("select * from parameter_catalog.project_parameter_bindings order by id")).rows).toEqual(bindings);
      } finally {
        await reconnected.end();
        await rm(olderInventory, { recursive: true, force: true });
      }
    });
  });

  it("rejects a different occurrence on observations and matches without losing valid matches", async () => {
    await withTempDatabase(async (db, connectionString) => {
      await applyMigrations(db, migrationsDir, { through: "0150_product_feedback_v2.sql" });
      await seedPopulatedGraph(db, connectionString);
      await seedPopulatedObservations(db);
      await applyMigrations(db, migrationsDir);
      await db.query(`insert into dts_logical_nodes(id,organization_id,project_id,config_set_id)
        select 'logical-other-occurrence',organization_id,project_id,config_set_id
        from dts_logical_nodes where id='logical-node-src-occ-0151'`);
      await db.query(`insert into parameter_catalog.project_parameter_source_occurrences
        (id,organization_id,project_id,config_set_id,file_id,occurrence_kind,logical_node_id)
        select 'occurrence-other',organization_id,project_id,config_set_id,file_id,'dts','logical-other-occurrence'
        from parameter_catalog.project_parameter_source_occurrences where logical_node_id='logical-node-src-occ-0151'`);
      const matches = (await db.query("select * from parameter_catalog.parameter_observation_matches order by id")).rows;
      expect(matches).toHaveLength(2);
      await expect(db.transaction(async (tx) => {
        await tx.query(`insert into parameter_catalog.parameter_observations
          (id,organization_id,project_id,logical_node_id,config_revision_id,source_identity,source_locator,
           catalog_release_id,matcher_revision,evidence_fingerprint,source_occurrence_id,parameter_locator_digest)
          select 'observation-forged',organization_id,project_id,logical_node_id,config_revision_id,'identity-forged',source_locator,
            catalog_release_id,matcher_revision,'fingerprint-forged','occurrence-other',parameter_locator_digest
          from parameter_catalog.parameter_observations where id='observation-src-occ-0151'`);
        await tx.query("set constraints all immediate");
      })).rejects.toMatchObject({ code: "23503", constraint: "parameter_observation_source_owner_fk" });
      await expect(db.transaction(async (tx) => {
        await tx.query(`insert into parameter_catalog.parameter_observations
          (id,organization_id,project_id,logical_node_id,config_revision_id,source_identity,source_locator,
           catalog_release_id,matcher_revision,evidence_fingerprint,source_occurrence_id,parameter_locator_digest)
          select 'observation-valid-copy',organization_id,project_id,logical_node_id,config_revision_id,'identity-valid-copy',source_locator,
            catalog_release_id,'matcher-valid-copy','fingerprint-valid-copy',source_occurrence_id,parameter_locator_digest
          from parameter_catalog.parameter_observations where id='observation-src-occ-0151'`);
        await tx.query(`insert into parameter_catalog.parameter_observation_matches
          (id,observation_id,organization_id,project_id,logical_node_id,registration_id,subject_id,definition_id,
           definition_revision_id,binding_id,catalog_release_id,matcher_revision,source_occurrence_id,parameter_locator_digest)
          select 'match-forged','observation-valid-copy',organization_id,project_id,logical_node_id,registration_id,subject_id,definition_id,
            definition_revision_id,binding_id,catalog_release_id,'matcher-valid-copy','occurrence-other',parameter_locator_digest
          from parameter_catalog.parameter_observation_matches where id='match-src-occ-0151'`);
        await tx.query("set constraints all immediate");
      })).rejects.toMatchObject({ code: "23503" });
      expect((await db.query("select * from parameter_catalog.parameter_observation_matches order by id")).rows).toEqual(matches);
      expect((await db.query("select id from parameter_catalog.parameter_observations where id in ('observation-forged','observation-valid-copy')")).rows).toEqual([]);
    });
  });

  it("backfills populated observations, matches and linked review evidence without changing IDs", async () => {
    await withTempDatabase(async (db, connectionString) => {
      await applyMigrations(db, migrationsDir, { through: "0150_product_feedback_v2.sql" });
      await seedPopulatedGraph(db, connectionString);
      await seedPopulatedObservations(db);

      await expect(applyMigrations(db, migrationsDir)).resolves.toEqual([
        "0151_source_occurrence_identity.sql",
        "0152_pinned_source_graph_immutability.sql",
        "0153_source_occurrence_integrity.sql",
        "0154_plane_disposal_residue.sql",
        "0155_plane_disposal_grants.sql",
        "0156_plane_disposal_disposer_acl.sql",
        "0157_plane_disposal_regenerable_grants.sql",
        "0158_plane_disposal_allows_delete_acl.sql",
        "0159_plane_disposal_definer_select.sql",
        "0160_canonical_dts_delete_source_pin.sql",
        "0161_canonical_property_delete_tombstone.sql",
      ]);

      const rows = await db.query<{
        observation_id: string;
        match_id: string;
        review_id: string | null;
        source_occurrence_id: string;
        parameter_locator_digest: string;
      }>(
        `select observation.id as observation_id,
                match.id as match_id,
                review.id as review_id,
                observation.source_occurrence_id,
                observation.parameter_locator_digest
           from parameter_catalog.parameter_observations observation
           join parameter_catalog.parameter_observation_matches match
             on match.observation_id = observation.id
           left join parameter_catalog.parameter_review_evidence review
             on review.observation_id = observation.id
          where observation.id in ('observation-src-occ-0151', 'observation-src-occ-0151-secondary')
          order by observation.id`
      );
      expect(rows.rows).toHaveLength(2);
      expect(rows.rows.map(({ observation_id }) => observation_id)).toEqual([
        "observation-src-occ-0151",
        "observation-src-occ-0151-secondary"
      ]);
      expect(rows.rows.map(({ match_id }) => match_id)).toEqual([
        "match-src-occ-0151",
        "match-src-occ-0151-secondary"
      ]);
      expect(rows.rows[0]?.review_id).toBe("review-evidence-src-occ-0151");
      expect(rows.rows[1]?.review_id).toBeNull();
      expect(rows.rows[0]?.source_occurrence_id).toBe(rows.rows[1]?.source_occurrence_id);
      const locator = {
        kind: "dts-property",
        propertyOccurrenceId: "property-occurrence-src-occ-0151",
        nodeOccurrenceId: "node-occurrence-src-occ-0151",
        fileVersionId: "file-version-src-occ-0151-historical",
        propertyName: (await db.query<{ property_name: string }>(
          `select property_name from dts_property_occurrences where id = 'property-occurrence-src-occ-0151'`
        )).rows[0]?.property_name
      } as ContractJsonValue;
      const expectedDigest = `sha256:${createHash("sha256").update(serializeContract(locator)).digest("hex")}`;
      expect(rows.rows[0]?.parameter_locator_digest).toBe(expectedDigest);
      expect(rows.rows[1]?.parameter_locator_digest).toMatch(/^sha256:[0-9a-f]{64}$/);

      const replayRow = await db.query<{
        id: string;
        source_occurrence_id: string;
        catalog_release_id: string;
        evidence_fingerprint: string;
        source_locator: ContractJsonValue;
        logical_node_id: string;
        config_revision_id: string;
      }>(
        `select id, source_occurrence_id, catalog_release_id, evidence_fingerprint,
                source_locator,
                logical_node_id, config_revision_id
           from parameter_catalog.parameter_observations
          where id = 'observation-src-occ-0151'`
      );
      const migratedObservation = replayRow.rows[0];
      if (!migratedObservation) throw new Error("migrated observation is missing");
      const replayCommand = {
        organizationId: "org-src-occ-0151",
        sourceIdentity: "legacy-observation-src-occ-0151-0",
        catalogReleaseId: CatalogReleaseId(migratedObservation.catalog_release_id),
        matcherRevision: "matcher-src-occ-0151",
        matcherOutput: { status: "matched" as const },
        provenance: {
          projectId: "project-src-occ-0151",
          logicalNodeId: migratedObservation.logical_node_id,
          configRevisionId: migratedObservation.config_revision_id,
          sourceOccurrenceId: migratedObservation.source_occurrence_id,
          sourceLocator: migratedObservation.source_locator as Record<string, ContractJsonValue>,
        },
      };
      const replayFingerprint = fingerprintCanonical({
        kind: "parameter-observation",
        organizationId: replayCommand.organizationId,
        sourceIdentity: replayCommand.sourceIdentity,
        catalogReleaseId: replayCommand.catalogReleaseId,
        matcherRevision: replayCommand.matcherRevision,
        matcherOutput: replayCommand.matcherOutput,
        projectId: replayCommand.provenance.projectId,
        logicalNodeId: replayCommand.provenance.logicalNodeId,
        configRevisionId: replayCommand.provenance.configRevisionId,
        sourceLocator: replayCommand.provenance.sourceLocator,
      } as ContractJsonValue);
      expect(migratedObservation.evidence_fingerprint).toBe(replayFingerprint);
      const reconnectPool = new pg.Pool({
        connectionString,
        max: 1,
        options: "-c role=parameter_governance_writer_role",
      });
      try {
        const replay = await createEvidenceIngest(reconnectPool).ingest(replayCommand);
        expect(replay).toMatchObject({
          ok: true,
          value: {
            kind: "observation",
            status: "replayed",
            id: "observation-src-occ-0151",
          },
        });
      } finally {
        await reconnectPool.end();
      }
      expect(
        (await db.query(
          `select count(*)::int as count
             from parameter_catalog.parameter_observations
            where id = 'observation-src-occ-0151'`
        )).rows[0]?.count
      ).toBe(1);
      expect(
        (await db.query(
          `select count(*)::int as count
             from parameter_catalog.parameter_observation_matches
            where observation_id = 'observation-src-occ-0151'`
        )).rows[0]?.count
      ).toBe(1);
      expect(
        (await db.query(
          `select count(*)::int as count
             from parameter_catalog.parameter_review_evidence
            where id = 'review-evidence-src-occ-0151'`
        )).rows[0]?.count
      ).toBe(1);

      const digestVectors = [
        {
          locator: {
            fileVersionId: "version-1",
            kind: "dts-property",
            nodeOccurrenceId: "node-1",
            propertyName: "clock-frequency",
            propertyOccurrenceId: "property-1"
          },
          expected: "sha256:1b9ad36da413ad4a105de8eedaece29006c15816b74ce8628e8d7b9d03f3dea4"
        },
        {
          locator: {
            fileVersionId: "版本-1",
            kind: "dts-property",
            nodeOccurrenceId: "节点/1",
            propertyName: "中文\"\\/ café",
            propertyOccurrenceId: "property-😀"
          }
        }
      ] as const;
      for (const vector of digestVectors) {
        const result = await db.query<{ digest: string }>(
          `select parameter_catalog.canonical_dts_parameter_locator_digest($1::jsonb) as digest`,
          [JSON.stringify(vector.locator)]
        );
        const expected = vector.expected ??
          `sha256:${createHash("sha256")
            .update(serializeContract(vector.locator as ContractJsonValue))
            .digest("hex")}`;
        expect(result.rows[0]?.digest).toBe(expected);
      }
    });
  });

  it("freezes the whole pinned graph and every member version, not only the selected property", async () => {
    await withTempDatabase(async (db, connectionString) => {
      await applyMigrations(db, migrationsDir, { through: "0150_product_feedback_v2.sql" });
      await seedPopulatedGraph(db, connectionString);
      await applyMigrations(db, migrationsDir, { through: "0151_source_occurrence_identity.sql" });
      // Build the pre-successor state through the old, genuinely permissive writer.
      // These are relational migration fixtures, not object-store/workflow proof.
      await db.query(`insert into project_parameter_files(id,organization_id,project_id,file_name,format,config_set_id)
        select 'file-src-occ-extra',organization_id,project_id,'extra.dtsi',format,config_set_id
        from project_parameter_files where id='file-src-occ-0151'`);
      await db.query(`insert into project_parameter_file_versions(id,file_id,version_number,storage_key,checksum,size_bytes,origin,created_by_user_id)
        select 'version-src-occ-extra','file-src-occ-extra',1,storage_key,checksum,size_bytes,origin,created_by_user_id
        from project_parameter_file_versions where id='file-version-src-occ-0151-historical'`);
      await db.query(`insert into dts_config_revision_members(id,config_revision_id,file_id,file_version_id,source_name,role,sort_order)
        values ('member-src-occ-extra','config-revision-src-occ-0151','file-src-occ-extra','version-src-occ-extra','extra.dtsi','include',1)`);
      await db.query(`insert into dts_logical_nodes(id,organization_id,project_id,config_set_id)
        select 'logical-src-occ-extra',organization_id,project_id,config_set_id from dts_logical_nodes where id='logical-node-src-occ-0151'`);
      await db.query(`insert into dts_logical_node_revisions(id,logical_node_id,config_revision_id,node_locator,name)
        values ('logical-revision-src-occ-extra','logical-src-occ-extra','config-revision-src-occ-0151','/extra','extra')`);
      await db.query(`insert into dts_node_occurrences(id,config_revision_id,file_version_id,name,node_path,start_offset,end_offset,start_line,start_column,end_line,end_column,raw_text)
        values ('node-src-occ-extra','config-revision-src-occ-0151','version-src-occ-extra','extra','/extra',0,10,1,1,1,10,'extra')`);
      await db.query(`insert into dts_property_occurrences(id,config_revision_id,node_occurrence_id,file_version_id,property_name,start_offset,end_offset,start_line,start_column,end_line,end_column,raw_text)
        values ('property-src-occ-extra','config-revision-src-occ-0151','node-src-occ-extra','version-src-occ-extra','unselected',1,2,1,2,1,3,'1')`);
      await db.query(`insert into dts_occurrence_effects(id,config_revision_id,logical_node_revision_id,node_occurrence_id,property_occurrence_id,property_name,effect_kind,source_order)
        values ('effect-src-occ-extra','config-revision-src-occ-0151','logical-revision-src-occ-extra','node-src-occ-extra',null,'unselected','delete',10)`);
      await applyMigrations(db,migrationsDir);

      const unexpectedlyAllowed = new Error("mutation unexpectedly allowed; rollback probe");
      const cases: Array<[string,(tx: import("../../../shared/database/client").Queryable) => Promise<unknown>]> = [
        ["new member insert with a nonempty alias", tx => tx.query(`insert into dts_config_revision_members(id,config_revision_id,file_id,file_version_id,source_name,role,sort_order)
          values ('new-probe-member','config-revision-src-occ-0151','file-src-occ-0151','file-version-src-occ-0151-current','new.dtsi','include',3)`)],
        ["new logical revision insert", tx => tx.query(`insert into dts_logical_node_revisions(id,logical_node_id,config_revision_id,node_locator,name)
          values ('new-probe-logical-revision','logical-src-occ-extra','config-revision-src-occ-0151','/new','new')`)],
        ["revision semantic update", tx => tx.query(`update dts_config_revisions set status='invalid' where id='config-revision-src-occ-0151'`)],
        ["revision delete", tx => tx.query(`delete from dts_config_revisions where id='config-revision-src-occ-0151'`)],
        ["unselected member update", tx => tx.query(`update dts_config_revision_members set role='overlay' where id='member-src-occ-extra'`)],
        ["unselected member delete", tx => tx.query(`delete from dts_config_revision_members where id='member-src-occ-extra'`)],
        ["unselected logical revision update", tx => tx.query(`update dts_logical_node_revisions set name='changed' where id='logical-revision-src-occ-extra'`)],
        ["unselected logical revision delete", tx => tx.query(`delete from dts_logical_node_revisions where id='logical-revision-src-occ-extra'`)],
        ["unselected node update", tx => tx.query(`update dts_node_occurrences set raw_text='changed' where id='node-src-occ-extra'`)],
        ["unselected node delete", tx => tx.query(`delete from dts_node_occurrences where id='node-src-occ-extra'`)],
        ["unselected property update", tx => tx.query(`update dts_property_occurrences set raw_text='9' where id='property-src-occ-extra'`)],
        ["unselected property delete", tx => tx.query(`delete from dts_property_occurrences where id='property-src-occ-extra'`)],
        ["null-property delete effect update", tx => tx.query(`update dts_occurrence_effects set source_order=99 where id='effect-src-occ-extra'`)],
        ["null-property delete effect delete", tx => tx.query(`delete from dts_occurrence_effects where id='effect-src-occ-extra'`)],
        ["target version update", tx => tx.query(`update project_parameter_file_versions set checksum='changed' where id='file-version-src-occ-0151-historical'`)],
        ["other member version update", tx => tx.query(`update project_parameter_file_versions set storage_key='changed' where id='version-src-occ-extra'`)],
        ["other member version delete", tx => tx.query(`delete from project_parameter_file_versions where id='version-src-occ-extra'`)],
        ["other member file format", tx => tx.query(`update project_parameter_files set format='json' where id='file-src-occ-extra'`)],
        ["other member file delete", tx => tx.query(`delete from project_parameter_files where id='file-src-occ-extra'`)],
        ["new node insert", tx => tx.query(`insert into dts_node_occurrences(id,config_revision_id,file_version_id,name,node_path,start_offset,end_offset,start_line,start_column,end_line,end_column,raw_text)
          select 'new-probe-node',config_revision_id,file_version_id,name,node_path,start_offset,end_offset,start_line,start_column,end_line,end_column,raw_text from dts_node_occurrences where id='node-src-occ-extra'`)],
        ["new property insert", tx => tx.query(`insert into dts_property_occurrences(id,config_revision_id,node_occurrence_id,file_version_id,property_name,start_offset,end_offset,start_line,start_column,end_line,end_column,raw_text)
          select 'new-probe-property',config_revision_id,node_occurrence_id,file_version_id,'another',start_offset,end_offset,start_line,start_column,end_line,end_column,raw_text from dts_property_occurrences where id='property-src-occ-extra'`)],
        ["new delete effect insert", tx => tx.query(`insert into dts_occurrence_effects(id,config_revision_id,logical_node_revision_id,node_occurrence_id,property_name,effect_kind,source_order)
          select 'new-probe-effect',config_revision_id,logical_node_revision_id,node_occurrence_id,'another','delete',20 from dts_occurrence_effects where id='effect-src-occ-extra'`)],
      ];
      for (const [name,mutate] of cases) {
        const error = await db.transaction(async (tx) => { await mutate(tx); throw unexpectedlyAllowed; }).catch((error: unknown) => error);
        expect.soft(error,name).toMatchObject({ code: "55000" });
      }
      await db.query(`update project_parameter_files set file_name='renamed.dtsi',current_version_id='version-src-occ-extra',updated_at=now() where id='file-src-occ-extra'`);
      expect((await db.query<{ file_name: string }>(`select file_name from project_parameter_files where id='file-src-occ-extra'`)).rows[0]?.file_name).toBe("renamed.dtsi");
    });
  });

  it("serializes first pins against child-first writers, including older repeatable-read snapshots", async () => {
    await withTempDatabase(async (db, connectionString) => {
      await applyMigrations(db,migrationsDir,{ through: "0150_product_feedback_v2.sql" });
      await seedPopulatedGraph(db,connectionString);
      await applyMigrations(db,migrationsDir);
      await db.query(`insert into dts_config_revisions(id,organization_id,project_id,config_set_id,revision_number,status,created_by_user_id)
        select 'race-revision',organization_id,project_id,config_set_id,2,status,created_by_user_id from dts_config_revisions where id='config-revision-src-occ-0151'`);
      await db.query(`insert into dts_config_revision_members(id,config_revision_id,file_id,file_version_id,source_name,role,sort_order)
        select 'race-member','race-revision',file_id,file_version_id,source_name,role,sort_order from dts_config_revision_members where id='member-src-occ-0151'`);
      await db.query(`insert into dts_logical_node_revisions(id,logical_node_id,config_revision_id,node_locator,name,compatible)
        select 'race-logical-revision',logical_node_id,'race-revision',node_locator,name,compatible from dts_logical_node_revisions where id='logical-node-revision-src-occ-0151'`);
      await db.query(`insert into dts_node_occurrences(id,config_revision_id,file_version_id,name,node_path,start_offset,end_offset,start_line,start_column,end_line,end_column,raw_text)
        select 'race-node','race-revision',file_version_id,name,node_path,start_offset,end_offset,start_line,start_column,end_line,end_column,raw_text from dts_node_occurrences where id='node-occurrence-src-occ-0151'`);
      await db.query(`insert into dts_property_occurrences(id,config_revision_id,node_occurrence_id,file_version_id,property_name,start_offset,end_offset,start_line,start_column,end_line,end_column,raw_text)
        select 'race-property','race-revision','race-node',file_version_id,property_name,start_offset,end_offset,start_line,start_column,end_line,end_column,raw_text from dts_property_occurrences where id='property-occurrence-src-occ-0151'`);
      await db.query(`insert into dts_occurrence_effects(id,config_revision_id,logical_node_revision_id,node_occurrence_id,property_occurrence_id,property_name,effect_kind,source_order)
        select 'race-effect','race-revision','race-logical-revision','race-node','race-property',property_name,effect_kind,source_order from dts_occurrence_effects where id='effect-src-occ-0151'`);
      await db.query(`insert into parameter_catalog.project_parameter_values(id,binding_id,definition_id,definition_revision_id,source_ref,config_revision_id,value_digest,value_kind,value)
        select 'race-value',binding_id,definition_id,definition_revision_id,source_ref,'race-revision',value_digest,value_kind,value from parameter_catalog.project_parameter_values where id='value-src-occ-0151'`);
      const moves = [
        (tx: import("../../../shared/database/client").Queryable) => tx.query(`update dts_config_revisions set id='config-revision-src-occ-0151' where id='race-revision'`),
        (tx: import("../../../shared/database/client").Queryable) => tx.query(`update dts_config_revision_members set config_revision_id='config-revision-src-occ-0151' where id='race-member'`),
        (tx: import("../../../shared/database/client").Queryable) => tx.query(`update dts_logical_node_revisions set config_revision_id='config-revision-src-occ-0151' where id='race-logical-revision'`),
        (tx: import("../../../shared/database/client").Queryable) => tx.query(`update dts_node_occurrences set config_revision_id='config-revision-src-occ-0151' where id='race-node'`),
        (tx: import("../../../shared/database/client").Queryable) => tx.query(`update dts_property_occurrences set config_revision_id='config-revision-src-occ-0151' where id='race-property'`),
        (tx: import("../../../shared/database/client").Queryable) => tx.query(`update dts_occurrence_effects set config_revision_id='config-revision-src-occ-0151' where id='race-effect'`),
      ];
      for (const move of moves) {
        await expect(db.transaction(move)).rejects.toMatchObject({ code: "55000" });
      }
      const beforeMixed = (await db.query(`select id,source_order from dts_occurrence_effects order by id`)).rows;
      await expect(db.query(`update dts_occurrence_effects set source_order=source_order+10
        where id in ('race-effect','effect-src-occ-0151')`)).rejects.toMatchObject({ code: "55000" });
      expect((await db.query(`select id,source_order from dts_occurrence_effects order by id`)).rows).toEqual(beforeMixed);
      const privileges = await db.query<{ role: string; revision_id: boolean; revision_status: boolean; execute_pin: boolean; execute_file: boolean }>(
        `select rolname as role,has_column_privilege(rolname,'public.dts_config_revisions','id','UPDATE') as revision_id,
          has_column_privilege(rolname,'public.dts_config_revisions','status','UPDATE') as revision_status,
          has_function_privilege(rolname,'parameter_catalog.fence_first_source_pin()','EXECUTE') as execute_pin,
          has_function_privilege(rolname,'parameter_catalog.protect_pinned_source_file()','EXECUTE') as execute_file
         from pg_roles where rolname=any($1::text[]) order by rolname`,
        [["catalog_migration_owner","catalog_synchronizer_role","parameter_governance_writer_role","catalog_publication_coordinator_role","catalog_baseline_reader_role"]]);
      expect(privileges.rows).toHaveLength(5);
      for (const privilege of privileges.rows) {
        expect(privilege).toEqual({ role: privilege.role,revision_id: privilege.role === "catalog_migration_owner",
          revision_status: false,execute_pin: privilege.role === "catalog_migration_owner",execute_file: privilege.role === "catalog_migration_owner" });
      }
      const pin = (client: pg.PoolClient) => client.query(`insert into parameter_catalog.project_value_source_pins(
        id,project_value_id,binding_id,definition_id,organization_id,project_id,source_occurrence_id,config_revision_id,file_id,file_version_id,format,property_occurrence_id,locator,locator_digest)
        select 'race-pin','race-value',binding_id,definition_id,organization_id,project_id,source_occurrence_id,'race-revision',file_id,file_version_id,format,'race-property',
          locator || '{"propertyOccurrenceId":"race-property","nodeOccurrenceId":"race-node"}'::jsonb,locator_digest
        from parameter_catalog.project_value_source_pins where project_value_id='value-src-occ-0151'`);
      const pool = new pg.Pool({ connectionString,max: 2 });
      const writer = await pool.connect();
      const pinner = await pool.connect();
      try {
        await writer.query("begin");
        await writer.query(`update dts_occurrence_effects set source_order=source_order+1 where id='race-effect'`);
        await pinner.query("begin");
        await expect(pin(pinner)).rejects.toMatchObject({ code: "55P03" });
        await pinner.query("rollback");
        await writer.query("rollback");

        // The row itself must be genuinely deletable before its first pin.
        await writer.query("begin");
        expect((await writer.query(`delete from dts_occurrence_effects where id='race-effect' returning id`)).rowCount).toBe(1);
        await writer.query("rollback");
        expect((await writer.query(`select id from dts_occurrence_effects where id='race-effect'`)).rowCount).toBe(1);
        await writer.query(`insert into dts_occurrence_effects(id,config_revision_id,logical_node_revision_id,node_occurrence_id,property_name,effect_kind,source_order)
          values ('unpinned-delete-probe','race-revision','race-logical-revision','race-node','unused','delete',100)`);
        expect((await writer.query(`delete from dts_occurrence_effects where id='unpinned-delete-probe' returning id`)).rowCount).toBe(1);
        expect((await writer.query(`select id from dts_occurrence_effects where id='unpinned-delete-probe'`)).rowCount).toBe(0);

        // Establish an older RR snapshot before the first pin's tuple barrier.
        await writer.query("begin isolation level repeatable read");
        await writer.query(`select id from dts_config_revisions where id='race-revision'`);
        await pinner.query("begin");
        await pinner.query("set local role catalog_migration_owner");
        await pin(pinner);
        await expect(writer.query(`update dts_occurrence_effects set source_order=2 where id='race-effect'`)).rejects.toMatchObject({ code: "55P03" });
        await writer.query("rollback");
        await writer.query("begin isolation level repeatable read");
        await writer.query(`select id from dts_config_revisions where id='race-revision'`);
        await pinner.query("commit");
        await expect(writer.query(`update dts_occurrence_effects set source_order=2 where id='race-effect'`)).rejects.toMatchObject({ code: "40001" });
        await writer.query("rollback");
        await expect(writer.query(`update dts_occurrence_effects set source_order=2 where id='race-effect'`)).rejects.toMatchObject({ code: "55000" });
        expect((await writer.query(`select id from parameter_catalog.project_value_source_pins where id='race-pin'`)).rowCount).toBe(1);
      } finally {
        await writer.query("rollback");
        await pinner.query("rollback");
        writer.release(); pinner.release(); await pool.end();
      }
    });
  });

  it("creates the unified occurrence table under the catalog owner", async () => {
    await withTempDatabase(async (db) => {
      await applyMigrations(db, migrationsDir);

      const relation = await db.query<{ relation: string | null }>(
        `select to_regclass('parameter_catalog.project_parameter_source_occurrences')::text as relation`
      );
      expect(relation.rows[0]?.relation).toBe(
        "parameter_catalog.project_parameter_source_occurrences"
      );

      const owner = await db.query<{ owner: string | null }>(
        `select pg_get_userbyid(class.relowner) as owner
           from pg_class class
           join pg_namespace namespace on namespace.oid = class.relnamespace
          where namespace.nspname = 'parameter_catalog'
            and class.relname = 'project_parameter_source_occurrences'`
      );
      expect(owner.rows[0]?.owner).toBe("catalog_migration_owner");

      const ownerConstraint = await db.query<{ definition: string }>(
        `select pg_get_constraintdef(con.oid) as definition
           from pg_constraint con
           join pg_class class on class.oid = con.conrelid
           join pg_namespace namespace on namespace.oid = class.relnamespace
          where namespace.nspname = 'parameter_catalog'
            and class.relname = 'project_parameter_source_occurrences'
            and con.conname = 'source_occurrence_project_owner_fk'`
      );
      expect(ownerConstraint.rows[0]?.definition).toContain(
        "(project_id, organization_id) REFERENCES projects(id, organization_id)"
      );

      const requestColumns = await db.query<{ column_name: string }>(
        `select column_name
           from information_schema.columns
          where table_schema = 'public'
            and table_name = 'project_parameter_value_change_requests'
            and column_name in ('candidate_binding_manifest', 'applied_source_result')
          order by column_name`
      );
      expect(requestColumns.rows.map((row) => row.column_name)).toEqual([
        "applied_source_result",
        "candidate_binding_manifest"
      ]);

      const candidateColumns = await db.query<{ column_name: string }>(
        `select column_name
           from information_schema.columns
          where table_schema = 'public'
            and table_name = 'project_parameter_file_candidates'
            and column_name = 'frozen_binding_manifest'`
      );
      expect(candidateColumns.rows).toHaveLength(1);
    });
  });

  it("backfills a historical DTS root and ProjectValue pin without changing legacy IDs", async () => {
    await withTempDatabase(async (db, connectionString) => {
      await applyMigrations(db, migrationsDir, { through: "0150_product_feedback_v2.sql" });
      await seedPopulatedGraph(db, connectionString);

      const before = await db.query<{ binding_id: string; value_id: string; current_version_id: string }>(
        `select binding.id as binding_id,
                binding.current_value_id as value_id,
                file.current_version_id
           from parameter_catalog.project_parameter_bindings binding
           join public.project_parameter_files file on file.id = 'file-src-occ-0151'
          where binding.id = 'binding-src-occ-0151'`
      );
      expect(before.rows[0]).toEqual({
        binding_id: "binding-src-occ-0151",
        value_id: "value-src-occ-0151",
        current_version_id: "file-version-src-occ-0151-current"
      });

      await applyMigrations(db, migrationsDir);

      const after = await db.query<{
        binding_id: string;
        value_id: string;
        source_occurrence_id: string;
        source_file_id: string;
        source_file_version_id: string;
        config_revision_id: string;
      }>(
        `select binding.id as binding_id,
                value.id as value_id,
                binding.source_occurrence_id,
                pin.file_id as source_file_id,
                pin.file_version_id as source_file_version_id,
                pin.config_revision_id
           from parameter_catalog.project_parameter_bindings binding
           join parameter_catalog.project_parameter_values value
             on value.id = binding.current_value_id
           join parameter_catalog.project_value_source_pins pin
             on pin.project_value_id = value.id
          where binding.id = 'binding-src-occ-0151'`
      );
      expect(after.rows).toHaveLength(1);
      expect(after.rows[0]).toMatchObject({
        binding_id: "binding-src-occ-0151",
        value_id: "value-src-occ-0151",
        source_file_id: "file-src-occ-0151",
        source_file_version_id: "file-version-src-occ-0151-historical",
        config_revision_id: "config-revision-src-occ-0151"
      });
      expect(after.rows[0]?.source_occurrence_id).toMatch(/^src_occ_dts_/);

      const memberAlias = await db.query<{ source_name: string | null }>(
        `select source_name
           from public.dts_config_revision_members
          where config_revision_id = 'config-revision-src-occ-0151'
            and file_id = 'file-src-occ-0151'`
      );
      expect(memberAlias.rows).toEqual([{ source_name: "source.dts" }]);

      const resolver = await db.query<{ binding_id: string | null }>(
        `select parameter_catalog.resolve_current_binding(
           'project-src-occ-0151',
           (select logical_node_id from parameter_catalog.project_parameter_bindings
             where id = 'binding-src-occ-0151'),
           (select definition_id from parameter_catalog.project_parameter_bindings
             where id = 'binding-src-occ-0151')
         ) as binding_id`
      );
      expect(resolver.rows[0]?.binding_id).toBe("binding-src-occ-0151");
      const resolverDefinition = await db.query<{ definition: string }>(
        `select pg_get_functiondef(
           'parameter_catalog.resolve_current_binding(text,text,text)'::regprocedure
         ) as definition`
      );
      expect(resolverDefinition.rows[0]?.definition).not.toMatch(/limit\s+1/i);

      const acl = await db.query<{
        public_select: boolean;
        synchronizer_select: boolean;
        governance_select: boolean;
        coordinator_select: boolean;
        baseline_select: boolean;
        owner_select: boolean;
        public_execute: boolean;
      }>(
        `select has_table_privilege('public', 'parameter_catalog.project_parameter_source_occurrences', 'SELECT') as public_select,
                has_table_privilege('catalog_synchronizer_role', 'parameter_catalog.project_parameter_source_occurrences', 'SELECT') as synchronizer_select,
                has_table_privilege('parameter_governance_writer_role', 'parameter_catalog.project_parameter_source_occurrences', 'SELECT') as governance_select,
                has_table_privilege('catalog_publication_coordinator_role', 'parameter_catalog.project_parameter_source_occurrences', 'SELECT') as coordinator_select,
                has_table_privilege('catalog_baseline_reader_role', 'parameter_catalog.project_parameter_source_occurrences', 'SELECT') as baseline_select,
                has_table_privilege('catalog_migration_owner', 'parameter_catalog.project_parameter_source_occurrences', 'SELECT') as owner_select,
                has_function_privilege('public', 'parameter_catalog.resolve_current_binding(text,text,text)', 'EXECUTE') as public_execute`
      );
      expect(acl.rows[0]).toEqual({
        public_select: false,
        synchronizer_select: false,
        governance_select: false,
        coordinator_select: false,
        baseline_select: false,
        owner_select: true,
        public_execute: false
      });

      const pin = await db.query<{
        id: string;
        binding_id: string;
        definition_id: string;
        organization_id: string;
        project_id: string;
        source_occurrence_id: string;
        config_revision_id: string;
        file_id: string;
        file_version_id: string;
        property_occurrence_id: string;
        locator: unknown;
      }>(
        `select id, binding_id, definition_id, organization_id, project_id,
                source_occurrence_id, config_revision_id, file_id, file_version_id,
                property_occurrence_id, locator
           from parameter_catalog.project_value_source_pins
          where project_value_id = 'value-src-occ-0151'`
      );
      expect(pin.rows).toHaveLength(1);
      const existingPin = pin.rows[0]!;
      const requestMetadata = await db.query<{
        definition_revision_id: string;
        catalog_release_id: string;
      }>(
        `select value.definition_revision_id, binding.catalog_release_id
           from parameter_catalog.project_parameter_values value
           join parameter_catalog.project_parameter_bindings binding
             on binding.id = value.binding_id
          where value.id = 'value-src-occ-0151'`
      );
      const metadata = requestMetadata.rows[0]!;
      await db.transaction(async (tx) => {
        await tx.query(
          `insert into parameter_catalog.project_parameter_values (
             id, binding_id, definition_id, definition_revision_id, source_ref,
             config_revision_id, value_digest, value_kind, value
           ) values ('value-src-occ-0151-appended', $1, $2,
                     (select definition_revision_id from parameter_catalog.project_parameter_values where id = $3),
                     'source:appended', $4, 'digest-appended', 'number', '2'::jsonb)`,
          [existingPin.binding_id, existingPin.definition_id, "value-src-occ-0151", existingPin.config_revision_id]
        );
        await tx.query(
          `insert into parameter_catalog.project_value_source_pins (
             id, project_value_id, binding_id, definition_id, organization_id, project_id,
             source_occurrence_id, config_revision_id, file_id, file_version_id, format,
             property_occurrence_id, locator, locator_digest
           ) values ('source-pin-src-occ-0151-appended', 'value-src-occ-0151-appended', $1, $2, $3, $4,
                     $5, $6, $7, $8, 'dts', $9, $10::jsonb, 'md5:appended')`,
          [
            existingPin.binding_id,
            existingPin.definition_id,
            existingPin.organization_id,
            existingPin.project_id,
            existingPin.source_occurrence_id,
            existingPin.config_revision_id,
            existingPin.file_id,
            existingPin.file_version_id,
            existingPin.property_occurrence_id,
            JSON.stringify(existingPin.locator)
          ]
        );
        await tx.query(
          `update parameter_catalog.project_parameter_bindings
              set current_value_id = 'value-src-occ-0151-appended'
            where id = 'binding-src-occ-0151'`
        );
      });
      const appended = await db.query<{ current_value_id: string }>(
        `select current_value_id
           from parameter_catalog.project_parameter_bindings
          where id = 'binding-src-occ-0151'`
      );
      expect(appended.rows[0]?.current_value_id).toBe("value-src-occ-0151-appended");

      const requestId = "request-src-occ-0151-result";
      const historyId = "history-src-occ-0151-result";
      const appliedSourceResult = {
        version: 1,
        bindings: [
          {
            ordinal: 0,
            kind: "target",
            bindingId: "binding-src-occ-0151",
            oldValueId: "value-src-occ-0151",
            newValueId: "value-src-occ-0151-appended",
            sourcePinId: "source-pin-src-occ-0151-appended",
            configRevisionId: "config-revision-src-occ-0151",
            fileVersionId: "file-version-src-occ-0151-historical",
            historyEventId: historyId
          }
        ]
      };
      await db.transaction(async (tx) => {
        await tx.query(
          `insert into public.project_parameter_value_change_requests (
             id, organization_id, project_id, draft_id, binding_id, definition_id,
             definition_revision_id, catalog_release_id, base_current_value_id,
             config_revision_id, source_ref, action, target_value, reason, status,
             submitter_user_id, source_pin_id
           ) values ($1, $2, $3, null, $4, $5, $6, $7, $8, $9,
                     'source:result', 'set', '2'::jsonb, 'apply result fixture', 'pending', $10, $11)`,
          [
            requestId,
            "org-src-occ-0151",
            "project-src-occ-0151",
            existingPin.binding_id,
            existingPin.definition_id,
            metadata.definition_revision_id,
            metadata.catalog_release_id,
            "value-src-occ-0151",
            existingPin.config_revision_id,
            "user-src-occ-0151",
            existingPin.id
          ]
        );
        await tx.query(
          `insert into parameter_catalog.binding_history_events (
             id, binding_id, old_effective_revision_id, new_effective_revision_id,
             old_current_value_id, new_current_value_id, reason, success_audit_ref,
             catalog_release_id, applied_request_id
           ) values ($1, $2, $3, $3, $4, $5, 'apply result fixture',
                     'audit-result-src-occ-0151', $6, $7)`,
          [
            historyId,
            existingPin.binding_id,
            metadata.definition_revision_id,
            "value-src-occ-0151",
            "value-src-occ-0151-appended",
            metadata.catalog_release_id,
            requestId
          ]
        );
        await tx.query(
          `update public.project_parameter_value_change_requests
              set status = 'approved', applied_value_id = $2,
                  apply_outcome = 'committed', applied_at = now(),
                  applied_history_event_id = $3, applied_audit_ref = $4,
                  applied_file_version_ids = $5::jsonb,
                  applied_source_result = $6::jsonb
            where id = $1`,
          [
            requestId,
            "value-src-occ-0151-appended",
            historyId,
            "audit-result-src-occ-0151",
            JSON.stringify(["file-version-src-occ-0151-historical"]),
            JSON.stringify(appliedSourceResult)
          ]
        );
      });
      const resultRow = await db.query<{ applied_source_result: unknown }>(
        `select applied_source_result
           from public.project_parameter_value_change_requests
          where id = $1`,
        [requestId]
      );
      expect(resultRow.rows[0]?.applied_source_result).toEqual(appliedSourceResult);
      await expect(
        db.query(
          `update public.project_parameter_value_change_requests
              set applied_source_result = '{"version":2}'::jsonb
            where id = $1`,
          [requestId]
        )
      ).rejects.toThrow("Applied source request result is immutable");
      await expect(
        db.query(
          `insert into public.project_parameter_value_change_requests (
             id, organization_id, project_id, draft_id, binding_id, definition_id,
             definition_revision_id, catalog_release_id, base_current_value_id,
             config_revision_id, source_ref, action, target_value, reason, status,
             submitter_user_id, applied_source_result
           ) values ('request-src-occ-0151-invalid-result', $1, $2, null, $3, $4, $5, $6,
                     $7, $8, 'source:invalid-result', 'set', '2'::jsonb,
                     'invalid result fixture', 'pending', $9, '[]'::jsonb)`,
          [
            "org-src-occ-0151",
            "project-src-occ-0151",
            existingPin.binding_id,
            existingPin.definition_id,
            metadata.definition_revision_id,
            metadata.catalog_release_id,
            "value-src-occ-0151",
            existingPin.config_revision_id,
            "user-src-occ-0151"
          ]
        )
      ).rejects.toThrow(/project_parameter_value_change_request_applied_source_result_ck|project_parameter_value_change_requests_outcome_ck/);

      await db.query(
        `insert into parameter_catalog.binding_history_events (
           id, binding_id, old_effective_revision_id, new_effective_revision_id,
           old_current_value_id, new_current_value_id, reason, success_audit_ref,
           catalog_release_id
         ) values ('history-src-occ-0151-sibling', $1, $2, $2, null, $3,
                   'derived sibling fixture', 'audit-sibling-src-occ-0151', $4)`,
        [
          existingPin.binding_id,
          metadata.definition_revision_id,
          "value-src-occ-0151",
          metadata.catalog_release_id
        ]
      );
      await expect(
        db.query(
          `insert into parameter_catalog.binding_history_events (
             id, binding_id, old_effective_revision_id, new_effective_revision_id,
             old_current_value_id, new_current_value_id, reason, success_audit_ref,
             catalog_release_id, applied_request_id
           ) values ('history-src-occ-0151-duplicate', $1, $2, $2, null, $3,
                     'duplicate target fixture', 'audit-duplicate-src-occ-0151', $4, $5)`,
          [
            existingPin.binding_id,
            metadata.definition_revision_id,
            "value-src-occ-0151",
            metadata.catalog_release_id,
            requestId
          ]
        )
      ).rejects.toThrow(/binding_history_events_applied_request_uk|duplicate key/);

      await expect(
        db.query(
          `update public.dts_config_revision_members
              set role = 'overlay'
            where config_revision_id = 'config-revision-src-occ-0151'
              and file_id = 'file-src-occ-0151'`
        )
      ).rejects.toMatchObject({ code: "55000" });
      await expect(
        db.query(
          `update public.dts_config_revision_members
              set source_name = 'renamed.dts'
            where config_revision_id = 'config-revision-src-occ-0151'
              and file_id = 'file-src-occ-0151'`
        )
      ).rejects.toMatchObject({ code: "55000" });
      await expect(
        db.query(
          `update public.dts_config_revisions
              set organization_id = 'foreign-org'
            where id = 'config-revision-src-occ-0151'`
        )
      ).rejects.toMatchObject({ code: "55000" });
      await expect(
        db.query(
          `update public.dts_property_occurrences
              set property_name = 'other_property'
            where id = 'property-occurrence-src-occ-0151'`
        )
      ).rejects.toMatchObject({ code: "55000" });
      await expect(
        db.query(
          `update public.dts_occurrence_effects
              set effect_kind = 'override'
            where id = 'effect-src-occ-0151'`
        )
      ).rejects.toMatchObject({ code: "55000" });

      await expect(
        db.transaction(async (tx) => {
          await tx.query(
            `insert into parameter_catalog.project_parameter_values (
               id, binding_id, definition_id, definition_revision_id, source_ref,
               config_revision_id, value_digest, value_kind, value
             ) values ('value-src-occ-0151-forged-member', $1, $2,
                       (select definition_revision_id from parameter_catalog.project_parameter_values where id = $3),
                       'source:forged-member', $4, 'digest-forged-member', 'number', '4'::jsonb)`,
            [existingPin.binding_id, existingPin.definition_id, "value-src-occ-0151", existingPin.config_revision_id]
          );
          await tx.query(
            `insert into parameter_catalog.project_value_source_pins (
               id, project_value_id, binding_id, definition_id, organization_id, project_id,
               source_occurrence_id, config_revision_id, file_id, file_version_id, format,
               property_occurrence_id, locator, locator_digest
             ) values ('source-pin-src-occ-0151-forged-member', 'value-src-occ-0151-forged-member', $1, $2, $3, $4,
                       $5, $6, $7, 'file-version-src-occ-0151-current', 'dts', $8, $9::jsonb, 'md5:forged-member')`,
            [
              existingPin.binding_id,
              existingPin.definition_id,
              existingPin.organization_id,
              existingPin.project_id,
              existingPin.source_occurrence_id,
              existingPin.config_revision_id,
              existingPin.file_id,
              existingPin.property_occurrence_id,
              JSON.stringify({
                ...(existingPin.locator as Record<string, unknown>),
                fileVersionId: "file-version-src-occ-0151-current"
              })
            ]
          );
        })
      ).rejects.toThrow(/ProjectValue source pin does not prove its exact revision, member and locator|foreign key constraint/);

      await expect(
        db.transaction(async (tx) => {
          await tx.query(
            `insert into parameter_catalog.project_parameter_values (
               id, binding_id, definition_id, definition_revision_id, source_ref,
               config_revision_id, value_digest, value_kind, value
             ) values ('value-src-occ-0151-forged-tenant', $1, $2,
                       (select definition_revision_id from parameter_catalog.project_parameter_values where id = $3),
                       'source:forged-tenant', $4, 'digest-forged-tenant', 'number', '5'::jsonb)`,
            [existingPin.binding_id, existingPin.definition_id, "value-src-occ-0151", existingPin.config_revision_id]
          );
          await tx.query(
            `insert into parameter_catalog.project_value_source_pins (
               id, project_value_id, binding_id, definition_id, organization_id, project_id,
               source_occurrence_id, config_revision_id, file_id, file_version_id, format,
               property_occurrence_id, locator, locator_digest
             ) values ('source-pin-src-occ-0151-forged-tenant', 'value-src-occ-0151-forged-tenant', $1, $2,
                       'foreign-org', 'foreign-project', $3, $4, $5, $6, 'dts', $7, $8::jsonb, 'md5:forged-tenant')`,
            [
              existingPin.binding_id,
              existingPin.definition_id,
              existingPin.source_occurrence_id,
              existingPin.config_revision_id,
              existingPin.file_id,
              existingPin.file_version_id,
              existingPin.property_occurrence_id,
              JSON.stringify(existingPin.locator)
            ]
          );
        })
      ).rejects.toMatchObject({ code: "23503" });

      await expect(
        db.transaction(async (tx) => {
          await tx.query(
            `insert into parameter_catalog.project_parameter_values (
               id, binding_id, definition_id, definition_revision_id, source_ref,
               config_revision_id, value_digest, value_kind, value
             ) values ('value-src-occ-0151-placeholder', $1, $2,
                       (select definition_revision_id from parameter_catalog.project_parameter_values where id = $3),
                       'canonical-binding-identity', $4, 'digest-placeholder', 'number', '3'::jsonb)`,
            [existingPin.binding_id, existingPin.definition_id, "value-src-occ-0151", existingPin.config_revision_id]
          );
          await tx.query(
            `update parameter_catalog.project_parameter_bindings
                set current_value_id = 'value-src-occ-0151-placeholder'
              where id = 'binding-src-occ-0151'`
          );
        })
      ).rejects.toThrow("A current canonical Binding value requires an exact source pin");

      await db.query(
        `insert into public.project_parameter_value_drafts (
           id, organization_id, project_id, binding_id, definition_id,
           definition_revision_id, catalog_release_id, base_current_value_id,
           config_revision_id, source_ref, action, target_value, reason, user_id
         ) values
           ('draft-src-occ-0151-detach', $1, $2, $3, $4, $5, $6, $7, $8,
            'source:draft-detach', 'set', '2'::jsonb, 'draft detach fixture', null),
           ('draft-src-occ-0151-reassign', $1, $2, $3, $4, $5, $6, $7, $8,
            'source:draft-reassign', 'set', '2'::jsonb, 'draft reassign fixture', null),
           ('draft-src-occ-0151-reattach', $1, $2, $3, $4, $5, $6, $7, $8,
            'source:draft-reattach', 'set', '2'::jsonb, 'draft reattach fixture', null)`,
        [
          existingPin.organization_id,
          existingPin.project_id,
          existingPin.binding_id,
          existingPin.definition_id,
          metadata.definition_revision_id,
          metadata.catalog_release_id,
          "value-src-occ-0151",
          existingPin.config_revision_id
        ]
      );
      await db.query(
        `insert into public.project_parameter_value_change_requests (
           id, organization_id, project_id, draft_id, binding_id, definition_id,
           definition_revision_id, catalog_release_id, base_current_value_id,
           config_revision_id, source_ref, action, target_value, reason, status,
           submitter_user_id, source_pin_id
         ) values
           ('request-src-occ-0151-detach', $1, $2, 'draft-src-occ-0151-detach', $3, $4,
            $5, $6, $7, $8, 'source:request-detach', 'set', '2'::jsonb,
            'request detach fixture', 'pending', $9, $10),
           ('request-src-occ-0151-reassign', $1, $2, 'draft-src-occ-0151-reassign', $3, $4,
            $5, $6, $7, $8, 'source:request-reassign', 'set', '2'::jsonb,
            'request reassign fixture', 'pending', $9, $10)`,
        [
          existingPin.organization_id,
          existingPin.project_id,
          existingPin.binding_id,
          existingPin.definition_id,
          metadata.definition_revision_id,
          metadata.catalog_release_id,
          "value-src-occ-0151",
          existingPin.config_revision_id,
          "user-src-occ-0151",
          existingPin.id
        ]
      );
      await db.query(
        `delete from public.project_parameter_value_drafts
          where id = 'draft-src-occ-0151-detach'`
      );
      const detached = await db.query<{ draft_id: string | null }>(
        `select draft_id
           from public.project_parameter_value_change_requests
          where id = 'request-src-occ-0151-detach'`
      );
      expect(detached.rows[0]?.draft_id).toBeNull();
      await expect(
        db.query(
          `update public.project_parameter_value_change_requests
              set draft_id = 'draft-src-occ-0151-reattach'
            where id = 'request-src-occ-0151-detach'`
        )
      ).rejects.toThrow("Submitted source request identity is immutable");
      await expect(
        db.query(
          `update public.project_parameter_value_change_requests
              set draft_id = 'draft-src-occ-0151-reattach'
            where id = 'request-src-occ-0151-reassign'`
        )
      ).rejects.toThrow("Submitted source request identity is immutable");

      const replay = await applyMigrations(db, migrationsDir);
      expect(replay).toEqual([]);
    });
  });

  it("backfills the unique final set/override effect for a DTS property", async () => {
    await withTempDatabase(async (db, connectionString) => {
      await applyMigrations(db, migrationsDir, { through: "0150_product_feedback_v2.sql" });
      await seedPopulatedGraph(db, connectionString);

      const property = await db.query<{ property_name: string }>(
        `select property_name
           from public.dts_property_occurrences
          where id = 'property-occurrence-src-occ-0151'`
      );
      const propertyName = property.rows[0]?.property_name;
      expect(propertyName).toBeTruthy();

      await db.query(
        `insert into public.dts_property_occurrences (
           id, config_revision_id, node_occurrence_id, file_version_id, property_name,
           start_offset, end_offset, start_line, start_column, end_line, end_column, raw_text,
           source_order
         ) values ('property-occurrence-src-occ-0151-final', $1, $2, $3, $4,
                   3, 4, 1, 4, 1, 5, '2', 1)`,
        [
          "config-revision-src-occ-0151",
          "node-occurrence-src-occ-0151",
          "file-version-src-occ-0151-historical",
          propertyName
        ]
      );
      await db.query(
        `insert into public.dts_occurrence_effects (
           id, config_revision_id, logical_node_revision_id, property_name, effect_kind,
           node_occurrence_id, property_occurrence_id, source_order
         ) values ('effect-src-occ-0151-final', $1, $2, $3, 'override', $4, $5, 1)`,
        [
          "config-revision-src-occ-0151",
          "logical-node-revision-src-occ-0151",
          propertyName,
          "node-occurrence-src-occ-0151",
          "property-occurrence-src-occ-0151-final"
        ]
      );

      await applyMigrations(db, migrationsDir);

      const pin = await db.query<{ property_occurrence_id: string }>(
        `select property_occurrence_id
           from parameter_catalog.project_value_source_pins
          where project_value_id = 'value-src-occ-0151'`
      );
      expect(pin.rows).toEqual([
        { property_occurrence_id: "property-occurrence-src-occ-0151-final" }
      ]);
    });
  });

  it("aborts when the final DTS property effect is tied", async () => {
    await withTempDatabase(async (db, connectionString) => {
      await applyMigrations(db, migrationsDir, { through: "0150_product_feedback_v2.sql" });
      await seedPopulatedGraph(db, connectionString);

      const property = await db.query<{ property_name: string }>(
        `select property_name
           from public.dts_property_occurrences
          where id = 'property-occurrence-src-occ-0151'`
      );
      await db.query(
        `insert into public.dts_occurrence_effects (
           id, config_revision_id, logical_node_revision_id, property_name, effect_kind,
           node_occurrence_id, property_occurrence_id, source_order
         ) values ('effect-src-occ-0151-tied', $1, $2, $3, 'override', $4, $5, 0)`,
        [
          "config-revision-src-occ-0151",
          "logical-node-revision-src-occ-0151",
          property.rows[0]?.property_name,
          "node-occurrence-src-occ-0151",
          "property-occurrence-src-occ-0151"
        ]
      );

      await expect(applyMigrations(db, migrationsDir)).rejects.toThrow(
        "0151 DTS property has no unique final effect winner"
      );
      const rollback = await db.query<{ relation: string | null }>(
        `select to_regclass('parameter_catalog.project_parameter_source_occurrences')::text as relation`
      );
      expect(rollback.rows[0]?.relation).toBeNull();
    });
  });

  it("projects the source-occurrence resolver through a completed Definition replacement", async () => {
    await withTempDatabase(async (db, connectionString) => {
      await applyMigrations(db, migrationsDir, { through: "0150_product_feedback_v2.sql" });
      await seedPopulatedGraph(db, connectionString);
      // Replay an existing completed replacement from the pre-correction schema.
      await applyMigrations(db, migrationsDir, { through: "0151_source_occurrence_identity.sql" });

      const oldDefinition = await db.query<{
        definition_id: string;
        revision_id: string;
        subject_id: string;
        release_id: string;
        property_key: string;
      }>(
        `select binding.definition_id, binding.effective_revision_id as revision_id,
                binding.subject_id, binding.catalog_release_id as release_id,
                definition.property_key
           from parameter_catalog.project_parameter_bindings binding
           join parameter_catalog.parameter_definitions definition
             on definition.id = binding.definition_id
          where binding.id = 'binding-src-occ-0151'`
      );
      const old = oldDefinition.rows[0]!;
      const newRelease = "release-src-occ-0151-replacement";
      const newReleaseDigest = `sha256:${"f".repeat(64)}`;
      const newDefinition = "definition-src-occ-0151-replacement";
      const newRevision = "revision-src-occ-0151-replacement";
      const newPropertyName = "iin_min";
      const newSubject = old.subject_id;
      const newBinding = "binding-src-occ-0151-replacement";
      const newValue = "value-src-occ-0151-replacement";
      const newPin = "source-pin-src-occ-0151-replacement";
      const newProperty = "property-occurrence-src-occ-0151-replacement";
      const newEffect = "effect-src-occ-0151-replacement";
      const artifactDigest = `sha256:${"a".repeat(64)}`;
      const baseDigest = `sha256:${"b".repeat(64)}`;
      const impactDigest = `sha256:${"c".repeat(64)}`;
      const locator = {
        kind: "dts-property",
        propertyOccurrenceId: newProperty,
        nodeOccurrenceId: "node-occurrence-src-occ-0151",
        fileVersionId: "file-version-src-occ-0151-historical",
        propertyName: newPropertyName
      };

      await db.transaction(async (tx) => {
        await tx.query("set constraints all deferred");
        await tx.query(
          `insert into parameter_catalog.catalog_releases (
             id, release_sequence, release_version, release_digest,
             predecessor_release_id, compiled_model_digest, toolchain_digest, published_at
           ) values ($1, (select release_sequence + 1 from parameter_catalog.catalog_releases where id = $2),
                    'source-occurrence-replacement', $3, $2, $4, $5, now())`,
          [newRelease, old.release_id, newReleaseDigest, `${newReleaseDigest}-model`, `${newReleaseDigest}-toolchain`]
        );
        await tx.query(
          `insert into parameter_catalog.catalog_release_subjects (
             release_id, subject_id, lifecycle, selector_snapshot, selector_provenance
           ) select $1, subject_id, lifecycle, selector_snapshot, selector_provenance
               from parameter_catalog.catalog_release_subjects
              where release_id = $2`,
          [newRelease, old.release_id]
        );
        await tx.query(
          `insert into parameter_catalog.catalog_release_definition_heads (
             release_id, definition_id, revision_id
           ) select $1, definition_id, revision_id
               from parameter_catalog.catalog_release_definition_heads
              where release_id = $2`,
          [newRelease, old.release_id]
        );
        await tx.query(
          `insert into parameter_catalog.catalog_release_subject_aliases (
             release_id, subject_id, alias_id, lifecycle, selector_provenance
           ) select $1, subject_id, alias_id, lifecycle, selector_provenance
               from parameter_catalog.catalog_release_subject_aliases
              where release_id = $2`,
          [newRelease, old.release_id]
        );
        await tx.query(
          `insert into parameter_catalog.parameter_definitions (
             id, introduced_release_id, subject_id, property_key, current_revision_id
           ) values ($1, $2, $3, $4, $5)`,
          [newDefinition, newRelease, newSubject, newPropertyName, newRevision]
        );
        await tx.query(
          `insert into parameter_catalog.definition_revisions (
             id, definition_id, revision_number, catalog_release_id, content_digest, content
           ) values ($1, $2, 1, $3, 'sha256:replacement-revision', '{}'::jsonb)`,
          [newRevision, newDefinition, newRelease]
        );
        await tx.query(
          `insert into parameter_catalog.catalog_release_definition_heads (
             release_id, definition_id, revision_id
           ) values ($1, $2, $3)`,
          [newRelease, newDefinition, newRevision]
        );
        await tx.query(
          `insert into parameter_catalog.catalog_materializations (
             release_id, compiled_fingerprint, database_fingerprint, attempt_id, success_audit_ref
           ) values ($1, $2, $3, 'source-occurrence-replacement', 'source-occurrence-replacement')`,
          [newRelease, `${newReleaseDigest}-compiled`, `${newReleaseDigest}-database`]
        );
        await tx.query(
          `insert into public.dts_property_occurrences (
             id, config_revision_id, node_occurrence_id, file_version_id, property_name,
             start_offset, end_offset, start_line, start_column, end_line, end_column, raw_text
           ) values ($1, 'config-revision-src-occ-0151',
                    'node-occurrence-src-occ-0151', 'file-version-src-occ-0151-historical',
                    $2, 3, 4, 1, 4, 1, 5, '1')`,
          [newProperty, newPropertyName]
        );
        await tx.query(
          `insert into public.dts_occurrence_effects (
             id, config_revision_id, logical_node_revision_id, property_occurrence_id,
             node_occurrence_id, property_name, effect_kind, source_order
           ) values ($1, 'config-revision-src-occ-0151',
                    'logical-node-revision-src-occ-0151', $2,
                    'node-occurrence-src-occ-0151', $3, 'set', 0)`,
          [newEffect, newProperty, newPropertyName]
        );
        await tx.query(
          `insert into parameter_catalog.project_parameter_bindings (
             id, organization_id, catalog_release_id, project_id, logical_node_id,
             registration_id, subject_id, definition_id, effective_revision_id,
             current_value_id, source_occurrence_id
           ) values ($1, 'org-src-occ-0151', $2, 'project-src-occ-0151',
                    'logical-node-src-occ-0151', 'registration-src-occ-0151', $3, $4, $5, $6,
                    (select source_occurrence_id
                       from parameter_catalog.project_parameter_bindings
                      where id = 'binding-src-occ-0151'))`,
          [newBinding, newRelease, newSubject, newDefinition, newRevision, newValue]
        );
        await tx.query(
          `insert into parameter_catalog.project_parameter_values (
             id, binding_id, definition_id, definition_revision_id, source_ref,
             config_revision_id, value_digest, value_kind, value
           ) values ($1, $2, $3, $4, 'source.dts!/fixture',
                     'config-revision-src-occ-0151', 'digest-replacement', 'number', '1'::jsonb)`,
          [newValue, newBinding, newDefinition, newRevision]
        );
        await tx.query(
          `insert into parameter_catalog.project_value_source_pins (
             id, project_value_id, binding_id, definition_id, organization_id, project_id,
             source_occurrence_id, config_revision_id, file_id, file_version_id, format,
             property_occurrence_id, locator, locator_digest
           ) values ($1, $2, $3, $4, 'org-src-occ-0151', 'project-src-occ-0151',
                    (select source_occurrence_id from parameter_catalog.project_parameter_bindings
                      where id = 'binding-src-occ-0151'),
                    'config-revision-src-occ-0151', 'file-src-occ-0151',
                    'file-version-src-occ-0151-historical', 'dts', $5, $6::jsonb,
                    'sha256:replacement-pin')`,
          [newPin, newValue, newBinding, newDefinition, newProperty, JSON.stringify(locator)]
        );
        await tx.query(
          `insert into catalog_publication.release_artifacts (
             id, artifact_digest, bytes_checksum, artifact_bytes, source_kind,
             target_release_id, target_release_digest, toolchain
           ) values ('cart_src_occ_0151', $1, $1, '\\x01'::bytea, 'adopted-preexisting',
                     $2, $3, '{}'::jsonb)`,
          [artifactDigest, old.release_id, baseDigest]
        );
        await tx.query(
          `insert into catalog_publication.candidates (
             id, artifact_id, artifact_digest, expected_base_release_id,
             expected_base_release_digest, identity_allocation, impact_report_digest,
             capability_contract
           ) values ('ccand_src_occ_0151', 'cart_src_occ_0151', $1, $2, $3,
                     '{}'::jsonb, $4, '{}'::jsonb)`,
          [artifactDigest, old.release_id, baseDigest, impactDigest]
        );
        await tx.query(
          `insert into catalog_publication.publication_authorizations (
             id, event_kind, candidate_id, artifact_digest, expected_base_release_id,
             expected_base_release_digest, impact_report_digest, capability_contract_digest,
             policy_revision, actor_principal_id
           ) values ('cauth_src_occ_0151', 'approve', 'ccand_src_occ_0151', $1, $2, $3, $4,
                     catalog_publication.digest_jsonb('{}'::jsonb), 1,
                     'user-src-occ-0151')`,
          [artifactDigest, old.release_id, baseDigest, impactDigest]
        );
        await tx.query(
          `insert into catalog_publication.publication_jobs (
             id, candidate_id, authorization_id, request_scope, idempotency_key,
             request_digest, status
           ) values ('cjob_src_occ_0151', 'ccand_src_occ_0151', 'cauth_src_occ_0151',
                     'definition-replacement', 'src-occ-0151', $1, 'queued')`,
          [artifactDigest]
        );
        await tx.query(
          `insert into parameter_catalog.definition_replacement_previews (
             id, organization_id, old_definition_id, old_subject_id, old_property_key,
             old_revision_id, new_definition_id, new_subject_id, new_property_key,
             new_revision_id, preview_fingerprint, preview_catalog_release_id,
             preview_catalog_release_digest, candidate_id, artifact_digest, blockers,
             manifest, impact, approval_principal_id, reason, expires_at
           ) values ('drpv_src_occ_0151', 'org-src-occ-0151', $1, $2, 'iin_max', $3,
                     $4, $10, $9, $5, $6, $7, $8, 'ccand_src_occ_0151', $11,
                     '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, 'user-src-occ-0151',
                     'resolver fixture', now() + interval '1 day')`,
          [old.definition_id, old.subject_id, old.revision_id, newDefinition, newRevision,
            `sha256:${"e".repeat(64)}`, old.release_id, baseDigest, newPropertyName, newSubject,
            artifactDigest]
        );
        await tx.query(
          `insert into parameter_catalog.definition_replacements (
             id, organization_id, status, replacement_version, old_definition_id,
             old_subject_id, old_property_key, old_revision_id, new_definition_id,
             new_subject_id, new_property_key, new_revision_id, preview_fingerprint,
             preview_catalog_release_id, preview_catalog_release_digest, source_preview_id,
             frozen_manifest, candidate_id, publication_job_id, authorization_id,
             approval_principal_id, reason
           ) values ('drep_src_occ_0151', 'org-src-occ-0151', 'completed', 1, $1, $2,
                     'iin_max', $3, $4, $5, $6, $7, $8, $9, $10,
                     'drpv_src_occ_0151', '[]'::jsonb, 'ccand_src_occ_0151',
                     'cjob_src_occ_0151', 'cauth_src_occ_0151', 'user-src-occ-0151',
                     'resolver fixture')`,
          [old.definition_id, old.subject_id, old.revision_id, newDefinition, newSubject, newPropertyName,
            newRevision, `sha256:${"e".repeat(64)}`, old.release_id, baseDigest]
        );
        await tx.query(
          `insert into parameter_catalog.definition_replacement_projects (
             id, replacement_id, organization_id, project_id, status,
             old_binding_id, old_value_id, new_binding_id, new_value_id,
             old_definition_id, new_definition_id
           ) values ('drepp_src_occ_0151', 'drep_src_occ_0151', 'org-src-occ-0151',
                     'project-src-occ-0151', 'completed', 'binding-src-occ-0151',
                     'value-src-occ-0151', $1, $2, $3, $4)`,
          [newBinding, newValue, old.definition_id, newDefinition]
        );
        await tx.query("set constraints all immediate");
      });

      await applyMigrations(db, migrationsDir);
      const resolved = await db.query<{ logical_id: string; occurrence_id: string }>(
        `select parameter_catalog.resolve_current_binding(
                  'project-src-occ-0151', 'logical-node-src-occ-0151', $1
                ) as logical_id,
                parameter_catalog.resolve_current_binding_by_source_occurrence(
                  'project-src-occ-0151',
                  (select source_occurrence_id from parameter_catalog.project_parameter_bindings
                    where id = 'binding-src-occ-0151'),
                  $1
                ) as occurrence_id`,
        [old.definition_id]
      );
      expect(resolved.rows).toEqual([
        { logical_id: newBinding, occurrence_id: newBinding }
      ]);
      const occurrenceResolverDefinition = await db.query<{ definition: string }>(
        `select pg_get_functiondef(
           'parameter_catalog.resolve_current_binding_by_source_occurrence(text,text,text)'::regprocedure
         ) as definition`
      );
      expect(occurrenceResolverDefinition.rows[0]?.definition).not.toMatch(/limit\s+1/i);
    });
  });

  it("aborts when a later DTS delete supersedes the active property", async () => {
    await withTempDatabase(async (db, connectionString) => {
      await applyMigrations(db, migrationsDir, { through: "0150_product_feedback_v2.sql" });
      await seedPopulatedGraph(db, connectionString);

      const property = await db.query<{ property_name: string }>(
        `select property_name
           from public.dts_property_occurrences
          where id = 'property-occurrence-src-occ-0151'`
      );
      await db.query(
        `insert into public.dts_occurrence_effects (
           id, config_revision_id, logical_node_revision_id, property_name, effect_kind,
           node_occurrence_id, source_order
         ) values ('effect-src-occ-0151-delete', $1, $2, $3, 'delete', $4, 1)`,
        [
          "config-revision-src-occ-0151",
          "logical-node-revision-src-occ-0151",
          property.rows[0]?.property_name,
          "node-occurrence-src-occ-0151"
        ]
      );

      await expect(applyMigrations(db, migrationsDir)).rejects.toThrow(
        "0151 source occurrence backfill cannot prove every Binding root"
      );
      const rollback = await db.query<{ relation: string | null }>(
        `select to_regclass('parameter_catalog.project_parameter_source_occurrences')::text as relation`
      );
      expect(rollback.rows[0]?.relation).toBeNull();
    });
  });

  it("normalizes only safe relative revision-member aliases", async () => {
    await withTempDatabase(async (db) => {
      await applyMigrations(db, migrationsDir);

      const normalized = await db.query<{ source_name: string }>(
        `select parameter_catalog.normalize_dts_source_name($1) as source_name`,
        [" ./nested//source.dts "]
      );
      expect(normalized.rows[0]?.source_name).toBe("nested/source.dts");

      for (const unsafe of ["", ".", "./", "/absolute.dts", "../escape.dts", "nested/../", "nested\nsource.dts"]) {
        await expect(
          db.query(`select parameter_catalog.normalize_dts_source_name($1)`, [unsafe])
        ).rejects.toThrow("DTS revision member source_name");
      }
    });
  });

  it("does not infer a pinned alias from a renamed current file", async () => {
    await withTempDatabase(async (db, connectionString) => {
      await applyMigrations(db, migrationsDir, { through: "0150_product_feedback_v2.sql" });
      await seedPopulatedGraph(db, connectionString, "config-set:opaque-history");
      await db.query(
        `update public.project_parameter_files
            set file_name = 'renamed-current.dts'
          where id = 'file-src-occ-0151'`
      );
      await expect(applyMigrations(db, migrationsDir)).rejects.toThrow(
        "0151 pinned DTS revision member alias is unprovable or conflicting"
      );
      const rollback = await db.query<{ relation: string | null }>(
        `select to_regclass('parameter_catalog.project_parameter_source_occurrences')::text as relation`
      );
      expect(rollback.rows[0]?.relation).toBeNull();
      const renamed = await db.query<{ file_name: string }>(
        `select file_name from public.project_parameter_files where id = 'file-src-occ-0151'`
      );
      expect(renamed.rows[0]?.file_name).toBe("renamed-current.dts");
    });
  });

  it("aborts the complete upgrade when an existing Binding root is unprovable", async () => {
    await withTempDatabase(async (db, connectionString) => {
      await applyMigrations(db, migrationsDir, { through: "0150_product_feedback_v2.sql" });
      await seedPopulatedGraph(db, connectionString);
      await db.query(`delete from public.dts_occurrence_effects where id = 'effect-src-occ-0151'`);

      await expect(applyMigrations(db, migrationsDir)).rejects.toThrow(
        "0151 source occurrence backfill cannot prove every Binding root"
      );
      const rollback = await db.query<{ relation: string | null }>(
        `select to_regclass('parameter_catalog.project_parameter_source_occurrences')::text as relation`
      );
      expect(rollback.rows[0]?.relation).toBeNull();
      const sourceColumn = await db.query<{ present: boolean }>(
        `select exists (
           select 1 from information_schema.columns
            where table_schema = 'parameter_catalog'
              and table_name = 'project_parameter_bindings'
              and column_name = 'source_occurrence_id'
         ) as present`
      );
      expect(sourceColumn.rows[0]?.present).toBe(false);
    });
  });

  it("aborts the complete upgrade when an existing observation has no exact locator digest", async () => {
    await withTempDatabase(async (db, connectionString) => {
      await applyMigrations(db, migrationsDir, { through: "0150_product_feedback_v2.sql" });
      await seedPopulatedGraph(db, connectionString);
      await db.query(
        `insert into parameter_catalog.parameter_observations (
           id, organization_id, project_id, logical_node_id, config_revision_id,
           source_identity, source_locator, catalog_release_id, matcher_revision,
           evidence_fingerprint
         ) values ('observation-src-occ-0151', 'org-src-occ-0151', 'project-src-occ-0151',
                   'logical-node-src-occ-0151', 'config-revision-src-occ-0151',
                   'legacy-observation-src-occ-0151', '{"path":"/soc/charger","property":"iin_max"}'::jsonb,
                   (select catalog_release_id from parameter_catalog.project_parameter_bindings
                     where id = 'binding-src-occ-0151'),
                   'legacy-matcher-src-occ-0151', 'legacy-evidence-src-occ-0151')`
      );

      await expect(applyMigrations(db, migrationsDir)).rejects.toThrow(
        "0151 source occurrence backfill cannot prove every observation locator"
      );
      const rollback = await db.query<{ relation: string | null }>(
        `select to_regclass('parameter_catalog.project_parameter_source_occurrences')::text as relation`
      );
      expect(rollback.rows[0]?.relation).toBeNull();
      const sourceColumn = await db.query<{ present: boolean }>(
        `select exists (
           select 1 from information_schema.columns
            where table_schema = 'parameter_catalog'
              and table_name = 'parameter_observations'
              and column_name = 'source_occurrence_id'
         ) as present`
      );
      expect(sourceColumn.rows[0]?.present).toBe(false);
    });
  });
});
