import { mkdtemp, rm } from "node:fs/promises";
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
import { planSeedRebuild, checkSeedRebuildState, rebuildSeedProjects, verifySeedRebuild, type SeedRebuildState } from "../../../../scripts/lib/seedRebuild";
import { freezeSeedCatalogIdentity, prepareSeedCatalog, publishSeedCatalog, getSeedCatalogPublicationStatus } from "../../../../scripts/lib/seedCatalogPublication";
import { collectPublicationPolicyInstanceSnapshot } from "../../catalog-publication/authorization/instanceSnapshot";
import { runPublicationManagerOnce } from "../../catalog-publication/jobs/manager";
import { createCatalogInstaller } from "../../catalog-kernel/install/installer";
import { getAuthContext } from "../../auth/repository";
import { createUserInvocation } from "../../auth/trustedInvocation";
import { provisionPublicationRuntimeLogins, dropLabRuntimeLogins } from "../../catalog-publication/runtime/provisionRuntimeLogins";

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
  const loginToken = `seed${randomBytes(6).toString("hex")}`;
  const org = "org-rebuild";
  const input = { runId: "rebuild-test", organizationId: org, actorUserId: "rebuild-author", candidateSha: "a".repeat(40) };
  const ctx = () => ({ db, store, repoRoot: process.cwd() });

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
      values ('old-atlas-file',$1,'atlas','board.dts','dts')`, [org]);
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
    const logins = await provisionPublicationRuntimeLogins(database.url, { mode: "lab", runToken: loginToken });
    manager = createPostgresDatabase(logins.managerUrl);
  }, 60_000);

  afterAll(async () => {
    await manager?.close(); await client?.end(); await db?.close();
    if (database) expect((await dropLabRuntimeLogins(database.url, loginToken)).failed).toEqual([]);
    await database?.drop();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("plans without writing and binds the real persisted actor and all reviewed identities", async () => {
    const before = await db.query("select count(*)::int as n from project_parameter_plane_archives");
    plan = await planSeedRebuild(ctx(), input);
    expect(plan.expectedIdentities).toHaveLength(372);
    expect(plan.plan.targets).toEqual(["atlas", "aurora", "nebula"]);
    expect(plan.baseline.tables.find((row) => row.relation === "public.projects")?.count).toBe(4);
    expect((await db.query("select count(*)::int as n from project_parameter_plane_archives")).rows).toEqual(before.rows);
    await expect(checkSeedRebuildState(ctx(), plan, plan.plan.digest, input.candidateSha)).resolves.toBeDefined();
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

  it("publishes through a real manager LOGIN, archives populated residue and verifies every successor before deletion", async () => {
    for (const stage of ["vendor", "configuration-schema"] as const) {
      const current = await collectPublicationPolicyInstanceSnapshot(db);
      const pin = { id: current.currentReleaseId!, digest: current.currentReleaseDigest! };
      const frozen = await freezeSeedCatalogIdentity({ db, ...input, stage, expectedCurrent: pin,
        predecessorArtifactDigest: current.artifactDigest!, schemasRoot: path.join(process.cwd(), "schemas/dts"),
        candidateId: `ccand_rebuild_${stage}`, artifactId: `cart_rebuild_${stage}`, releaseId: `crel_rebuild_${stage}`,
        releaseVersion: stage === "vendor" ? "2.0.0" : "2.1.0", publishedAt: "2026-09-21T00:00:00Z" });
      expect(frozen.ok, JSON.stringify(frozen)).toBe(true);
      if (!frozen.ok) throw new Error("freeze failed");
      const prepared = await prepareSeedCatalog({ ...frozen.value, db });
      expect(prepared.ok, JSON.stringify(prepared)).toBe(true);
      if (!prepared.ok) throw new Error("prepare failed");
      const publish = { db, organizationId: org, runId: input.runId, stage, candidateId: prepared.value.candidateId,
        expectedArtifactDigest: prepared.value.artifactDigest, expectedCurrent: pin, idempotencyKey: `rebuild:${stage}` };
      const unauthorized = await publishSeedCatalog({ ...publish, actorUserId: "rebuild-guest" });
      expect(unauthorized.ok).toBe(false);
      const queued = await publishSeedCatalog({ ...publish, actorUserId: "rebuild-reviewer" });
      expect(queued.ok, JSON.stringify(queued)).toBe(true);
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
    expect(transitions).toContain("archiving");
    expect(transitions.indexOf("materializing")).toBeLessThan(transitions.indexOf("disposing"));
    expect(plan.phase).toBe("verified");
    expect((await db.query("select id from parameter_drafts order by id")).rows).toEqual([{ id: "custom-draft" }]);
    expect((await db.query("select id from project_parameter_file_versions where id='old-atlas-version'")).rows).toEqual([]);
    expect((await store.get(sharedObjectKey)).toString()).toContain('old-property');
    expect(await verifySeedRebuild(ctx(), plan)).toEqual(rebuilt);
    expect(await rebuildSeedProjects(ctx(), plan, async () => { throw new Error("no replay writes"); })).toEqual(rebuilt);
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
