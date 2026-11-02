import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createEphemeralTestDatabase, type EphemeralTestDatabase } from "../../testing/testDatabase";
import { createPostgresDatabase, createSavepointDatabase, getRootPostgresPool, type Database, type RootDatabase } from "../../shared/database/client";
import { makeTestAuthContext } from "../../testing/authContext";
import { createMemoryObjectStore } from "../../testing/objectStore";
import { CatalogSubjectId, jsonCatalogReleaseSource } from "../catalog-kernel/interface";
import { CatalogReleaseDigest } from "../parameter-catalog-contract";
import { installPublishedRelease } from "../catalog-kernel/install/installer";
import { buildCompleteSuccessor } from "../catalog-publication/builder/completeSuccessor";
import { firstAcmePredecessor, frozenPageIdentity, integerContent } from "../catalog-publication/builder/predecessorHarness";
import type { BuiltReleaseArtifact } from "../catalog-publication/builder/types";
import { vendorDirectoryHash } from "../catalog-publication/import/vendorYaml";
import { claimCatalogChildOwners } from "../../../scripts/catalog-claim-child-owners";
import { createParameterModule } from "../parameters/parameterModuleRepository";
import { writeGuardedRegistration } from "../parameter-governance/registration/internalGuardedRegistrationWriter";
import { createConfigSet, addConfigSetFile } from "../parameter-files/configSetService";
import { uploadProjectParameterFile } from "../parameter-files/service";
import { ingestConfigRevision } from "../parameter-topology/ingestService";
import { loadPublishedCatalog, resolveObservedSubject, syncPublishedCatalogProjectValues } from "./catalogProjectValueSync";
import { loadOrganizationCatalogSnapshot } from "../parameter-modules/recognitionSettings";
import { produceDtsReviewEvidenceInTransaction } from "../parameter-governance/evidence/dtsProducer";

