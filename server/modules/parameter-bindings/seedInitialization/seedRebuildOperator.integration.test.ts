import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createEphemeralTestDatabase, type EphemeralTestDatabase } from "../../../testing/testDatabase";
import { createPostgresDatabase, getRootPostgresPool, type RootDatabase } from "../../../shared/database/client";
import { requirePgvectorTestDatabase } from "../../catalog-publication/persistence/integrationHarness";
import { bootstrapFirstAcme } from "../../catalog-kernel/install/publicationTestHarness";
import { adoptPreexistingCatalog } from "../../catalog-publication/runtime/adoption";
import { enablePublicationPolicy } from "../../catalog-publication/authorization/testHarness";
import { createLocalObjectStore } from "../../logs/objectStore";
import { addConfigSetFile, ensureDefaultConfigSet } from "../../parameter-files/configSetService";
import { uploadProjectParameterFile } from "../../parameter-files/service";
import { insertConfigRevision, insertConfigRevisionMembers } from "../../parameter-topology/repository";
import { getParameterSpecRow, upsertMatchedDriverSchema, upsertMatchedPropertySpec } from "../../parameter-specs/repository";
import { getCachedSchemaRegistry } from "../../parameter-specs/schemaRegistryCache";
import { planSeedRebuild, checkSeedRebuildState, rebuildSeedProjects, verifySeedRebuild, assertSeedPublicationIdle,
  captureSeedMaintenanceBaseline, verifySeedMaintenanceBaseline, type SeedRebuildState } from "../../../../scripts/lib/seedRebuild";
import { verifySeedPreservation } from "../../../../scripts/lib/seedRebuildPreservation";
import { prepareSeedCatalog, publishSeedCatalog, getSeedCatalogPublicationStatus } from "../../../../scripts/lib/seedCatalogPublication";
import { collectPublicationPolicyInstanceSnapshot } from "../../catalog-publication/authorization/instanceSnapshot";
import { runPublicationManagerOnce } from "../../catalog-publication/jobs/manager";
import { createCatalogInstaller } from "../../catalog-kernel/install/installer";
import { getAuthContext } from "../../auth/repository";
import { createUserInvocation } from "../../auth/trustedInvocation";
import { provisionPublicationRuntimeLogins, dropLabRuntimeLogins } from "../../catalog-publication/runtime/provisionRuntimeLogins";
import { parseSeedRebuildState } from "../../../../scripts/lib/seedRebuildJournal";
import { runSeedRebuildCli, frozenPreparation } from "../../../../scripts/seed-rebuild";
import { curateReviewedSeedPlacementCapacity } from "./placementCapacity";

await requirePgvectorTestDatabase();

