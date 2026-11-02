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
import { migrateModuleStructure } from "../../../scripts/migrate-module-structure";
import { createLegacyParameterModule as createParameterModule } from "../../testing/legacyParameterModuleFixture";
import { writeGuardedRegistration } from "../parameter-governance/registration/internalGuardedRegistrationWriter";
import { createRegistrationService } from "../parameter-governance/registration/service";
import { createConfigSet, addConfigSetFile } from "../parameter-files/configSetService";
import { uploadProjectParameterFile } from "../parameter-files/service";
import { ingestConfigRevision } from "../parameter-topology/ingestService";
import { asValueClient, loadPublishedCatalog, resolveObservedSubject, syncPublishedCatalogProjectValues, syncPublishedCatalogProjectValuesInTransaction } from "./catalogProjectValueSync";
import { loadOrganizationCatalogSnapshot } from "../parameter-modules/recognitionSettings";
import { readRegistry } from "../parameter-modules/repository";
import { ensureSeedSubjectRegistrations } from "./seedInitialization/registration";
import { produceDtsReviewEvidenceInTransaction } from "../parameter-governance/evidence/dtsProducer";
import { subjectMatcherRevision } from "../catalog-kernel/runtime/subjectMatch";
import { stabilizeCanonicalBinding } from "./binding/service";
import { lockOrganizationModuleRecognition, lockOrganizationSubjectRegistration } from "../parameter-modules/recognitionLock";
import { resolveAttributionModuleForBinding } from "../parameter-modules/ensureAttributionModuleForBinding";
import { resolveModuleIdForBinding, unclassifiedModuleId } from "../parameter-modules/resolveModuleForBinding";

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
        { op: "create-subject-with-definitions", kind: "driver", canonicalKey: "driver:huawei,charge_mode_test",
          selector: { kind: "driver-compatible", value: "huawei,charge_mode_test" }, nature: "physical-device", cardinality: "multiple",
          definitions: [{ propertyKey: "mode", content }] },
        { op: "create-subject", kind: "driver", canonicalKey: "driver:huawei,battery_charge_balance",
          selector: { kind: "driver-compatible", value: "huawei,battery_charge_balance" }, nature: "physical-device", cardinality: "multiple" },
        { op: "create-subject-with-definitions", kind: "node-type", canonicalKey: "node-type:battery1", ownerSubjectId: "s4-charge-balance",
          selector: { kind: "node-type-name", value: "battery1" }, definitions: ["weight", "limit", "capacity"].map((propertyKey) => ({ propertyKey, content })) },
        node("battery1", "csub_acme_power"), node("battery1", "owner-driver-b"), node("claim_good"), node("claim_bad"),
      ], frozenIdentity: { ...frozenPageIdentity([], "owner-integration"), subjects: [
        { canonicalKey: "driver:vendor,other", subjectId: "owner-driver-b" },
        { canonicalKey: "driver:huawei,charge_mode_test", subjectId: "s4-charge-mode" },
        { canonicalKey: "driver:huawei,battery_charge_balance", subjectId: "s4-charge-balance" },
        { canonicalKey: "node-type:battery1", subjectId: "s4-battery1", ownerSubjectId: "s4-charge-balance" },
        { canonicalKey: "node-type:battery1", subjectId: "owner-battery-a", ownerSubjectId: "csub_acme_power" },
        { canonicalKey: "node-type:battery1", subjectId: "owner-battery-b", ownerSubjectId: "owner-driver-b" },
        { canonicalKey: "node-type:claim_good", subjectId: "owner-claim-good" },
        { canonicalKey: "node-type:claim_bad", subjectId: "owner-claim-bad" },
      ], definitions: [...["owner-battery-a", "owner-battery-b", "owner-claim-good", "owner-claim-bad"].map((subjectId) => ({
        subjectId, propertyKey: "weight", definitionId: `def-${subjectId}`, revisionId: `rev-${subjectId}`,
      })), { subjectId: "s4-charge-mode", propertyKey: "mode", definitionId: "s4-mode-def", revisionId: "s4-mode-rev" },
        ...["weight", "limit", "capacity"].map((propertyKey) => ({ subjectId: "s4-battery1", propertyKey,
          definitionId: `s4-battery-${propertyKey}-def`, revisionId: `s4-battery-${propertyKey}-rev` }))] } });
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
      for (const [subjectId, subjectKind] of [["csub_acme_power", "driver"], ["owner-driver-b", "driver"],
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

  it("migrates the original charge-mode case while retaining all twelve bindings and their histories", async () => {
    const organizationId = "s4-charge-case";
    const userId = "s4-charge-admin";
    await pool.query("insert into public.organizations(id,name) values ($1,'Charge case')", [organizationId]);
    await pool.query(`insert into public.users(id,organization_id,name,email,title,is_active)
      values ($1,$2,'Admin','s4-charge@example.com','Admin',true)`, [userId, organizationId]);
    await pool.query(`insert into public.user_role_bindings(id,user_id,organization_id,role_id,project_id)
      values ('s4-charge-role',$1,$2,'admin',null)`, [userId, organizationId]);
    const testAuth = makeTestAuthContext({ userId, organizationId, permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"] });
    const power = await createParameterModule(root, { organizationId, name: "电源管理", kind: "business" });
    const charge = await createParameterModule(root, { organizationId, parentId: power.id, name: "充电", kind: "business" });
    const chargeTest = await createParameterModule(root, { organizationId, parentId: charge.id, name: "充电测试", kind: "business" });
    const balance = await createParameterModule(root, { organizationId, parentId: charge.id, name: "充电均衡", kind: "business" });
    const typed = await createParameterModule(root, { organizationId, parentId: chargeTest.id, name: "charge_mode_test", kind: "node-type", sourceKey: "nodetype:battery1" });
    await pool.query(`insert into public.parameter_module_mappings(id,organization_id,parameter_module_id,match_kind,match_value)
      values ('s4-battery-legacy-map',$1,$2,'node-type','battery1')`, [organizationId, typed.id]);
    const writer = await pool.connect();
    try {
      await writer.query("begin");
      for (const [subjectId, destinationModuleId] of [["s4-charge-mode", chargeTest.id], ["s4-charge-balance", balance.id]] as const) {
        const result = await writeGuardedRegistration(writer, { kind: "register", organizationId, subjectId: CatalogSubjectId(subjectId),
          subjectKind: "driver", expectedRelease: { id: predecessorArtifact.targetReleaseId, digest: predecessorArtifact.targetReleaseDigest },
          placement: { mode: "use-default" }, destinationModuleId, method: "explicit", proof: { reason: "S4 original case" },
          idempotencyKey: `s4-case-${subjectId}`, context: { actorKind: "org-admin", principalId: userId } });
        if (!result.ok) throw new Error(JSON.stringify(result.error));
      }
      await writer.query(`update parameter_catalog.subject_placements set module_id=null where id=(
        select current_placement_id from parameter_catalog.organization_subject_registrations where organization_id=$1 and subject_id='s4-charge-mode')`, [organizationId]);
      await writer.query("commit");
    } catch (error) { await writer.query("rollback"); throw error; } finally { writer.release(); }
    const content = `/dts-v1/; / { charge_mode_test { compatible = "huawei,charge_mode_test"; mode = <7>; };
      battery_charge_balance { compatible = "huawei,battery_charge_balance"; battery1 { weight = <11>; limit = <22>; capacity = <33>; }; }; };`;
    for (let index = 1; index <= 3; index += 1) {
      const projectId = `s4-charge-project-${index}`;
      await pool.query("insert into public.projects(id,organization_id,name,code,status,initialization_status) values ($1,$2,$1,$1,'active','initialized')", [projectId, organizationId]);
      const set = await createConfigSet(root, testAuth, { projectId, name: "Charge case" });
      const file = await uploadProjectParameterFile(root, store, testAuth, { projectId, fileName: `s4-${index}.dts`, bytes: Buffer.from(content) });
      await addConfigSetFile(root, testAuth, { configSetId: set.id, fileId: file.file.id, role: "base", sortOrder: 0 });
      const revision = await ingestConfigRevision(root, { organizationId, projectId, configSetId: set.id, entryFile: `s4-${index}.dts`,
        includeSearchPaths: ["."], overlayOrder: [], members: [{ fileId: file.file.id, fileVersionId: file.version.id,
          fileName: `s4-${index}.dts`, role: "base", sortOrder: 0, content }] }, testAuth);
      await syncPublishedCatalogProjectValues(pool, { organizationId, projectId, configSetId: set.id, configRevisionId: revision.id });
    }
    const fixture = await pool.connect();
    try {
      await fixture.query("begin");
      await fixture.query("alter table parameter_catalog.subject_placements disable trigger subject_placement_kind_ck");
      await fixture.query(`update parameter_catalog.subject_placements set module_id=$2 where id=(
        select current_placement_id from parameter_catalog.organization_subject_registrations where organization_id=$1 and subject_id='s4-battery1')`, [organizationId, typed.id]);
      await fixture.query("alter table parameter_catalog.subject_placements enable trigger subject_placement_kind_ck");
      await fixture.query("commit");
    } catch (error) { await fixture.query("rollback"); throw error; } finally { fixture.release(); }
    const snapshot = async () => (await pool.query(`select binding.id,binding.subject_id,binding.registration_id,binding.current_value_id,value.value::text,
      (select count(*)::int from parameter_catalog.binding_history_events event where event.binding_id=binding.id) as history_count,
      (select md5(coalesce(string_agg(row_to_json(event)::text,'' order by event.id),'')) from parameter_catalog.binding_history_events event
        where event.binding_id=binding.id) as history_hash
      from parameter_catalog.project_parameter_bindings binding join parameter_catalog.project_parameter_values value on value.id=binding.current_value_id
      where binding.organization_id=$1 order by binding.id`, [organizationId])).rows;
    const before = await snapshot();
    expect(before.filter((item) => item.subject_id === "s4-charge-mode")).toHaveLength(3);
    expect(before.filter((item) => item.subject_id === "s4-battery1")).toHaveLength(9);
    expect(before.some((item) => item.history_count > 0)).toBe(true);
    const preflight = await migrateModuleStructure(root, organizationId, false);
    expect(preflight.changes).toContainEqual(expect.objectContaining({ action: "structural-placement", moduleId: typed.id,
      detail: { previousBusinessModuleId: chargeTest.id, effectiveModuleId: balance.id } }));
    expect(preflight.information).toContainEqual(expect.objectContaining({ action: "renamed-module", moduleId: typed.id,
      detail: expect.objectContaining({ moduleName: "charge_mode_test", canonicalName: "battery1", aliasDisposition: "not-stored-owned-child" }) }));
    expect((await pool.query("select module_id from parameter_catalog.subject_placements where organization_id=$1 and module_id=$2", [organizationId, typed.id])).rowCount).toBe(1);
    await migrateModuleStructure(root, organizationId, true);
    expect(await snapshot()).toEqual(before);
    expect((await pool.query(`select placement.module_id from parameter_catalog.subject_placements placement
      join parameter_catalog.organization_subject_registrations registration on registration.current_placement_id=placement.id
      where registration.organization_id=$1 and registration.subject_id='s4-charge-mode'`, [organizationId])).rows).toEqual([{ module_id: null }]);
    expect((await pool.query(`select placement.module_id,effective.module_id as effective_module_id,module.archived_at is not null as archived,
      registration.display_alias from parameter_catalog.organization_subject_registrations registration
      join parameter_catalog.subject_placements placement on placement.id=registration.current_placement_id
      join parameter_catalog.registration_effective_module effective on effective.registration_id=registration.id
      join public.parameter_modules module on module.id=$2 where registration.organization_id=$1 and registration.subject_id='s4-battery1'`,
    [organizationId, typed.id])).rows).toEqual([{ module_id: null, effective_module_id: balance.id, archived: true, display_alias: null }]);
    expect(await resolveAttributionModuleForBinding(root, { organizationId, driverModule: null, compatible: null,
      instanceName: "battery1", nodeLocator: "/battery_charge_balance/battery1", attributionSubjectId: typed.attributionSubjectId })).toBe(balance.id);
    expect(await resolveModuleIdForBinding(root, { organizationId, driverModule: null, compatible: null, nodeType: "battery1" })).toBe(unclassifiedModuleId(organizationId));
    await pool.query(`insert into public.module_recognition_rules(organization_id,module_id,canonical_subject_id,node_type_name)
      values ($1,$2,'s4-battery1','battery1')`, [organizationId, typed.id]);
    await pool.query(`insert into public.registration_recognition_migration_map(organization_id,module_id,registration_id)
      select $1,$2,id from parameter_catalog.organization_subject_registrations where organization_id=$1 and subject_id='s4-battery1'`, [organizationId, typed.id]);
    expect(await resolveModuleIdForBinding(root, { organizationId, driverModule: null, compatible: null, nodeType: "battery1" })).toBe(unclassifiedModuleId(organizationId));
    expect((await migrateModuleStructure(root, organizationId, true)).changes).toEqual([]);
  }, 120_000);

  it("moves a legacy owned placement without altering retained bindings and values", async () => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const db = createSavepointDatabase(client);
      const business = await createParameterModule(db, { organizationId: ORG, name: "Legacy category", kind: "business" });
      const typed = await createParameterModule(db, { organizationId: ORG, parentId: business.id, name: "charge_mode_test", kind: "node-type" });
      const ownerModule = (await client.query<{ module_id: string }>(`select module_id from parameter_catalog.registration_effective_module
        where organization_id=$1 and subject_id='csub_acme_power'`, [ORG])).rows[0]!.module_id;
      const ownerTyped = await createParameterModule(db, { organizationId: ORG, parentId: ownerModule, name: "acme,power", kind: "driver-group" });
      await client.query("set constraints all immediate");
      // Reconstruct a placement retained from before the S1 and S3b write guards.
      await client.query("alter table parameter_catalog.subject_placements disable trigger subject_placement_kind_ck");
      await client.query(`update parameter_catalog.subject_placements set module_id=$2 where id=(
        select current_placement_id from parameter_catalog.organization_subject_registrations
        where organization_id=$1 and subject_id='owner-battery-a')`, [ORG, typed.id]);
      await client.query(`update parameter_catalog.subject_placements set module_id=$2 where id=(
        select current_placement_id from parameter_catalog.organization_subject_registrations
        where organization_id=$1 and subject_id='csub_acme_power')`, [ORG, ownerTyped.id]);
      await client.query("alter table parameter_catalog.subject_placements enable trigger subject_placement_kind_ck");
      const bindingSnapshot = async () => (await client.query(`select binding.id,binding.registration_id,binding.current_value_id,
        value.value::text, (select count(*)::int from parameter_catalog.binding_history_events event where event.binding_id=binding.id) as history_count,
        (select md5(coalesce(string_agg(row_to_json(event)::text, '' order by event.id), ''))
          from parameter_catalog.binding_history_events event where event.binding_id=binding.id) as history_hash
        from parameter_catalog.project_parameter_bindings binding
        left join parameter_catalog.project_parameter_values value on value.id=binding.current_value_id
        where binding.organization_id=$1 order by binding.id`, [ORG])).rows;
      const before = await bindingSnapshot();
      expect(before.length).toBeGreaterThan(0);
      const preflight = await migrateModuleStructure(db, ORG, false);
      expect(preflight.changes).toContainEqual(expect.objectContaining({ action: "structural-placement", moduleId: typed.id,
        detail: expect.objectContaining({ previousBusinessModuleId: business.id, effectiveModuleId: ownerModule }) }));
      expect(preflight.information).toContainEqual(expect.objectContaining({ action: "renamed-module", moduleId: typed.id }));
      expect((await client.query("select count(*)::int as count from parameter_catalog.module_structure_migration_map where organization_id=$1", [ORG])).rows[0].count).toBe(0);
      await migrateModuleStructure(db, ORG, true);
      expect(await bindingSnapshot()).toEqual(before);
      expect((await client.query(`select placement.module_id,effective.module_id as effective_module_id,module.archived_at is not null as archived
        from parameter_catalog.organization_subject_registrations registration
        join parameter_catalog.subject_placements placement on placement.id=registration.current_placement_id
        join parameter_catalog.registration_effective_module effective on effective.registration_id=registration.id
        join public.parameter_modules module on module.id=$2
        where registration.organization_id=$1 and registration.subject_id='owner-battery-a'`, [ORG, typed.id])).rows[0])
        .toMatchObject({ module_id: null, effective_module_id: ownerModule, archived: true });
      expect((await migrateModuleStructure(db, ORG, true)).changes).toEqual([]);
    } finally { await client.query("rollback"); client.release(); }
  });

  it("lets recognition updates finish before migration locks registration rows", async () => {
    const organizationId = "owner-recognition-migration";
    await pool.query("insert into organizations(id,name) values ($1,'Recognition concurrency')", [organizationId]);
    const setup = await pool.connect();
    try {
      await setup.query("begin");
      await setup.query("set constraints all deferred");
      await setup.query(`insert into parameter_catalog.organization_subject_registrations
        (id,organization_id,subject_id,status,registration_method,proof,current_placement_id)
        values ('recognition-lock-reg',$1,'csub_acme_power','active','explicit','{}','recognition-lock-placement')`, [organizationId]);
      await setup.query(`insert into parameter_catalog.subject_placements(id,registration_id,organization_id,module_id,origin)
        values ('recognition-lock-placement','recognition-lock-reg',$1,null,'curated')`, [organizationId]);
      await setup.query("commit");
    } finally { await setup.query("rollback"); setup.release(); }
    const recognition = await pool.connect();
    let migration: ReturnType<typeof migrateModuleStructure> | undefined;
    try {
      await recognition.query("begin");
      await lockOrganizationModuleRecognition(recognition, organizationId);
      const pid = (await recognition.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]!.pid;
      migration = migrateModuleStructure(root, organizationId, true);
      await vi.waitFor(async () => {
        expect((await pool.query("select pid from pg_stat_activity where $1=any(pg_blocking_pids(pid))", [pid])).rows.length).toBeGreaterThan(0);
      }, { timeout: 5000, interval: 25 });
      await recognition.query("set local statement_timeout='2s'");
      await recognition.query(`insert into public.registration_recognition_rules
        (organization_id,registration_id,driver_nature,instance_cardinality)
        values ($1,'recognition-lock-reg','physical-device','multiple')`, [organizationId]);
      await recognition.query("commit");
      await migration;
      migration = undefined;
    } finally {
      await recognition.query("rollback").catch(() => undefined);
      if (migration) await migration.catch(() => undefined);
      recognition.release();
    }
  });

  it("ingests new nodes after their legacy driver module was archived", async () => {
    const organizationId = "owner-post-migration";
    const projectId = "owner-post-migration-project";
    const userId = "owner-post-migration-user";
    await pool.query("insert into organizations(id,name) values ($1,'Post migration')", [organizationId]);
    await pool.query("insert into users(id,organization_id,name,email,title,is_active) values ($1,$2,'Post migration','post-migration@example.com','Admin',true)", [userId, organizationId]);
    await pool.query("insert into projects(id,organization_id,name,code,status,initialization_status) values ($1,$2,'Post migration','POSTMIGRATION','active','initialized')", [projectId, organizationId]);
    const business = await createParameterModule(root, { organizationId, name: "Business", kind: "business" });
    const legacy = await createParameterModule(root, { organizationId, parentId: business.id, name: "power", kind: "driver-group", sourceKey: "compatible:acme,power" });
    await migrateModuleStructure(root, organizationId, true);
    expect((await pool.query("select archived_at is not null as archived from parameter_modules where id=$1", [legacy.id])).rows).toEqual([{ archived: true }]);
    const localAuth = makeTestAuthContext({ userId, organizationId, permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"] });
    const content = `/dts-v1/; / { first { compatible = "acme,power"; battery1 { weight = <11>; }; }; };`;
    const set = await createConfigSet(root, localAuth, { projectId, name: "Post migration" });
    const file = await uploadProjectParameterFile(root, store, localAuth, { projectId, fileName: "post.dts", bytes: Buffer.from(content) });
    await addConfigSetFile(root, localAuth, { configSetId: set.id, fileId: file.file.id, role: "base", sortOrder: 0 });
    await ingestConfigRevision(root, { organizationId, projectId, configSetId: set.id, entryFile: "post.dts",
      includeSearchPaths: ["."], overlayOrder: [], members: [{ fileId: file.file.id, fileVersionId: file.version.id,
        fileName: "post.dts", role: "base", sortOrder: 0, content }] }, localAuth);
    expect((await pool.query("select count(*)::int as count from parameter_modules where organization_id=$1 and kind in ('driver-group','node-type') and archived_at is null", [organizationId])).rows)
      .toEqual([{ count: 0 }]);
  });

  it("serializes concurrent registration behind an organization migration", async () => {
    const organizationId = "owner-migration-concurrency";
    await pool.query("insert into organizations(id,name) values ($1,'Migration concurrency')", [organizationId]);
    const module = await createParameterModule(root, { organizationId, name: "Business", kind: "business" });
    const blocker = await pool.connect();
    const writer = await pool.connect();
    let migration: ReturnType<typeof migrateModuleStructure> | undefined;
    let registration: Promise<void> | undefined;
    try {
      await blocker.query("begin");
      await blocker.query("select id from parameter_modules where id=$1 for update", [module.id]);
      const blockerPid = (await blocker.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]!.pid;
      migration = migrateModuleStructure(root, organizationId, true);
      await vi.waitFor(async () => {
        expect((await pool.query("select pid from pg_stat_activity where $1=any(pg_blocking_pids(pid))", [blockerPid])).rows.length).toBeGreaterThan(0);
      }, { timeout: 5000, interval: 25 });
      await writer.query("begin");
      const writerPid = (await writer.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]!.pid;
      registration = (async () => {
        const result = await writeGuardedRegistration(writer, { kind: "register", organizationId,
          subjectId: CatalogSubjectId("csub_acme_power"), subjectKind: "driver",
          expectedRelease: { id: predecessorArtifact.targetReleaseId, digest: predecessorArtifact.targetReleaseDigest },
          placement: { mode: "use-default" }, destinationModuleId: module.id, method: "explicit", proof: { reason: "concurrency" },
          idempotencyKey: "s4-concurrent-registration", context: { actorKind: "org-admin", principalId: USER } });
        if (!result.ok) throw new Error(JSON.stringify(result.error));
        await writer.query("commit");
      })();
      await vi.waitFor(async () => {
        const blocked = await pool.query<{ blockers: number[] }>("select pg_blocking_pids($1) as blockers", [writerPid]);
        expect(blocked.rows[0]!.blockers.length).toBeGreaterThan(0);
      }, { timeout: 5000, interval: 25 });
      await blocker.query("commit");
      await migration;
      migration = undefined;
      await registration;
      registration = undefined;
      expect((await pool.query("select id from parameter_catalog.organization_subject_registrations where organization_id=$1 and subject_id='csub_acme_power'", [organizationId])).rowCount).toBe(1);
    } finally {
      await blocker.query("rollback").catch(() => undefined);
      if (migration) await migration.catch(() => undefined);
      if (registration) await registration.catch(() => undefined);
      await writer.query("rollback").catch(() => undefined);
      blocker.release(); writer.release();
    }
  });

  it("automatically registers an observed owned child and its driver exactly once", async () => {
    const organizationId = "owner-auto-org";
    const projectId = "owner-auto-project";
    const userId = "owner-auto-user";
    await pool.query("insert into organizations (id,name) values ($1,'Automatic')", [organizationId]);
    await pool.query("insert into users (id,organization_id,name,email,title,is_active) values ($1,$2,'Automatic','auto-owner@example.com','Admin',true)", [userId, organizationId]);
    await pool.query("insert into projects (id,organization_id,name,code,status,initialization_status) values ($1,$2,'Automatic','AUTOOWNER','active','initialized')", [projectId, organizationId]);
    await createParameterModule(root, { organizationId, name: "Business", kind: "business", origin: "curated" });
    const autoAuth = makeTestAuthContext({ userId, organizationId, permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"] });
    const content = `/dts-v1/; / { first { compatible = "acme,power"; battery1 { weight = <11>; }; }; second { compatible = "acme,power"; battery1 { weight = <12>; }; }; };`;
    const set = await createConfigSet(root, autoAuth, { projectId, name: "Automatic" });
    const file = await uploadProjectParameterFile(root, store, autoAuth, { projectId, fileName: "auto.dts", bytes: Buffer.from(content) });
    await addConfigSetFile(root, autoAuth, { configSetId: set.id, fileId: file.file.id, role: "base", sortOrder: 0 });
    const revision = await ingestConfigRevision(root, { organizationId, projectId, configSetId: set.id, entryFile: "auto.dts",
      includeSearchPaths: ["."], overlayOrder: [], members: [{ fileId: file.file.id, fileVersionId: file.version.id,
        fileName: "auto.dts", role: "base", sortOrder: 0, content }] }, autoAuth);
    const input = { organizationId, projectId, configSetId: set.id, configRevisionId: revision.id };
    await syncPublishedCatalogProjectValues(pool, input);
    await syncPublishedCatalogProjectValues(pool, input);
    const registrations = await pool.query(`select registration.subject_id,registration.registration_method,registration.proof,placement.module_id
      from parameter_catalog.organization_subject_registrations registration
      join parameter_catalog.subject_placements placement on placement.id=registration.current_placement_id
      where registration.organization_id=$1 order by registration.subject_id`, [organizationId]);
    expect(registrations.rows).toEqual([expect.objectContaining({ subject_id: "csub_acme_power", registration_method: "automatic" }),
      expect.objectContaining({ subject_id: "owner-battery-a", registration_method: "automatic", module_id: null })]);
    expect(registrations.rows[0].proof).toEqual(registrations.rows[1].proof);
    expect(registrations.rows[0].proof.matcherRevision).toBe(subjectMatcherRevision);
    expect(registrations.rows[0].proof.propertyOccurrenceIds).toHaveLength(2);
    const audits = await pool.query(`select metadata from public.audit_events
      where organization_id=$1 and action='registration-register'`, [organizationId]);
    expect(audits.rows).toHaveLength(1);
    expect(audits.rows[0].metadata.cascadedRegistrations).toEqual(expect.arrayContaining([
      expect.objectContaining({ subjectId: "csub_acme_power" }), expect.objectContaining({ subjectId: "owner-battery-a" })]));
    const bindings = (await pool.query("select id,registration_id from parameter_catalog.project_parameter_bindings where organization_id=$1", [organizationId])).rows;
    expect(bindings).toHaveLength(2);
    const snapshot = await loadPublishedCatalog(pool);
    if (!snapshot) throw new Error("Catalog snapshot unavailable");
    const registry = await readRegistry(root, organizationId, snapshot, { includeAdminSettings: false });
    const effectiveModule = (await pool.query<{ module_id: string }>(`select module_id from parameter_catalog.registration_effective_module
      where organization_id=$1 and subject_id='owner-battery-a'`, [organizationId])).rows[0]!.module_id;
    expect(registry.modules.find((module) => module.id === effectiveModule)).toMatchObject({ parameterCount: 2, definitionCount: 2 });
    const driver = (await pool.query<{ id: string }>(`select id from parameter_catalog.organization_subject_registrations
      where organization_id=$1 and subject_id='csub_acme_power'`, [organizationId])).rows[0]!;
    const blocker = await pool.connect();
    let pendingSync: Promise<number> | undefined;
    try {
      await blocker.query("begin");
      await lockOrganizationSubjectRegistration(blocker, organizationId);
      const blockerPid = (await blocker.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]!.pid;
      pendingSync = syncPublishedCatalogProjectValues(pool, input);
      await vi.waitFor(async () => {
        expect((await pool.query("select pid from pg_stat_activity where $1=any(pg_blocking_pids(pid))", [blockerPid])).rows.length).toBeGreaterThan(0);
      }, { timeout: 3000, interval: 25 });
      const probe = await pool.connect();
      try {
        await probe.query("begin");
        await probe.query("select id from parameter_catalog.organization_subject_registrations where id=$1 for update nowait", [driver.id]);
      } finally { await probe.query("rollback"); probe.release(); }
      await blocker.query("commit");
      await pendingSync;
      pendingSync = undefined;
    } finally { await blocker.query("rollback"); if (pendingSync) await pendingSync.catch(() => undefined); blocker.release(); }
    const service = createRegistrationService(pool);
    const command = { organizationId, registrationId: driver.id as never,
      expectedRelease: { id: predecessorArtifact.targetReleaseId, digest: predecessorArtifact.targetReleaseDigest },
      context: { actorKind: "org-admin" as const, principalId: userId }, reason: "test lifecycle" };
    const retired = await service.execute({ ...command, kind: "retire", idempotencyKey: "auto-retire" });
    expect(retired.ok).toBe(true);
    expect(await syncPublishedCatalogProjectValues(pool, input)).toBe(0);
    const laterSet = await createConfigSet(root, autoAuth, { projectId, name: "Retired observation" });
    const laterFile = await uploadProjectParameterFile(root, store, autoAuth, { projectId, fileName: "auto-retired.dts", bytes: Buffer.from(content) });
    await addConfigSetFile(root, autoAuth, { configSetId: laterSet.id, fileId: laterFile.file.id, role: "base", sortOrder: 0 });
    const laterRevision = await ingestConfigRevision(root, { organizationId, projectId, configSetId: laterSet.id, entryFile: "auto-retired.dts",
      includeSearchPaths: ["."], overlayOrder: [], members: [{ fileId: laterFile.file.id, fileVersionId: laterFile.version.id,
        fileName: "auto-retired.dts", role: "base", sortOrder: 0, content }] }, autoAuth);
    const laterInput = { ...input, configSetId: laterSet.id, configRevisionId: laterRevision.id };
    expect(await syncPublishedCatalogProjectValues(pool, laterInput)).toBe(0);
    expect(await syncPublishedCatalogProjectValues(pool, laterInput)).toBe(0);
    expect((await pool.query(`select state from parameter_catalog.governance_command_idempotency
      where organization_id=$1 and idempotency_key=$2`, [organizationId, `observation:${laterRevision.id}:owner-battery-a`])).rows).toEqual([]);
    expect((await pool.query(`select state from parameter_catalog.governance_command_idempotency
      where organization_id=$1 and idempotency_key=$2`, [organizationId, `observation:${revision.id}:owner-battery-a`])).rows)
      .toEqual([{ state: "committed" }]);
    await pool.query(`update parameter_catalog.organization_subject_registrations set status='active'
      where organization_id=$1 and subject_id='owner-battery-a'`, [organizationId]);
    const binding = (await pool.query(`select logical_node_id,source_occurrence_id,registration_id,definition_id,effective_revision_id
      from parameter_catalog.project_parameter_bindings where organization_id=$1`, [organizationId])).rows[0]!;
    expect(await stabilizeCanonicalBinding(pool, { snapshot, organizationId, projectId,
      logicalNodeId: binding.logical_node_id, sourceOccurrenceId: binding.source_occurrence_id,
      registrationId: binding.registration_id, definitionId: binding.definition_id,
      effectiveRevisionId: binding.effective_revision_id, expectedEffectiveRevisionId: binding.effective_revision_id }))
      .toMatchObject({ ok: false, error: { kind: "agreement-conflict", reason: "registration-inactive" } });
    await pool.query(`update parameter_catalog.organization_subject_registrations set status='retired'
      where organization_id=$1 and subject_id='owner-battery-a'`, [organizationId]);
    expect((await pool.query("select id,registration_id from parameter_catalog.project_parameter_bindings where organization_id=$1", [organizationId])).rows).toEqual(bindings);
    const restored = await service.execute({ ...command, kind: "restore", idempotencyKey: "auto-restore" });
    expect(restored.ok).toBe(true);
    expect((await pool.query("select id,registration_id from parameter_catalog.project_parameter_bindings where organization_id=$1", [organizationId])).rows).toEqual(bindings);
  });

  it("gives fresh and upgraded root registrations the same legacy alias", async () => {
    const freshOrg = "owner-alias-fresh";
    const upgradedOrg = "owner-alias-upgraded";
    await pool.query("insert into organizations(id,name) values ($1,'Fresh alias'),($2,'Upgraded alias')", [freshOrg, upgradedOrg]);
    const freshBusiness = await createParameterModule(root, { organizationId: freshOrg, name: "Business" });
    const upgradedBusiness = await createParameterModule(root, { organizationId: upgradedOrg, name: "Business" });
    const legacy = await createParameterModule(root, { organizationId: upgradedOrg, parentId: upgradedBusiness.id,
      name: "Power label", kind: "driver-group" });
    const pin = { id: predecessorArtifact.targetReleaseId, digest: predecessorArtifact.targetReleaseDigest };
    await ensureSeedSubjectRegistrations(root, auth, { organizationId: freshOrg, currentRelease: pin, seedDigest: "alias-seed", projectId: PROJECT,
      subjects: [{ subjectId: "csub_acme_power", subjectKind: "driver", destinationModuleId: freshBusiness.id, displayAlias: "Power label" }] });
    const client = await pool.connect();
    try {
      await client.query("begin");
      const result = await writeGuardedRegistration(client, { kind: "register", organizationId: upgradedOrg,
        subjectId: CatalogSubjectId("csub_acme_power"), subjectKind: "driver", expectedRelease: pin,
        placement: { mode: "use-default" }, destinationModuleId: upgradedBusiness.id, method: "explicit", proof: {},
        idempotencyKey: "alias-upgrade", context: { actorKind: "org-admin", principalId: USER } });
      if (!result.ok) throw new Error(JSON.stringify(result.error));
      await client.query("set constraints all immediate");
      await client.query("alter table parameter_catalog.subject_placements disable trigger subject_placement_kind_ck");
      await client.query("update parameter_catalog.subject_placements set module_id=$1 where id=$2", [legacy.id, result.value.placementId]);
      await client.query("alter table parameter_catalog.subject_placements enable trigger subject_placement_kind_ck");
      await client.query("commit");
    } finally { await client.query("rollback"); client.release(); }
    await migrateModuleStructure(root, upgradedOrg, true);
    const aliases = await pool.query(`select organization_id,subject_id,display_alias from parameter_catalog.organization_subject_registrations
      where organization_id=any($1::text[]) order by organization_id,subject_id`, [[freshOrg, upgradedOrg]]);
    expect(aliases.rows.filter((row) => row.organization_id === freshOrg).map(({ subject_id, display_alias }) => ({ subject_id, display_alias })))
      .toEqual(aliases.rows.filter((row) => row.organization_id === upgradedOrg).map(({ subject_id, display_alias }) => ({ subject_id, display_alias })));
    expect(aliases.rows).toContainEqual({ organization_id: freshOrg, subject_id: "csub_acme_power", display_alias: "Power label" });
    const placements = await pool.query(`select effective.organization_id,effective.subject_id,module.name,module.kind
      from parameter_catalog.registration_effective_module effective
      join public.parameter_modules module on module.id=effective.module_id and module.organization_id=effective.organization_id
      where effective.organization_id=any($1::text[]) order by effective.organization_id,effective.subject_id`, [[freshOrg, upgradedOrg]]);
    const normalize = (org: string) => placements.rows.filter(row => row.organization_id === org)
      .map(({ subject_id, name, kind }) => ({ subject_id, name, kind }));
    expect(normalize(freshOrg)).toEqual(normalize(upgradedOrg));
    expect(normalize(freshOrg)).toContainEqual({ subject_id: "csub_acme_power", name: "Business", kind: "business" });
    expect((await pool.query("select kind from public.parameter_modules where organization_id=$1 and kind in ('driver-group','node-type')", [freshOrg])).rows).toEqual([]);
    expect((await pool.query("select metadata from public.audit_events where organization_id=$1 and action='registration-register'", [freshOrg])).rows)
      .toContainEqual({ metadata: expect.objectContaining({ requestedDisplayAlias: "Power label", aliasSubjectId: "csub_acme_power" }) });
    await ensureSeedSubjectRegistrations(root, auth, { organizationId: freshOrg, currentRelease: pin, seedDigest: "alias-seed", projectId: PROJECT,
      subjects: [{ subjectId: "csub_acme_power", subjectKind: "driver", destinationModuleId: freshBusiness.id, displayAlias: "Different" }] });
    expect((await pool.query("select display_alias from parameter_catalog.organization_subject_registrations where organization_id=$1 and subject_id='csub_acme_power'", [freshOrg])).rows)
      .toEqual([{ display_alias: "Power label" }]);
  });

  it("registers the owner and structural child for a seed observation", async () => {
    const organizationId = "owner-seed-org";
    await pool.query("insert into organizations (id,name) values ($1,'Seed owner')", [organizationId]);
    await createParameterModule(root, { organizationId, name: "Business", kind: "business", origin: "curated" });
    const destination = await createParameterModule(root, { organizationId, name: "Preferred", kind: "business", origin: "curated" });
    const snapshot = await loadPublishedCatalog(pool);
    if (!snapshot) throw new Error("Catalog snapshot unavailable");
    const subject = resolveObservedSubject(snapshot, { compatibles: [], nodeName: "battery1", ownerCompatibles: ["acme,power"] });
    if (!subject) throw new Error("Seed observation did not resolve");
    const seedAuth = makeTestAuthContext({ userId: "seed-owner", organizationId });
    const outcome = await ensureSeedSubjectRegistrations(root, seedAuth, { organizationId,
      currentRelease: { id: snapshot.release.id, digest: snapshot.release.digest }, subjects: [{ ...subject, destinationModuleId: destination.id }], seedDigest: "owner-seed", projectId: "seed-project" });
    expect(outcome.registered).toEqual(["owner-battery-a"]);
    const rows = await pool.query(`select registration.subject_id,registration.registration_method,placement.module_id
      from parameter_catalog.organization_subject_registrations registration join parameter_catalog.subject_placements placement on placement.id=registration.current_placement_id
      where registration.organization_id=$1 order by registration.subject_id`, [organizationId]);
    expect(rows.rows).toEqual([expect.objectContaining({ subject_id: "csub_acme_power", registration_method: "automatic" }),
      expect.objectContaining({ subject_id: "owner-battery-a", registration_method: "automatic", module_id: null })]);
    expect(rows.rows[0].module_id).toBe(destination.id);
  });

  it("does not skip seed owner registration when the child already exists", async () => {
    const organizationId = "owner-seed-existing";
    await pool.query("insert into organizations (id,name) values ($1,'Existing child')", [organizationId]);
    await createParameterModule(root, { organizationId, name: "Business", kind: "business", origin: "curated" });
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("set constraints all deferred");
      await client.query(`insert into parameter_catalog.organization_subject_registrations
        (id,organization_id,subject_id,status,registration_method,proof,current_placement_id)
        values ('existing-seed-child',$1,'owner-battery-a','active','explicit','{}','existing-seed-placement')`, [organizationId]);
      await client.query(`insert into parameter_catalog.subject_placements(id,registration_id,organization_id,module_id,origin)
        values ('existing-seed-placement','existing-seed-child',$1,null,'curated')`, [organizationId]);
      await client.query("commit");
    } finally { await client.query("rollback").catch(() => undefined); client.release(); }
    const snapshot = await loadPublishedCatalog(pool);
    if (!snapshot) throw new Error("Catalog snapshot unavailable");
    const subject = resolveObservedSubject(snapshot, { compatibles: [], nodeName: "battery1", ownerCompatibles: ["acme,power"] });
    if (!subject) throw new Error("Seed observation did not resolve");
    const result = await ensureSeedSubjectRegistrations(root, makeTestAuthContext({ userId: "seed-owner", organizationId }), {
      organizationId, currentRelease: { id: snapshot.release.id, digest: snapshot.release.digest }, subjects: [subject], seedDigest: "existing-seed", projectId: "seed-project" });
    expect(result.registered).toEqual([subject.subjectId]);
    const rows = await pool.query(`select id,subject_id from parameter_catalog.organization_subject_registrations
      where organization_id=$1 order by subject_id`, [organizationId]);
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows).toContainEqual({ id: "existing-seed-child", subject_id: "owner-battery-a" });
  });

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
    await pool.query(`insert into registration_recognition_rules (organization_id,registration_id,canonical_subject_id,compatibles,driver_nature,instance_cardinality)
      select organization_id,id,subject_id,array['vendor,unrelated'],'physical-device','multiple'
      from parameter_catalog.organization_subject_registrations where organization_id=$1 and subject_id='csub_acme_power'`, [ORG]);
    try {
      const report = await claimCatalogChildOwners(root, schemasRoot);
      expect(report.candidates.find((item) => item.name === "claim_good")).toMatchObject({ status: "conflict" });
    } finally {
      await pool.query(`delete from registration_recognition_rules where organization_id=$1 and canonical_subject_id='csub_acme_power'`, [ORG]);
    }
  });

  it("checks hidden retained bindings even when no observation matched them", async () => {
    const client = await pool.connect();
    try {
      await client.query("begin isolation level repeatable read");
      await client.query(`insert into registration_recognition_rules (organization_id,registration_id,canonical_subject_id,compatibles,driver_nature,instance_cardinality)
        select organization_id,id,subject_id,array['vendor,unrelated'],'physical-device','multiple'
        from parameter_catalog.organization_subject_registrations where organization_id=$1 and subject_id='csub_acme_power'`, [ORG]);
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
      await lockOrganizationModuleRecognition(client, ORG);
      await client.query(`insert into registration_recognition_rules (organization_id,registration_id,canonical_subject_id,compatibles,driver_nature,instance_cardinality)
        select organization_id,id,subject_id,array['vendor,unrelated'],'physical-device','multiple'
        from parameter_catalog.organization_subject_registrations where organization_id=$1 and subject_id='csub_acme_power'`, [ORG]);
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
      await pool.query(`delete from registration_recognition_rules where organization_id=$1 and canonical_subject_id='csub_acme_power'`, [ORG]);
      client.release();
    }
  });

  it("preflights every binding, claims only consistent evidence, and is idempotent", async () => {
    const staleSnapshot = await loadPublishedCatalog(pool);
    if (!staleSnapshot) throw new Error("missing Catalog");
    const staleContent = `/dts-v1/; / { claim_good { weight = <123>; }; };`;
    const staleSet = await createConfigSet(root, auth, { projectId: PROJECT, name: "Stale owner snapshot" });
    const staleFile = await uploadProjectParameterFile(root, store, auth, { projectId: PROJECT, fileName: "stale-owner.dts", bytes: Buffer.from(staleContent) });
    await addConfigSetFile(root, auth, { configSetId: staleSet.id, fileId: staleFile.file.id, role: "base", sortOrder: 0 });
    const staleRevision = await ingestConfigRevision(root, { organizationId: ORG, projectId: PROJECT, configSetId: staleSet.id,
      entryFile: "stale-owner.dts", includeSearchPaths: ["."], overlayOrder: [], members: [{ fileId: staleFile.file.id,
        fileVersionId: staleFile.version.id, fileName: "stale-owner.dts", role: "base", sortOrder: 0, content: staleContent }] }, auth);
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
    const staleClient = await pool.connect();
    try {
      await staleClient.query("begin");
      expect(await syncPublishedCatalogProjectValuesInTransaction(asValueClient(staleClient), staleSnapshot,
        { organizationId: ORG, projectId: PROJECT, configSetId: staleSet.id, configRevisionId: staleRevision.id })).toBe(0);
      await staleClient.query("commit");
    } finally { await staleClient.query("rollback").catch(() => undefined); staleClient.release(); }
    expect(await install()).toMatchObject({ ok: true, value: { status: "installed" } });
    const again = await claimCatalogChildOwners(root, schemasRoot, true);
    expect(again.candidates).toMatchObject([{ name: "claim_bad", status: "conflict" }, { name: "claim_good", status: "already-claimed" }]);
    expect((await pool.query(`select count(*)::int as count from audit_events where kind='catalog-child-owners-claimed'`)).rows[0]).toEqual({ count: 1 });
  });

  it("keeps organization node-name overrides scoped to the ancestor driver", async () => {
    await pool.query(`insert into registration_recognition_rules (organization_id,registration_id,canonical_subject_id,node_type_name)
      select organization_id,id,subject_id,'custom_battery' from parameter_catalog.organization_subject_registrations
      where organization_id=$1 and subject_id in ('owner-battery-a','owner-battery-b')`, [ORG]);
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
    await pool.query(`insert into registration_recognition_rules (organization_id,registration_id,canonical_subject_id,compatibles,driver_nature,instance_cardinality)
      select organization_id,id,subject_id,array['vendor,unrelated'],'physical-device','multiple'
      from parameter_catalog.organization_subject_registrations where organization_id=$1 and subject_id='csub_acme_power'`, [ORG]);
    const snapshot = await loadPublishedCatalog(pool);
    if (!snapshot) throw new Error("missing Catalog");
    const effective = await loadOrganizationCatalogSnapshot(root, ORG, snapshot);
    expect(resolveObservedSubject(effective, { compatibles: [], nodeName: "claim_good", ownerCompatibles: ["acme,power"] })).toBeNull();
    await syncPublishedCatalogProjectValues(pool, { organizationId: ORG, projectId: PROJECT, ...source });
    expect((await pool.query(`select id,subject_id,current_value_id from parameter_catalog.project_parameter_bindings
      where organization_id=$1 and subject_id='owner-claim-good'`, [ORG])).rows).toEqual(before);
  });
});