const ORG = "owner-integration-org";
const PROJECT = "owner-integration-project";
const USER = "owner-integration-user";
const ORG2 = "owner-integration-org-two";
const PROJECT2 = "owner-integration-project-two";
const USER2 = "owner-integration-user-two";
const auth = makeTestAuthContext({ userId: USER, organizationId: ORG, name: "Owner test", email: "owner-test@example.com",
  permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"] });
const dts = `/dts-v1/;
/ {
  first { compatible = "acme,power"; battery1 { weight = <11>; }; claim_good { weight = <21>; }; claim_bad { weight = <22>; }; };
  second { compatible = "vendor,other"; battery1 { weight = <12>; }; };
  battery1 { weight = <99>; };
};`;

describe("driver-scoped child ownership", () => {
  let database: EphemeralTestDatabase;
  let root: RootDatabase;
  let pool: pg.Pool;
  let schemasRoot: string;
  let store: ReturnType<typeof createMemoryObjectStore>;
  let tempRoot: string;
  let predecessorArtifact: BuiltReleaseArtifact;

  beforeAll(async () => {
    database = await createEphemeralTestDatabase("childowner");
    root = createPostgresDatabase(database.url);
    pool = getRootPostgresPool(root)!;
    tempRoot = await mkdtemp(path.join(tmpdir(), "wiseeff-owner-test-"));
    schemasRoot = path.join(tempRoot, "schemas", "dts");
    const vendorDir = path.join(schemasRoot, "vendor", "wiseeff");
    await mkdir(vendorDir, { recursive: true });
    await writeFile(path.join(vendorDir, "driver.yaml"), `compatible: ["acme,power"]\nchildNodes: [claim_good, claim_bad]\nproperties: {}\n`);
    await writeFile(path.join(vendorDir, "good.yaml"), `nodename: [claim_good]\nproperties: {}\n`);
    await writeFile(path.join(vendorDir, "bad.yaml"), `nodename: [claim_bad]\nproperties: {}\n`);
    await writeFile(path.join(schemasRoot, "catalog.json"), JSON.stringify({ vendorContentHash: vendorDirectoryHash(vendorDir),
      schemaPaths: ["vendor/wiseeff/driver.yaml", "vendor/wiseeff/good.yaml", "vendor/wiseeff/bad.yaml"] }));

    const first = firstAcmePredecessor();
    expect((await installPublishedRelease(pool, { mode: "bootstrap", source: jsonCatalogReleaseSource(first.bundle),
      expectedTargetDigest: CatalogReleaseDigest(first.digest) })).ok).toBe(true);
    const content = integerContent("Weight", "Measured weight.");
    const node = (name: string, ownerSubjectId?: string) => ({ op: "create-subject-with-definitions" as const,
      kind: "node-type" as const, canonicalKey: `node-type:${name}`, selector: { kind: "node-type-name" as const, value: name },
      ...(ownerSubjectId ? { ownerSubjectId } : {}), definitions: [{ propertyKey: "weight", content }] });
    const built = await buildCompleteSuccessor({ productPath: "m2-core", predecessorArtifact: { digest: first.digest, bytes: first.bytes },
      changeSet: [
        { op: "create-subject", kind: "driver", canonicalKey: "driver:vendor,other", selector: { kind: "driver-compatible", value: "vendor,other" }, nature: "physical-device", cardinality: "multiple" },
        node("battery1", "csub_acme_power"), node("battery1", "owner-driver-b"), node("claim_good"), node("claim_bad"),
      ], frozenIdentity: { ...frozenPageIdentity([], "owner-integration"), subjects: [
        { canonicalKey: "driver:vendor,other", subjectId: "owner-driver-b" },
        { canonicalKey: "node-type:battery1", subjectId: "owner-battery-a", ownerSubjectId: "csub_acme_power" },
        { canonicalKey: "node-type:battery1", subjectId: "owner-battery-b", ownerSubjectId: "owner-driver-b" },
        { canonicalKey: "node-type:claim_good", subjectId: "owner-claim-good" },
        { canonicalKey: "node-type:claim_bad", subjectId: "owner-claim-bad" },
      ], definitions: ["owner-battery-a", "owner-battery-b", "owner-claim-good", "owner-claim-bad"].map((subjectId) => ({
        subjectId, propertyKey: "weight", definitionId: `def-${subjectId}`, revisionId: `rev-${subjectId}`,
      })) } });
    if (!built.ok || built.value.kind !== "successor") throw new Error(`owner build failed: ${JSON.stringify(built)}`);
    predecessorArtifact = built.value.artifact;
    const installed = await installPublishedRelease(pool, { mode: "advance", source: jsonCatalogReleaseSource(built.value.artifact.bundle),
      expectedTargetDigest: built.value.artifact.targetReleaseDigest, expectedCurrent: { id: first.compiled.release.id, digest: CatalogReleaseDigest(first.digest) } });
    if (!installed.ok) throw new Error(`owner install failed: ${JSON.stringify(installed)}`);
    const pin = { id: built.value.artifact.targetReleaseId, digest: built.value.artifact.targetReleaseDigest };
    await pool.query(`insert into organizations (id,name) values ($1,'Owner integration')`, [ORG]);
    await pool.query(`insert into users (id,organization_id,name,email,title,is_active) values ($1,$2,'Owner test','owner-test@example.com','Admin',true)`, [USER, ORG]);
    await pool.query(`insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values ('owner-role',$1,$2,null,'admin')`, [USER, ORG]);
    await pool.query(`insert into projects (id,organization_id,name,code,status,initialization_status) values ($1,$2,'Owner integration','OWNER','active','initialized')`, [PROJECT, ORG]);
    const business = await createParameterModule(root, { organizationId: ORG, name: "Business", kind: "business", origin: "curated" });
    const client = await pool.connect();
    try {
      await client.query("begin");
      for (const [subjectId, subjectKind] of [["csub_acme_power", "driver"], ["owner-battery-a", "node-type"], ["owner-battery-b", "node-type"],
        ["owner-claim-good", "node-type"], ["owner-claim-bad", "node-type"]] as const) {
        const result = await writeGuardedRegistration(client, { kind: "register", organizationId: ORG, subjectId: CatalogSubjectId(subjectId), subjectKind,
          expectedRelease: pin, placement: { mode: "use-default" }, destinationModuleId: `module-${subjectId}`,
          newDestination: { parentModuleId: business.id, name: subjectId }, method: "explicit", proof: { reason: "test" },
          idempotencyKey: `register-${subjectId}`, context: { actorKind: "org-admin", principalId: USER } });
        if (!result.ok) throw new Error(`registration failed: ${JSON.stringify(result)}`);
      }
      await client.query("commit");
    } catch (error) { await client.query("rollback"); throw error; }
    finally { client.release(); }
    store = createMemoryObjectStore();
    const set = await createConfigSet(root, auth, { projectId: PROJECT, name: "Owner fixture" });
    const file = await uploadProjectParameterFile(root, store, auth, { projectId: PROJECT, fileName: "owner.dts", bytes: Buffer.from(dts) });
    await addConfigSetFile(root, auth, { configSetId: set.id, fileId: file.file.id, role: "base", sortOrder: 0 });
    const revision = await ingestConfigRevision(root, { organizationId: ORG, projectId: PROJECT, configSetId: set.id,
      entryFile: "owner.dts", includeSearchPaths: ["."], overlayOrder: [], members: [{ fileId: file.file.id, fileVersionId: file.version.id,
        fileName: "owner.dts", role: "base", sortOrder: 0, content: dts }] }, auth);
    await syncPublishedCatalogProjectValues(pool, { organizationId: ORG, projectId: PROJECT, configSetId: set.id, configRevisionId: revision.id });
    source = { configSetId: set.id, configRevisionId: revision.id };

    await pool.query(`insert into organizations (id,name) values ($1,'Second organization')`, [ORG2]);
    await pool.query(`insert into users (id,organization_id,name,email,title,is_active) values ($1,$2,'Second admin','owner-test-two@example.com','Admin',true)`, [USER2, ORG2]);
    await pool.query(`insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values ('owner-role-two',$1,$2,null,'admin')`, [USER2, ORG2]);
    await pool.query(`insert into projects (id,organization_id,name,code,status,initialization_status) values ($1,$2,'Second project','OWNER2','active','initialized')`, [PROJECT2, ORG2]);
    const business2 = await createParameterModule(root, { organizationId: ORG2, name: "Second business", kind: "business", origin: "curated" });
    const client2 = await pool.connect();
    try {
      await client2.query("begin");
      const registration = await writeGuardedRegistration(client2, { kind: "register", organizationId: ORG2, subjectId: CatalogSubjectId("owner-claim-bad"),
        subjectKind: "node-type", expectedRelease: pin, placement: { mode: "use-default" }, destinationModuleId: "module-second-bad",
        newDestination: { parentModuleId: business2.id, name: "bad" }, method: "explicit", proof: { reason: "test" },
        idempotencyKey: "register-second-bad", context: { actorKind: "org-admin", principalId: USER2 } });
      if (!registration.ok) throw new Error(`second registration failed: ${JSON.stringify(registration)}`);
      await client2.query("commit");
    } catch (error) { await client2.query("rollback"); throw error; }
    finally { client2.release(); }
    const auth2 = makeTestAuthContext({ userId: USER2, organizationId: ORG2, name: "Second admin", email: "owner-test-two@example.com",
      permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"] });
    const source2 = `/dts-v1/; / { second { compatible = "vendor,other"; claim_bad { weight = <41>; }; }; };`;
    const set2 = await createConfigSet(root, auth2, { projectId: PROJECT2, name: "Contradicting source" });
    const file2 = await uploadProjectParameterFile(root, store, auth2, { projectId: PROJECT2, fileName: "other.dts", bytes: Buffer.from(source2) });
    await addConfigSetFile(root, auth2, { configSetId: set2.id, fileId: file2.file.id, role: "base", sortOrder: 0 });
    const revision2 = await ingestConfigRevision(root, { organizationId: ORG2, projectId: PROJECT2, configSetId: set2.id,
      entryFile: "other.dts", includeSearchPaths: ["."], overlayOrder: [], members: [{ fileId: file2.file.id, fileVersionId: file2.version.id,
        fileName: "other.dts", role: "base", sortOrder: 0, content: source2 }] }, auth2);
    await syncPublishedCatalogProjectValues(pool, { organizationId: ORG2, projectId: PROJECT2, configSetId: set2.id, configRevisionId: revision2.id });
    await pool.query(`insert into parameter_catalog.parameter_observations
      (id,organization_id,project_id,logical_node_id,config_revision_id,source_identity,source_locator,catalog_release_id,matcher_revision,evidence_fingerprint,source_occurrence_id,parameter_locator_digest)
      select 'owner-observation-two',binding.organization_id,binding.project_id,binding.logical_node_id,pin.config_revision_id,
        'owner-observation-two',pin.locator,binding.catalog_release_id,'owner-fixture','owner-fixture',pin.source_occurrence_id,pin.locator_digest
      from parameter_catalog.project_parameter_bindings binding join parameter_catalog.project_value_source_pins pin
        on pin.binding_id=binding.id and pin.project_value_id=binding.current_value_id
      where binding.organization_id=$1 and binding.subject_id='owner-claim-bad'`, [ORG2]);
    await pool.query(`insert into parameter_catalog.parameter_observation_matches
      (id,observation_id,organization_id,project_id,logical_node_id,registration_id,subject_id,definition_id,definition_revision_id,binding_id,catalog_release_id,matcher_revision,source_occurrence_id,parameter_locator_digest)
      select 'owner-match-two','owner-observation-two',binding.organization_id,binding.project_id,binding.logical_node_id,
        binding.registration_id,binding.subject_id,binding.definition_id,binding.effective_revision_id,binding.id,binding.catalog_release_id,'owner-fixture',
        binding.source_occurrence_id,observation.parameter_locator_digest
      from parameter_catalog.project_parameter_bindings binding join parameter_catalog.parameter_observations observation on observation.id='owner-observation-two'
      where binding.organization_id=$1 and binding.subject_id='owner-claim-bad'`, [ORG2]);
  }, 180_000);
  let source: { configSetId: string; configRevisionId: string };
  afterAll(async () => { await root?.close(); await database?.drop(); if (tempRoot) await rm(tempRoot, { recursive: true, force: true }); });

  it("binds equal child names only to their corresponding driver and leaves root unmatched", async () => {
    const rows = await pool.query<{ subject_id: string; value: number }>(`select binding.subject_id,value.value
      from parameter_catalog.current_project_parameter_bindings binding
      join parameter_catalog.project_parameter_values value on value.id=binding.current_value_id
      where binding.organization_id=$1 order by binding.subject_id`, [ORG]);
    expect(rows.rows).toEqual([
      { subject_id: "owner-battery-a", value: 11 }, { subject_id: "owner-battery-b", value: 12 },
      { subject_id: "owner-claim-bad", value: 22 }, { subject_id: "owner-claim-good", value: 21 },
    ]);
  });

  it("records one unknown review item for an owned name without its driver and replays idempotently", async () => {
    const produce = () => root.transaction((tx) => produceDtsReviewEvidenceInTransaction(tx, root, store, auth, source.configRevisionId));
    await produce();
    const read = () => pool.query(`select observation.id, observation.source_locator, evidence.reason
      from parameter_catalog.parameter_observations observation
      join parameter_catalog.parameter_review_evidence evidence on evidence.observation_id=observation.id
      join public.dts_logical_node_revisions node on node.logical_node_id=observation.logical_node_id
        and node.config_revision_id=observation.config_revision_id
      where observation.organization_id=$1 and node.node_locator='/battery1'`, [ORG]);
    const first = await read();
    expect(first.rows).toHaveLength(1);
    expect(first.rows[0]).toMatchObject({ reason: "unknown", source_locator: { kind: "dts-property", propertyName: "weight" } });
    const items = () => pool.query(`select id from parameter_catalog.parameter_review_items
      where organization_id=$1 and reason='unknown' and status='open'`, [ORG]);
    expect((await items()).rows).toHaveLength(1);
    await syncPublishedCatalogProjectValues(pool, { organizationId: ORG, projectId: PROJECT,
      configSetId: source.configSetId, configRevisionId: source.configRevisionId });
    await produce();
    expect((await read()).rows).toEqual(first.rows);
    expect((await items()).rows).toHaveLength(1);
    expect((await pool.query(`select binding.id from parameter_catalog.project_parameter_bindings binding
      join public.dts_logical_node_revisions node on node.logical_node_id=binding.logical_node_id
      where node.config_revision_id=$1 and node.node_locator='/battery1'`, [source.configRevisionId])).rows).toEqual([]);
  });

  it("checks claims against each organization's effective driver recognition", async () => {
    await pool.query(`insert into module_recognition_rules (organization_id,module_id,canonical_subject_id,compatibles,driver_nature,instance_cardinality)
      values ($1,'module-csub_acme_power','csub_acme_power',array['vendor,unrelated'],'physical-device','multiple')`, [ORG]);
    try {
      const report = await claimCatalogChildOwners(root, schemasRoot);
      expect(report.candidates.find((item) => item.name === "claim_good")).toMatchObject({ status: "conflict" });
    } finally {
      await pool.query(`delete from module_recognition_rules where organization_id=$1 and module_id='module-csub_acme_power'`, [ORG]);
    }
  });

  it("checks hidden retained bindings even when no observation matched them", async () => {
    const client = await pool.connect();
    try {
      await client.query("begin isolation level repeatable read");
      await client.query(`insert into module_recognition_rules (organization_id,module_id,canonical_subject_id,compatibles,driver_nature,instance_cardinality)
        values ($1,'module-csub_acme_power','csub_acme_power',array['vendor,unrelated'],'physical-device','multiple')`, [ORG]);
      const binding = (await client.query<{ id: string }>(`select id from parameter_catalog.project_parameter_bindings
        where organization_id=$1 and subject_id='owner-claim-good'`, [ORG])).rows[0]!;
      expect((await client.query(`select id from parameter_catalog.parameter_observation_matches where binding_id=$1`, [binding.id])).rows).toEqual([]);
      await client.query(`insert into parameter_catalog.project_source_member_tombstones
        (id,organization_id,project_id,config_set_id,file_id,config_revision_id,file_version_id,binding_manifest,audit_event_id)
        select 'owner-test-tombstone',occurrence.organization_id,occurrence.project_id,occurrence.config_set_id,
          occurrence.file_id,pin.config_revision_id,pin.file_version_id,'[]'::jsonb,(select id from audit_events limit 1)
        from parameter_catalog.project_parameter_bindings binding
        join parameter_catalog.project_parameter_source_occurrences occurrence on occurrence.id=binding.source_occurrence_id
        join parameter_catalog.project_value_source_pins pin on pin.binding_id=binding.id and pin.project_value_id=binding.current_value_id
        where binding.id=$1`, [binding.id]);
      expect((await client.query(`select id from parameter_catalog.current_project_parameter_bindings where id=$1`, [binding.id])).rows).toEqual([]);
      const session = createSavepointDatabase({ query: async <Row,>(sql: string, values?: unknown[]) => {
        const result = await client.query(sql, values);
        return { rows: result.rows as Row[], rowCount: result.rowCount };
      } });
      const db: Database = { query: session.query, transaction: (fn) => session.transaction((tx) => fn({ ...tx,
        query: (sql, values) => sql === "set transaction isolation level repeatable read, read only"
          ? Promise.resolve({ rows: [], rowCount: 0 }) : tx.query(sql, values),
      })) };
      const report = await claimCatalogChildOwners(db, schemasRoot);
      expect(report.candidates.find((item) => item.name === "claim_good")).toMatchObject({ status: "conflict",
        conflicts: [expect.stringContaining(`binding:${binding.id}`)] });
    } finally { await client.query("rollback"); client.release(); }
  });

  it("waits for recognition changes before checking and applying claims", async () => {
    const client = await pool.connect();
    let pending: ReturnType<typeof claimCatalogChildOwners> | undefined;
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`parameter-module-recognition:${ORG}`]);
      await client.query(`insert into module_recognition_rules (organization_id,module_id,canonical_subject_id,compatibles,driver_nature,instance_cardinality)
        values ($1,'module-csub_acme_power','csub_acme_power',array['vendor,unrelated'],'physical-device','multiple')`, [ORG]);
      const pid = (await client.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]!.pid;
      pending = claimCatalogChildOwners(root, schemasRoot, true);
      await vi.waitFor(async () => {
        const blocked = await pool.query(`select pid from pg_stat_activity where $1=any(pg_blocking_pids(pid))`, [pid]);
        expect(blocked.rows.length).toBeGreaterThan(0);
      }, { timeout: 3000, interval: 25 });
      await client.query("commit");
      const report = await pending;
      pending = undefined;
      expect(report.candidates.find((item) => item.name === "claim_good")).toMatchObject({ status: "conflict" });
      expect((await pool.query(`select owner_subject_id from parameter_catalog.catalog_subjects where id='owner-claim-good'`)).rows[0])
        .toEqual({ owner_subject_id: null });
    } finally {
      await client.query("rollback");
      if (pending) await pending.catch(() => undefined);
      await pool.query(`delete from module_recognition_rules where organization_id=$1 and module_id='module-csub_acme_power'`, [ORG]);
      client.release();
    }
  });

  it("preflights every binding, claims only consistent evidence, and is idempotent", async () => {
    const declaration = await buildCompleteSuccessor({ productPath: "m2-core",
      predecessorArtifact: { digest: predecessorArtifact.artifactDigest, bytes: predecessorArtifact.artifactBytes },
      changeSet: [{ op: "declare-subject-owner", subjectId: "owner-claim-good", ownerSubjectId: "csub_acme_power" }],
      frozenIdentity: frozenPageIdentity([], "owner-declaration", "1.2.0") });
    if (!declaration.ok || declaration.value.kind !== "successor") throw new Error(`declaration build failed: ${JSON.stringify(declaration)}`);
    const declarationArtifact = declaration.value.artifact;
    const install = () => installPublishedRelease(pool, { mode: "advance", source: jsonCatalogReleaseSource(declarationArtifact.bundle),
      expectedTargetDigest: declarationArtifact.targetReleaseDigest,
      expectedCurrent: { id: predecessorArtifact.targetReleaseId, digest: predecessorArtifact.targetReleaseDigest } });
    expect((await install()).ok).toBe(false);
    const preflight = await claimCatalogChildOwners(root, schemasRoot);
    expect(preflight.candidates, JSON.stringify(preflight)).toMatchObject([
      { name: "claim_bad", status: "conflict" }, { name: "claim_good", status: "ready" },
    ]);
    expect(preflight.candidates[0]!.conflicts.join(" ")).toContain(ORG2);
    expect(preflight.candidates[0]!.conflicts.join(" ")).toContain("observation:owner-match-two");
    expect((await pool.query(`select id, owner_subject_id from parameter_catalog.catalog_subjects where id in ('owner-claim-good', 'owner-claim-bad') order by id`)).rows)
      .toEqual([{ id: "owner-claim-bad", owner_subject_id: null }, { id: "owner-claim-good", owner_subject_id: null }]);
    expect((await pool.query(`select count(*)::int as count from audit_events where kind='catalog-child-owners-claimed'`)).rows[0]).toEqual({ count: 0 });
    const applied = await claimCatalogChildOwners(root, schemasRoot, true);
    expect(applied.candidates).toMatchObject([{ name: "claim_bad", status: "conflict" }, { name: "claim_good", status: "claimed" }]);
    expect(await install()).toMatchObject({ ok: true, value: { status: "installed" } });
    const again = await claimCatalogChildOwners(root, schemasRoot, true);
    expect(again.candidates).toMatchObject([{ name: "claim_bad", status: "conflict" }, { name: "claim_good", status: "already-claimed" }]);
    expect((await pool.query(`select count(*)::int as count from audit_events where kind='catalog-child-owners-claimed'`)).rows[0]).toEqual({ count: 1 });
  });

  it("keeps organization node-name overrides scoped to the ancestor driver", async () => {
    await pool.query(`insert into module_recognition_rules (organization_id,module_id,canonical_subject_id,node_type_name)
      values ($1,'module-owner-battery-a','owner-battery-a','custom_battery'),
             ($1,'module-owner-battery-b','owner-battery-b','custom_battery')`, [ORG]);
    const snapshot = await loadPublishedCatalog(pool);
    if (!snapshot) throw new Error("missing Catalog");
    const effective = await loadOrganizationCatalogSnapshot(root, ORG, snapshot);
    expect(resolveObservedSubject(effective, { compatibles: [], nodeName: "custom_battery", ownerCompatibles: ["acme,power"] })?.subjectId).toBe("owner-battery-a");
    expect(resolveObservedSubject(effective, { compatibles: [], nodeName: "custom_battery", ownerCompatibles: ["vendor,other"] })?.subjectId).toBe("owner-battery-b");
    expect(resolveObservedSubject(effective, { compatibles: [], nodeName: "custom_battery" })).toBeNull();
  });

  it("keeps an existing binding when changed recognition leaves its node unmatched", async () => {
    expect((await pool.query(`select owner_subject_id from parameter_catalog.catalog_subjects where id='owner-claim-good'`)).rows[0])
      .toEqual({ owner_subject_id: "csub_acme_power" });
    const before = (await pool.query(`select id,subject_id,current_value_id from parameter_catalog.project_parameter_bindings
      where organization_id=$1 and subject_id='owner-claim-good'`, [ORG])).rows;
    expect(before).toHaveLength(1);
    await pool.query(`insert into module_recognition_rules (organization_id,module_id,canonical_subject_id,compatibles,driver_nature,instance_cardinality)
      values ($1,'module-csub_acme_power','csub_acme_power',array['vendor,unrelated'],'physical-device','multiple')`, [ORG]);
    const snapshot = await loadPublishedCatalog(pool);
    if (!snapshot) throw new Error("missing Catalog");
    const effective = await loadOrganizationCatalogSnapshot(root, ORG, snapshot);
    expect(resolveObservedSubject(effective, { compatibles: [], nodeName: "claim_good", ownerCompatibles: ["acme,power"] })).toBeNull();
    await syncPublishedCatalogProjectValues(pool, { organizationId: ORG, projectId: PROJECT, ...source });
    expect((await pool.query(`select id,subject_id,current_value_id from parameter_catalog.project_parameter_bindings
      where organization_id=$1 and subject_id='owner-claim-good'`, [ORG])).rows).toEqual(before);
  });
});