describe("reviewed example rebuild preflight on an adopted populated instance", () => {
  let database: EphemeralTestDatabase;
  let db: RootDatabase;
  let client: pg.Client;
  let directory: string;
  let store: ReturnType<typeof createLocalObjectStore>;
  let plan: SeedRebuildState;
  let manager: RootDatabase;
  let sharedObjectKey: string;
  let oldAuroraFileId: string;
  let oldAuroraFileVersionId: string;
  let oldAuroraConfigSetId: string;
  let oldAuroraRevisionMemberId: string;
  const loginToken = `seed${randomBytes(6).toString("hex")}`;
  const org = "org-rebuild";
  const input = { runId: "rebuild-test", organizationId: org, actorUserId: "rebuild-author", candidateSha: "a".repeat(40) };
  const oldAuroraSource = "/dts-v1/; / { old-aurora-property = <41>; };";
  const oldAtlasBoardSource = "/dts-v1/; / { old-atlas-property = <42>; };";
  const oldNebulaSource = "/dts-v1/; / { old-nebula-property = <43>; };";
  const ctx = () => ({ db, store, repoRoot: process.cwd() });
  type LegacyOverlapSnapshot = {
    parameterSpec: Record<string, unknown>;
    parameterSpecVersion: Record<string, unknown>;
    dtsPropertySpec: Record<string, unknown>;
    driverSchemaVersion: Record<string, unknown>;
  };
  let legacyOverlapSnapshot!: LegacyOverlapSnapshot;

  beforeAll(async () => {
    database = await createEphemeralTestDatabase("seedoperator");
    db = createPostgresDatabase(database.url);
    client = new pg.Client({ connectionString: database.url });
    await client.connect();
    directory = await mkdtemp(path.join(tmpdir(), "wiseeff-seed-operator-"));
    store = createLocalObjectStore(directory);
    await db.query("insert into organizations (id,name) values ($1,'Rebuild fixture')", [org]);
    await db.query(`insert into users (id,organization_id,name,title,is_active) values
      ('rebuild-author',$1,'Author','Editor',true),('rebuild-guest',$1,'Guest','Guest',true),
      ('rebuild-reviewer',$1,'Reviewer','Reviewer',true)`, [org]);
    await db.query(`insert into user_role_bindings (id,user_id,organization_id,project_id,role_id)
      values ('rebuild-role','rebuild-author',$1,null,'admin')`, [org]);
    await db.query(`insert into roles (id,name,level,permissions) values
      ('catalog-capability-rebuild-author','Fixture author','user',ARRAY['catalog:author','parameter:view']),
      ('catalog-capability-rebuild-reviewer','Fixture reviewer','user',ARRAY['catalog:publish','catalog:review-high-risk','parameter:view'])`);
    await db.query(`insert into user_role_bindings (id,user_id,organization_id,project_id,role_id)
      values ('rebuild-capability','rebuild-author',$1,null,'catalog-capability-rebuild-author'),
      ('rebuild-review-capability','rebuild-reviewer',$1,null,'catalog-capability-rebuild-reviewer')`, [org]);
    await db.query(`insert into projects (id,organization_id,name,code,status) values
      ('atlas',$1,'Atlas','ATL-Intl','initialized'),('aurora',$1,'Aurora','AUR-Prod','initialized'),
      ('nebula',$1,'Nebula','NEB-RD','initialized'),('custom-preserved',$1,'Custom','CUSTOM','initialized')`, [org]);

    const author = await getAuthContext(db, input.actorUserId);
    const atlasDefault = await ensureDefaultConfigSet(db, author, "atlas");
    const oldAtlasBoard = await uploadProjectParameterFile(db, store, author, {
      projectId: "atlas",
      fileName: "board.dts",
      bytes: Buffer.from(oldAtlasBoardSource, "utf8"),
    });
    await addConfigSetFile(db, author, {
      configSetId: atlasDefault.id,
      fileId: oldAtlasBoard.file.id,
      role: "overlay",
      sortOrder: 7,
    });
    await insertConfigRevision(db, {
      id: "atlas-existing-revision",
      organizationId: org,
      projectId: "atlas",
      configSetId: atlasDefault.id,
      revisionNumber: 1,
      status: "resolved",
      createdByUserId: input.actorUserId,
      entryFile: "board.dts",
      includeSearchPaths: ["."],
      overlayOrder: [],
    });
    await insertConfigRevisionMembers(db, "atlas-existing-revision", [{
      fileId: oldAtlasBoard.file.id,
      fileVersionId: oldAtlasBoard.version.id,
      fileName: "board.dts",
      sourceName: "board.dts",
      role: "overlay",
      sortOrder: 7,
      content: oldAtlasBoardSource,
      format: "dts",
    }]);

    const auroraDefault = await ensureDefaultConfigSet(db, author, "aurora");
    oldAuroraConfigSetId = auroraDefault.id;
    const oldAurora = await uploadProjectParameterFile(db, store, author, {
      projectId: "aurora",
      fileName: "aurora-board.dts",
      bytes: Buffer.from(oldAuroraSource, "utf8"),
    });
    oldAuroraFileId = oldAurora.file.id;
    oldAuroraFileVersionId = oldAurora.version.id;
    await addConfigSetFile(db, author, {
      configSetId: auroraDefault.id,
      fileId: oldAurora.file.id,
      role: "base",
      sortOrder: 0,
    });
    await insertConfigRevision(db, {
      id: "aurora-existing-revision",
      organizationId: org,
      projectId: "aurora",
      configSetId: auroraDefault.id,
      revisionNumber: 1,
      status: "resolved",
      createdByUserId: input.actorUserId,
      entryFile: "aurora-board.dts",
      includeSearchPaths: ["."],
      overlayOrder: [],
    });
    await insertConfigRevisionMembers(db, "aurora-existing-revision", [{
      fileId: oldAurora.file.id,
      fileVersionId: oldAurora.version.id,
      fileName: "aurora-board.dts",
      sourceName: "aurora-board.dts",
      role: "base",
      sortOrder: 0,
      content: oldAuroraSource,
      format: "dts",
    }]);
    oldAuroraRevisionMemberId = (await db.query<{ id: string }>(
      "select id from dts_config_revision_members where config_revision_id='aurora-existing-revision'",
    )).rows[0]!.id;

    const nebulaDefault = await ensureDefaultConfigSet(db, author, "nebula");
    const oldNebula = await uploadProjectParameterFile(db, store, author, {
      projectId: "nebula",
      fileName: "board.dts",
      bytes: Buffer.from(oldNebulaSource, "utf8"),
    });
    await addConfigSetFile(db, author, {
      configSetId: nebulaDefault.id,
      fileId: oldNebula.file.id,
      role: "base",
      sortOrder: 0,
    });

    await db.query(`insert into dts_config_set (id,organization_id,project_id,name)
      values ('old-atlas-config',$1,'atlas','Previous parameters'),('custom-config',$1,'custom-preserved','Keep')`, [org]);
    await db.query(`insert into parameter_drafts (id,organization_id,project_id,target_value,reason)
      values ('old-draft-atlas',$1,'atlas','1000','Archived sample'),('custom-draft',$1,'custom-preserved','500','Keep')`, [org]);
    await db.query(`insert into debug_nodes (id,organization_id,name,description)
      values ('kept-device-node',$1,'Hand configured node','Keep settings')`, [org]);
    await db.query(`insert into attribution_subjects (id,organization_id,subject_kind,display_name,source_key)
      values ('kept-node-type',$1,'node-type-definition','Keep node type','nodetype:keep')`, [org]);
    await db.query(`insert into node_type_definitions (attribution_subject_id,bare_node_name)
      values ('kept-node-type','keep')`);
    const object = await store.put({ organizationId: org, fileName: "board.dts", contentType: "text/plain",
      bytes: Buffer.from('/dts-v1/; / { old-property = <42>; };') });
    sharedObjectKey = object.storageKey;
    await db.query(`insert into project_parameter_files (id,organization_id,project_id,file_name,format)
      values ('old-atlas-file',$1,'atlas','legacy-board.dts','dts')`, [org]);
    await db.query(`insert into project_parameter_file_versions
      (id,file_id,version_number,storage_key,checksum,size_bytes,origin)
      values ('old-atlas-version','old-atlas-file',1,$1,$2,$3,'upload')`,
      [object.storageKey, object.checksumSha256, object.fileSizeBytes]);
    await db.query("update project_parameter_files set current_version_id='old-atlas-version' where id='old-atlas-file'");
    await db.query(`insert into log_file_objects
      (id,organization_id,storage_key,file_name,content_type,file_size_bytes,checksum_sha256)
      values ('kept-shared-log',$1,$2,'keep.log','text/plain',$3,$4)`,
      [org, object.storageKey, object.fileSizeBytes, object.checksumSha256]);
    const predecessor = await bootstrapFirstAcme(getRootPostgresPool(db)!);
    const fingerprint = await db.query<{ compiled_fingerprint: string }>(
      "select compiled_fingerprint from parameter_catalog.catalog_materializations where release_id=$1", [predecessor.compiled.release.id]);
    const adopted = await adoptPreexistingCatalog(getRootPostgresPool(db)!, {
      expectedCurrent: { id: predecessor.compiled.release.id, digest: predecessor.digest },
      actorPrincipalId: input.actorUserId, sourceBytes: predecessor.bytes, artifactDigest: predecessor.digest,
      evidenceKind: "synthetic-fixture", adoptionEvidence: { source_bundle_digest: predecessor.digest,
        verification_digest: fingerprint.rows[0]!.compiled_fingerprint, data_mode: "populated",
        collected_at: "2026-09-21T00:00:00Z", approved_by: input.actorUserId },
    });
    expect(adopted.ok).toBe(true);
    await enablePublicationPolicy(client, { publicationEnabled: true, lowRiskSingleActorPublish: false });

    // The adopted instance can already contain legacy DTS definitions before the
    // rebuild plan is captured. Keep one real vendor property in that state so
    // materialization proves preservation against overlapping public spec rows.
    const registry = getCachedSchemaRegistry(path.join(process.cwd(), "schemas/dts"));
    const legacyProperty = registry.properties.find(
      (property) => property.schemaNamespace === "vendor/huawei,charging_core" && property.propertyKey === "iin_max",
    );
    const legacyDriver = legacyProperty?.driverSchemaId
      ? registry.drivers.find((driver) => driver.id === legacyProperty.driverSchemaId)
      : undefined;
    if (!legacyProperty || !legacyDriver) throw new Error("seed-rebuild-legacy-overlap-fixture-missing");
    await db.transaction(async (tx) => {
      const persistedDriver = await upsertMatchedDriverSchema(tx, legacyDriver);
      const persisted = await upsertMatchedPropertySpec(tx, legacyProperty);
      await tx.query(
        `update parameter_specs
            set attribution_subject_id=null,
                property_key=null,
                definition_lifecycle='draft'
          where id=$1`,
        [persisted.parameterSpecId],
      );
      await tx.query(
        `update parameter_spec_versions
            set description='legacy source definition',
                lifecycle='draft',
                version_status='draft'
          where id=$1`,
        [persisted.parameterSpecVersionId],
      );
      await tx.query(
        `update dts_property_specs
            set documentation='legacy documentation'
          where parameter_spec_id=$1`,
        [persisted.parameterSpecId],
      );
      const parameterSpec = await tx.query(
        `select id, attribution_subject_id, property_key, definition_lifecycle
           from parameter_specs
          where id=$1`,
        [persisted.parameterSpecId],
      );
      const parameterSpecVersion = await tx.query(
        `select id, parameter_spec_id, version, description, lifecycle, version_status
           from parameter_spec_versions
          where id=$1`,
        [persisted.parameterSpecVersionId],
      );
      const dtsPropertySpec = await tx.query(
        `select id, parameter_spec_id, driver_schema_id, property_key, schema_namespace, documentation
           from dts_property_specs
          where parameter_spec_id=$1`,
        [persisted.parameterSpecId],
      );
      const driverSchemaVersion = await tx.query(
        `select id, driver_schema_id, parameter_spec_version_id, version
           from driver_schema_versions
          where id=$1`,
        [persistedDriver.driverSchemaVersionId],
      );
      if (!parameterSpec.rows[0] || !parameterSpecVersion.rows[0] || !dtsPropertySpec.rows[0] || !driverSchemaVersion.rows[0]) {
        throw new Error("seed-rebuild-legacy-overlap-snapshot-missing");
      }
      legacyOverlapSnapshot = {
        parameterSpec: parameterSpec.rows[0],
        parameterSpecVersion: parameterSpecVersion.rows[0],
        dtsPropertySpec: dtsPropertySpec.rows[0],
        driverSchemaVersion: driverSchemaVersion.rows[0],
      };
    });
    const logins = await provisionPublicationRuntimeLogins(database.url, { mode: "lab", runToken: loginToken });
    manager = createPostgresDatabase(logins.managerUrl);
  }, 60_000);

  afterAll(async () => {
    await manager?.close(); await client?.end(); await db?.close();
    if (database) expect((await dropLabRuntimeLogins(database.url, loginToken)).failed).toEqual([]);
    await database?.drop();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("reads existing driver continuity without writes and rejects missing or foreign versions", async () => {
    const registry = getCachedSchemaRegistry(path.join(process.cwd(), "schemas/dts"));
    const driver = registry.drivers.find((row) => row.id === legacyOverlapSnapshot.driverSchemaVersion.id)!;
    expect(driver).toBeDefined();
    const lookup = (candidate: typeof driver, organizationId = org) => getParameterSpecRow(client, {
      organizationId, specId: `pspec:driver:${candidate.schemaNamespace}`, driverSchemaVersionId: candidate.id,
    });
    await client.query("begin read only");
    try {
      expect(await lookup(driver)).toEqual({ driverSchemaVersionId: driver.id });
      expect(await lookup({ ...driver, id: "missing-driver-version" })).toEqual({ driverSchemaVersionId: null });
    } finally {
      await client.query("rollback");
    }
    await client.query("begin");
    try {
      const ownedDriver = { ...driver, id: "owned-continuity:v1", source: "manual" as const,
        schemaNamespace: `org/${org}/wiseeff,owned-continuity`, compatible: "wiseeff,owned-continuity",
        compatiblePatterns: ["wiseeff,owned-continuity"] };
      await upsertMatchedDriverSchema(client, ownedDriver);
      await upsertMatchedDriverSchema(client, { ...ownedDriver, id: "owned-continuity:v2", version: 2 });
      expect(await lookup(ownedDriver)).toEqual({ driverSchemaVersionId: ownedDriver.id });
      expect(await lookup(ownedDriver, "foreign-org")).toBeNull();
      expect(await lookup({ ...driver, id: ownedDriver.id })).toEqual({ driverSchemaVersionId: null });
      // Migration 0125 preserves historical dirty owners. Construct that state
      // only in this rollback fixture, then restore guards before the read.
      await client.query("insert into organizations (id,name) values ('foreign-org','Foreign fixture')");
      await client.query("set local session_replication_role = 'replica'");
      try {
        await client.query(`update driver_schemas set organization_id='foreign-org'
          where parameter_spec_id=$1`, [`pspec:driver:${ownedDriver.schemaNamespace}`]);
      } finally {
        await client.query("set local session_replication_role = 'origin'");
      }
      expect(await lookup(ownedDriver)).toEqual({ driverSchemaVersionId: null });
    } finally {
      await client.query("rollback");
    }
  });

  it("plans without writing and binds the real persisted actor and all reviewed identities", async () => {
    const before = await db.query("select count(*)::int as n from project_parameter_plane_archives");
    plan = await planSeedRebuild(ctx(), input);
    expect(parseSeedRebuildState(plan)).toEqual(plan);
    expect(plan.expectedIdentities).toHaveLength(372);
    expect(plan.plan.targets).toEqual(["atlas", "aurora", "nebula"]);
    expect(plan.baseline.tables.find((row) => row.relation === "public.projects")?.count).toBe(4);
    expect((await db.query("select count(*)::int as n from project_parameter_plane_archives")).rows).toEqual(before.rows);
    await expect(checkSeedRebuildState(ctx(), plan, plan.plan.digest, input.candidateSha)).resolves.toBeDefined();
    await db.query(`insert into auth_sessions (id,user_id,organization_id,token_hash,expires_at,last_used_at)
      values ('seed-baseline-session','rebuild-author',$1,'seed-baseline-token','2030-01-01T00:00:00Z','2026-09-21T01:00:00Z')`, [org]);
    await db.query(`insert into device_bridges
      (id,organization_id,user_id,machine_label,platform,arch,client_version,last_seen_at)
      values ('seed-baseline-bridge',$1,'rebuild-author','fixture','linux','x86_64','1.0','2026-09-21T01:00:00Z')`, [org]);
    await expect(verifySeedPreservation(db, store, org, plan.baseline)).rejects.toThrow(/auth_sessions|device_bridges/);
    await db.query("select catalog_publication.set_publication_freeze(true, 'seed-baseline-test')");
    plan.maintenanceBaseline = await captureSeedMaintenanceBaseline(ctx(), plan, `sha256:${"b".repeat(64)}`);
    expect(plan.maintenanceBaseline.manifestDigest).toBe(`sha256:${"b".repeat(64)}`);
    await db.query("select catalog_publication.set_publication_freeze(false, 'seed-baseline-test')");
    const snapshot = await collectPublicationPolicyInstanceSnapshot(db);
    const pin = plan.plan.catalog;
    const preparation = await frozenPreparation(db, plan, "vendor", pin, snapshot.artifactDigest!);
    const retry = { ...plan, preparedInputs: { vendor: preparation } };
    expect(parseSeedRebuildState(retry)).toEqual(retry);
    await expect(frozenPreparation(db, retry, "vendor", pin, snapshot.artifactDigest!)).resolves.toEqual(preparation);
    retry.preparedInputs.vendor = { ...preparation, actorUserId: "rebuild-reviewer" };
    await expect(frozenPreparation(db, retry, "vendor", pin, snapshot.artifactDigest!)).rejects.toThrow("preparation-drift");
  });

  it("accepts post-plan session and Bridge activity, then rejects preservation drift after the checkpoint", async () => {
    const baseline = plan.maintenanceBaseline;
    expect(baseline).toBeDefined();
    await db.query("update auth_sessions set last_used_at='2026-09-21T02:00:00Z' where id='seed-baseline-session'");
    await expect(verifySeedMaintenanceBaseline(ctx(), plan)).rejects.toThrow("auth_sessions");
    await db.query("update auth_sessions set last_used_at='2026-09-21T01:00:00Z' where id='seed-baseline-session'");
    await db.query("update device_bridges set last_seen_at='2026-09-21T02:00:00Z' where id='seed-baseline-bridge'");
    await expect(verifySeedMaintenanceBaseline(ctx(), plan)).rejects.toThrow("device_bridges");
    await db.query("update device_bridges set last_seen_at='2026-09-21T01:00:00Z' where id='seed-baseline-bridge'");
    await expect(verifySeedMaintenanceBaseline(ctx(), plan)).resolves.toEqual(baseline);
    await expect(captureSeedMaintenanceBaseline(ctx(), plan, `sha256:${"c".repeat(64)}`))
      .rejects.toThrow("maintenance-manifest-drift");
    const missing = structuredClone(plan);
    delete missing.maintenanceBaseline;
    await expect(frozenPreparation(db, missing, "vendor", plan.plan.catalog, `sha256:${"d".repeat(64)}`))
      .rejects.toThrow("maintenance-baseline-required");
    const started = structuredClone(plan);
    started.phase = "catalog";
    started.publications.vendor = { candidateId: "candidate", artifactDigest: `sha256:${"d".repeat(64)}`,
      releaseId: "release", releaseDigest: "" };
    await expect(captureSeedMaintenanceBaseline(ctx(), started, baseline!.manifestDigest))
      .rejects.toThrow("maintenance-baseline-too-late");
  });

  it("refuses missing permission, wrong organization, changed project code and changed old data", async () => {
    await expect(planSeedRebuild(ctx(), { ...input, actorUserId: "rebuild-guest" })).rejects.toThrow();
    await expect(planSeedRebuild(ctx(), { ...input, organizationId: "other" })).rejects.toThrow();
    await db.query("update projects set code='WRONG' where id='atlas'");
    await expect(checkSeedRebuildState(ctx(), plan, plan.plan.digest, input.candidateSha)).rejects.toThrow();
    await db.query("update projects set code='ATL-Intl' where id='atlas'");
    await db.query("update dts_config_set set name='Changed after plan' where id='old-atlas-config'");
    await expect(checkSeedRebuildState(ctx(), plan, plan.plan.digest, input.candidateSha)).rejects.toThrow("parameter-inventory-drift");
    await db.query("update dts_config_set set name='Previous parameters' where id='old-atlas-config'");
  });

  it("runs the real CLI plan and private journal without granting a maintenance proof", async () => {
    const settings = { WISEEFF_CATALOG_BOOTSTRAP_DATABASE_URL: database.url, WISEEFF_API_PROCESS: "0",
      OBJECT_STORE_MODE: "local", OBJECT_STORE_ROOT: directory };
    const original = Object.fromEntries(Object.keys(settings).map((key) => [key, process.env[key]]));
    Object.assign(process.env, settings);
    try {
      const runDir = path.join(directory, "cli-journal");
      const result = await runSeedRebuildCli(["plan", "--run-dir", runDir, "--run-id", "cli-plan",
        "--actor", input.actorUserId, "--organization-id", org, "--candidate-sha", input.candidateSha]);
      expect(result).toMatchObject({ ok: true, writes: false, expectedBindings: 372 });
      expect(await runSeedRebuildCli(["status", "--run-dir", runDir])).toMatchObject({ phase: "planned" });
      const cliPlan = result as { plan: { digest: string } };
      await expect(runSeedRebuildCli(["rebuild", "--run-dir", runDir, "--confirm-plan", cliPlan.plan.digest,
        "--candidate-sha", input.candidateSha])).rejects.toThrow("maintenance-baseline-required");
      expect((await db.query("select count(*)::int as n from parameter_catalog.project_parameter_bindings")).rows[0]).toEqual({ n: 0 });
    } finally {
      for (const [key, value] of Object.entries(original)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  });

  it("binds the CLI checkpoint to the live wrapper manifest and rejects journal tampering", async () => {
    const settings = { WISEEFF_CATALOG_BOOTSTRAP_DATABASE_URL: database.url, WISEEFF_API_PROCESS: "0",
      OBJECT_STORE_MODE: "local", OBJECT_STORE_ROOT: directory };
    const original = Object.fromEntries(Object.keys(settings).map((key) => [key, process.env[key]]));
    const runDir = path.join(directory, "cli-maintenance-baseline");
    const manifestDigest = `sha256:${"e".repeat(64)}`;
    const otherManifestDigest = `sha256:${"f".repeat(64)}`;
    Object.assign(process.env, settings);
    try {
      const result = await runSeedRebuildCli(["plan", "--run-dir", runDir, "--run-id", "cli-baseline",
        "--actor", input.actorUserId, "--organization-id", org, "--candidate-sha", input.candidateSha]);
      const cliPlan = result as { plan: { digest: string; candidateSha: string; organizationId: string } };
      const proof = { schemaVersion: 1, runId: "cli-baseline", planDigest: cliPlan.plan.digest,
        confirmedPlanDigest: cliPlan.plan.digest, candidateSha: cliPlan.plan.candidateSha, organizationId: cliPlan.plan.organizationId,
        phase: "maintenance-begun", recoveryPoint: { verified: true, manifestDigest },
        isolation: { proxyStopped: true, queuePaused: true, writersStopped: true, managerStopped: true },
        publication: { frozen: true }, queue: { drained: true } };
      await writeFile(path.join(runDir, "wrapper-state.json"), JSON.stringify(proof));
      await db.query("select catalog_publication.set_publication_freeze(true, 'seed-cli-baseline-test')");
      const captured = await runSeedRebuildCli(["maintenance-baseline", "--run-dir", runDir,
        "--confirm-plan", cliPlan.plan.digest, "--candidate-sha", cliPlan.plan.candidateSha]);
      expect(captured).toMatchObject({ ok: true, status: "maintenance-baseline-recorded", manifestDigest });
      await writeFile(path.join(runDir, "wrapper-state.json"), JSON.stringify({ ...proof,
        recoveryPoint: { verified: true, manifestDigest: otherManifestDigest } }));
      await expect(runSeedRebuildCli(["maintenance-baseline", "--run-dir", runDir,
        "--confirm-plan", cliPlan.plan.digest, "--candidate-sha", cliPlan.plan.candidateSha]))
        .rejects.toThrow("maintenance-manifest-drift");
      const corePath = path.join(runDir, "core-state.json");
      const core = JSON.parse(await readFile(corePath, "utf8")) as { maintenanceBaseline: { digest: string } };
      core.maintenanceBaseline.digest = cliPlan.plan.digest;
      await writeFile(corePath, JSON.stringify(core));
      await expect(runSeedRebuildCli(["catalog-prepare", "--run-dir", runDir, "--stage", "vendor",
        "--confirm-plan", cliPlan.plan.digest, "--candidate-sha", cliPlan.plan.candidateSha]))
        .rejects.toThrow("maintenance-baseline-drift");
    } finally {
      await db.query("select catalog_publication.set_publication_freeze(false, 'seed-cli-baseline-test')");
      for (const [key, value] of Object.entries(original)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  });

  it("publishes through a real manager LOGIN, archives populated residue and verifies every successor before deletion", async () => {
    for (const stage of ["vendor", "configuration-schema"] as const) {
      const current = await collectPublicationPolicyInstanceSnapshot(db);
      const pin = { id: current.currentReleaseId!, digest: current.currentReleaseDigest! };
      const frozen = await frozenPreparation(db, plan, stage, pin, current.artifactDigest!);
      plan.preparedInputs ??= {};
      plan.preparedInputs[stage] = frozen;
      const prepared = await prepareSeedCatalog({ ...frozen, db });
      expect(prepared.ok, JSON.stringify(prepared)).toBe(true);
      if (!prepared.ok) throw new Error("prepare failed");
      const publish = { db, organizationId: org, runId: input.runId, stage, candidateId: prepared.value.candidateId,
        expectedArtifactDigest: prepared.value.artifactDigest, expectedCurrent: pin, idempotencyKey: `rebuild:${stage}` };
      const unauthorized = await publishSeedCatalog({ ...publish, actorUserId: "rebuild-guest" });
      expect(unauthorized.ok).toBe(false);
      const queued = await publishSeedCatalog({ ...publish, actorUserId: "rebuild-reviewer" });
      expect(queued.ok, JSON.stringify(queued)).toBe(true);
      await expect(assertSeedPublicationIdle(db)).rejects.toThrow("unrelated-publication-pending");
      await expect(assertSeedPublicationIdle(db, prepared.value.candidateId)).resolves.toBeUndefined();
      const managerPool = getRootPostgresPool(manager)!;
      expect(await runPublicationManagerOnce({ db: manager, pool: managerPool, installer: createCatalogInstaller(managerPool),
        resolvePublisherActor: async (id) => createUserInvocation(await getAuthContext(manager, id)) })).toBe("claimed");
      const receipt = await getSeedCatalogPublicationStatus({ db, candidateId: prepared.value.candidateId,
        expectedRunId: input.runId, expectedStage: stage });
      expect(receipt.ok, JSON.stringify(receipt)).toBe(true);
      if (!receipt.ok || !receipt.value.receiptId) throw new Error(`receipt missing: ${JSON.stringify(receipt)}`);
      plan.publications[stage] = { candidateId: receipt.value.candidateId, artifactDigest: receipt.value.artifactDigest,
        releaseId: receipt.value.releaseId, releaseDigest: receipt.value.receiptReleaseDigest!, receiptId: receipt.value.receiptId };
    }
    plan.phase = "catalog";
    const wrongReceipt = structuredClone(plan);
    wrongReceipt.publications.vendor!.receiptId = "not-the-observed-receipt";
    await expect(rebuildSeedProjects(ctx(), wrongReceipt, async () => {})).rejects.toThrow("publication-receipt-drift");
    const failedAttempt = structuredClone(plan);
    await expect(rebuildSeedProjects({ ...ctx(), store: { ...store,
      put: async () => { throw new Error("injected archive store outage"); } } }, failedAttempt, async () => {}))
      .rejects.toThrow("injected archive store outage");
    expect(failedAttempt.phase).toBe("recovery-required");
    await expect(rebuildSeedProjects(ctx(), failedAttempt, async () => {})).rejects.toThrow("publication-or-recovery-required");
    expect((await db.query("select id from parameter_drafts where id='old-draft-atlas'")).rows).toHaveLength(1);
    expect((await db.query("select count(*)::int as n from parameter_catalog.project_parameter_bindings")).rows[0]).toEqual({ n: 0 });
    const transitions: string[] = [];
    const rebuilt = await rebuildSeedProjects(ctx(), plan, async (state) => { transitions.push(state.phase); });
    expect(rebuilt.bindings).toBe(372);
    const modules = await db.query("select * from parameter_modules where organization_id=$1 order by id", [org]);
    const capacity = await curateReviewedSeedPlacementCapacity(db, { organizationId: org });
    expect(capacity.created).toEqual([]);
    expect((await db.query(`select module_id from parameter_catalog.subject_placements
      where organization_id=$1 and module_id=$2`, [org, capacity.driverGroupModuleId])).rows).toHaveLength(1);
    expect((await db.query("select * from parameter_modules where organization_id=$1 order by id", [org])).rows)
      .toEqual(modules.rows);
    expect(transitions).toContain("archiving");
    expect(transitions.indexOf("materializing")).toBeLessThan(transitions.indexOf("disposing"));
    expect(plan.phase).toBe("verified");
    expect(parseSeedRebuildState(plan)).toEqual(plan);
    expect((await db.query(
      `select id, attribution_subject_id, property_key, definition_lifecycle
         from parameter_specs
        where id=$1`,
      [legacyOverlapSnapshot.parameterSpec.id],
    )).rows).toEqual([legacyOverlapSnapshot.parameterSpec]);
    expect((await db.query(
      `select id, parameter_spec_id, version, description, lifecycle, version_status
         from parameter_spec_versions
        where id=$1`,
      [legacyOverlapSnapshot.parameterSpecVersion.id],
    )).rows).toEqual([legacyOverlapSnapshot.parameterSpecVersion]);
    expect((await db.query(
      `select id, parameter_spec_id, driver_schema_id, property_key, schema_namespace, documentation
         from dts_property_specs
        where id=$1`,
      [legacyOverlapSnapshot.dtsPropertySpec.id],
    )).rows).toEqual([legacyOverlapSnapshot.dtsPropertySpec]);
    expect((await db.query(
      `select id, driver_schema_id, parameter_spec_version_id, version
         from driver_schema_versions
        where id=$1`,
      [legacyOverlapSnapshot.driverSchemaVersion.id],
    )).rows).toEqual([legacyOverlapSnapshot.driverSchemaVersion]);
    expect((await db.query(
      `select distinct b.project_id, r.status,
         exists (select 1 from dts_logical_node_revisions n
           where n.config_revision_id=r.id and n.driver_schema_version_id=$2) as retained_driver_version
       from parameter_catalog.current_project_parameter_bindings b
       join parameter_catalog.project_value_source_pins p
         on p.binding_id=b.id and p.project_value_id=b.current_value_id
       join dts_config_revisions r on r.id=p.config_revision_id
       where b.organization_id=$1 order by b.project_id`,
      [org, legacyOverlapSnapshot.driverSchemaVersion.id],
    )).rows).toEqual([
      { project_id: "atlas", status: "resolved", retained_driver_version: true },
      { project_id: "aurora", status: "resolved", retained_driver_version: true },
      { project_id: "nebula", status: "resolved", retained_driver_version: true },
    ]);
    expect((await db.query("select id from parameter_drafts order by id")).rows).toEqual([{ id: "custom-draft" }]);
    expect((await db.query("select id from project_parameter_file_versions where id='old-atlas-version'")).rows).toEqual([]);
    expect((await db.query("select id from project_parameter_file_versions where id=$1", [oldAuroraFileVersionId])).rows)
      .toEqual([{ id: oldAuroraFileVersionId }]);
    expect((await db.query<{ file_name: string; config_set_id: string | null }>(
      "select file_name,config_set_id from project_parameter_files where id=$1", [oldAuroraFileId],
    )).rows).toEqual([{ file_name: "aurora-board.dts", config_set_id: null }]);
    expect((await db.query("select id from dts_config_revision_members where id=$1", [oldAuroraRevisionMemberId])).rows)
      .toEqual([{ id: oldAuroraRevisionMemberId }]);
    const currentMembers = await db.query<{
      project_id: string;
      file_name: string;
      role: string;
      sort_order: number;
    }>(`select file.project_id,file.file_name,file.config_set_role as role,file.config_set_sort_order as sort_order
          from project_parameter_files file
          join dts_config_set config_set on config_set.id=file.config_set_id
         where file.organization_id=$1 and config_set.name='default'
           and file.project_id=any($2::text[])
         order by file.project_id,file.config_set_sort_order,file.file_name`, [org, ["atlas", "aurora", "nebula"]]);
    expect(currentMembers.rows).toEqual([
      { project_id: "atlas", file_name: "board.dts", role: "base", sort_order: 0 },
      { project_id: "atlas", file_name: "charging-thermal.dts", role: "overlay", sort_order: 1 },
      { project_id: "atlas", file_name: "power-config.json", role: "misc", sort_order: 102 },
      { project_id: "aurora", file_name: "board.dts", role: "base", sort_order: 0 },
      { project_id: "aurora", file_name: "charging-thermal.dts", role: "overlay", sort_order: 1 },
      { project_id: "aurora", file_name: "power-config.json", role: "misc", sort_order: 102 },
      { project_id: "nebula", file_name: "board.dts", role: "base", sort_order: 0 },
      { project_id: "nebula", file_name: "charging-thermal.dts", role: "overlay", sort_order: 1 },
      { project_id: "nebula", file_name: "power-config.json", role: "misc", sort_order: 102 },
    ]);
    const auroraArchive = plan.archives.find((archive) => archive.projectId === "aurora");
    expect(auroraArchive).toBeDefined();
    const archiveObject = await db.query<{ object_ref: string }>(
      "select object_ref from project_parameter_plane_archives where id=$1", [auroraArchive!.archiveId],
    );
    const archivedAurora = JSON.parse((await store.get(archiveObject.rows[0]!.object_ref)).toString("utf8")) as {
      relations: Record<string, Array<Record<string, unknown>>>;
      objects: Record<string, { bytesBase64: string }>;
    };
    expect(archivedAurora.relations.project_parameter_files)
      .toEqual(expect.arrayContaining([expect.objectContaining({
        id: oldAuroraFileId,
        file_name: "aurora-board.dts",
        config_set_id: oldAuroraConfigSetId,
        config_set_role: "base",
        config_set_sort_order: 0,
      })]));
    expect(archivedAurora.relations.project_parameter_file_versions)
      .toEqual(expect.arrayContaining([expect.objectContaining({ id: oldAuroraFileVersionId })]));
    expect(archivedAurora.relations.dts_config_revision_members)
      .toEqual(expect.arrayContaining([expect.objectContaining({ id: oldAuroraRevisionMemberId })]));
    expect(Object.values(archivedAurora.objects)).toEqual(expect.arrayContaining([
      expect.objectContaining({ bytesBase64: Buffer.from(oldAuroraSource, "utf8").toString("base64") }),
    ]));
    expect((await store.get(sharedObjectKey)).toString()).toContain('old-property');
    expect(await verifySeedRebuild(ctx(), plan)).toEqual(rebuilt);
    expect(await rebuildSeedProjects(ctx(), plan, async () => { throw new Error("no replay writes"); })).toEqual(rebuilt);
    const wrongArchives = structuredClone(plan);
    wrongArchives.archives[0]!.projectId = "custom-preserved";
    await expect(verifySeedRebuild(ctx(), wrongArchives)).rejects.toThrow("all-archives-required");
  }, 120_000);

  it("rejects changed existing backend rows even when their tables allow new seed rows", async () => {
    await db.query("update node_type_definitions set bare_node_name='changed' where attribution_subject_id='kept-node-type'");
    await expect(verifySeedRebuild(ctx(), plan)).rejects.toThrow("public.node_type_definitions");
    await db.query("update node_type_definitions set bare_node_name='keep' where attribution_subject_id='kept-node-type'");
    await db.query("update debug_nodes set description='Changed settings' where id='kept-device-node'");
    await expect(verifySeedRebuild(ctx(), plan)).rejects.toThrow("public.debug_nodes");
    await db.query("update debug_nodes set description='Keep settings' where id='kept-device-node'");
    await expect(verifySeedRebuild(ctx(), plan)).resolves.toMatchObject({ bindings: 372 });
    await expect(verifySeedRebuild({ ...ctx(), store: { ...store,
      getBounded: async (key, limit) => key.includes('board.dts') ? Buffer.from('corrupted') : store.getBounded!(key, limit),
    } }, plan)).rejects.toThrow("source-bytes-mismatch");
  });
});
