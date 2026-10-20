import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createEphemeralTestDatabase } from "../../../testing/testDatabase";
import { makeTestAuthContext } from "../../../testing/authContext";
import { createPostgresDatabase, getRootPostgresPool } from "../../../shared/database/client";
import { createUserInvocation } from "../../auth/trustedInvocation";
import { createTrustedRefusalAuditSink } from "../../audit/trustedRefusalSink";
import { validCatalogReleaseBundle, refreshAuthoritativeSource } from "../../catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import { compileCatalogRelease } from "../../catalog-kernel/compiler";
import { jsonCatalogReleaseSource } from "../../catalog-kernel/interface";
import { installPublishedRelease } from "../../catalog-kernel/install/installer";
import { encodeBundleBytes, sha256Digest } from "../../catalog-publication/builder/bundleCodec";
import { prepareCatalogDefinitionErasure } from "../../catalog-publication/definitionErasure";
import { createLocalObjectStore } from "../../logs/objectStore";
import { CatalogSubjectId } from "../../parameter-catalog-contract";
import { executeRegistration } from "../../parameter-governance/registration";
import { createParameterModuleForAuth } from "../../parameters/service";
import { createParameterModule } from "../../parameters/parameterModuleRepository";
import { createConfigSet, addConfigSetFile } from "../../parameter-files/configSetService";
import { uploadProjectParameterFile } from "../../parameter-files/service";
import { createCandidate } from "../../parameter-files/candidateService";
import { freezeCanonicalCandidateBatchSnapshotInTransaction, previewCanonicalCandidate } from "../../parameter-files/canonicalFileWorkflow";
import { ingestConfigRevision } from "../../parameter-topology/ingestService";
import { asValueClient, loadPublishedCatalog, syncPublishedCatalogProjectValuesInTransaction } from "../../parameter-bindings/catalogProjectValueSync";
import { approveCanonicalBatchValueChange, submitCanonicalBatchValueChange } from "../../parameter-bindings/drafts/batchChangeService";

const ORG = "org-erasure-batch";
const PROJECT = "project-erasure-batch";
const ADMIN = "user-erasure-batch-admin";
const REVIEWER = "user-erasure-batch-reviewer";
const ERASED = "pdef_acme_power_iin_max";
const RETAINED = "pdef_acme_power_retained";
const SOURCE = '/dts-v1/;\n/ { device@0 { compatible = "acme,power"; iin_max = <10>; retained = <20>; }; };\n';
const admin = makeTestAuthContext({ userId: ADMIN, organizationId: ORG,
  permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"],
  roles: [{ roleId: "admin", projectId: null }] });
const reviewer = makeTestAuthContext({ userId: REVIEWER, organizationId: ORG,
  permissions: ["parameter:view", "parameter:edit", "parameter:review"],
  roles: [{ roleId: "software-committer", projectId: PROJECT }] });

describe("Definition erasure preserves another Definition in an approved batch", () => {
  let lane: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  let db: ReturnType<typeof createPostgresDatabase>;
  let storage: ReturnType<typeof createLocalObjectStore>;
  let directory: string;

  beforeAll(async () => {
    lane = await createEphemeralTestDatabase("erasure_batch");
    db = createPostgresDatabase(lane.url);
    directory = await mkdtemp(join(tmpdir(), "wiseeff-erasure-batch-"));
    storage = createLocalObjectStore(directory);
    await db.query("insert into organizations(id,name) values ($1,'Erasure batch')", [ORG]);
    await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'admin','Admin',true),($3,$2,'reviewer','Reviewer',true)", [ADMIN, ORG, REVIEWER]);
    await db.query("insert into projects(id,organization_id,name,code,status) values ($1,$2,'Erasure batch','ERASE','initialized')", [PROJECT, ORG]);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values ('erase-admin',$1,$2,null,'admin'),('erase-reviewer',$3,$2,$4,'software-committer')", [ADMIN, ORG, REVIEWER, PROJECT]);

    const full = validCatalogReleaseBundle();
    const release = structuredClone(full.releases[0]!) as Parameters<typeof refreshAuthoritativeSource>[0];
    const definition = release.documents.find(document => document.kind === "definition");
    if (!definition || definition.kind !== "definition") throw new Error("Missing Definition fixture");
    const retained = structuredClone(definition);
    retained.content.id = RETAINED;
    retained.content.propertyKey = "retained";
    retained.content.revision.id = "drev_acme_power_retained_1";
    retained.content.revision.matching.sourceProperty = "retained";
    release.documents.push(retained);
    refreshAuthoritativeSource(release);
    const bundle = { schemaVersion: full.schemaVersion, targetReleaseId: release.manifest.release.id, releases: [release] };
    const compiled = compileCatalogRelease(bundle);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.error));
    const installed = await installPublishedRelease(getRootPostgresPool(db)!, {
      mode: "bootstrap", source: jsonCatalogReleaseSource(bundle), expectedTargetDigest: compiled.value.aggregateDigest });
    if (!installed.ok) throw new Error(JSON.stringify(installed.error));
    const bytes = encodeBundleBytes(bundle);
    await db.query(`insert into catalog_publication.release_artifacts(id,artifact_digest,bytes_checksum,artifact_bytes,
      source_kind,target_release_id,target_release_digest,toolchain) values ('cart_erasure_batch',$1,$2,$3,'repository-bundle',$4,$1,$5)`,
    [compiled.value.aggregateDigest, sha256Digest(bytes), Buffer.from(bytes), release.manifest.release.id, release.manifest.toolchain]);
    const business = await createParameterModuleForAuth(db, admin, { name: "Erasure batch", kind: "business" });
    const driver = await createParameterModule(db, { organizationId: ORG, name: "Erasure driver", kind: "driver-group",
      parentId: business.id, sourceKey: "compatible:acme,power" });
    const registered = await executeRegistration(getRootPostgresPool(db)!, { kind: "register", organizationId: ORG,
      subjectId: CatalogSubjectId("csub_acme_power"), subjectKind: "driver", expectedRelease: compiled.value.release,
      destinationModuleId: driver.id, placement: { mode: "use-default" }, method: "explicit", proof: { reason: "Erasure regression" },
      idempotencyKey: "erasure-batch-register", context: { actorKind: "org-admin", principalId: ADMIN } });
    if (!registered.ok) throw new Error(JSON.stringify(registered.error));
  }, 120_000);

  afterAll(async () => {
    await db?.close();
    await lane?.drop();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("detaches the revoked batch proof without deleting the surviving delete value, history, pins or original bytes", async () => {
    const set = await createConfigSet(db, admin, { projectId: PROJECT, name: "Erasure source" });
    const upload = await uploadProjectParameterFile(db, storage, admin, {
      projectId: PROJECT, fileName: "board.dts", bytes: Buffer.from(SOURCE) });
    await addConfigSetFile(db, admin, { configSetId: set.id, fileId: upload.file.id, role: "base", sortOrder: 0 });
    const revision = await ingestConfigRevision(db, { organizationId: ORG, projectId: PROJECT, configSetId: set.id,
      entryFile: "board.dts", includeSearchPaths: ["."], overlayOrder: [], members: [{ fileId: upload.file.id,
        fileVersionId: upload.version.id, fileName: "board.dts", sourceName: "board.dts", role: "base", sortOrder: 0, content: SOURCE }] }, admin);
    const catalog = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!catalog) throw new Error("Published Catalog fixture is unavailable");
    await db.transaction(tx => syncPublishedCatalogProjectValuesInTransaction(asValueClient(tx), catalog,
      { organizationId: ORG, projectId: PROJECT, configSetId: set.id, configRevisionId: revision.id }));
    const candidate = await createCandidate(db, storage, admin, { projectId: PROJECT, fileId: upload.file.id,
      fileName: "board.dts", bytes: Buffer.from(SOURCE.replace("iin_max = <10>", "iin_max = <30>").replace("retained = <20>;", "/delete-property/ retained;")) });
    const preview = await previewCanonicalCandidate(db, storage, admin, { projectId: PROJECT, candidateId: candidate.id });
    const proof = await db.transaction(tx => freezeCanonicalCandidateBatchSnapshotInTransaction(tx, storage, admin,
      { projectId: PROJECT, candidateId: candidate.id, expectedProofToken: preview.proofToken! }));
    const request = await submitCanonicalBatchValueChange(db, storage, admin, { projectId: PROJECT, candidateId: candidate.id,
      expectedProofToken: proof.proofToken, reason: "Set A and delete B in one reviewed source write", assignedToUserId: REVIEWER,
      invocation: createUserInvocation(admin), requestId: "erasure-batch-submit", refusalSink: createTrustedRefusalAuditSink(db) });
    const applied = await db.transaction(tx => approveCanonicalBatchValueChange(tx, storage, reviewer, catalog,
      { projectId: PROJECT, requestId: request.id, batchProofDigest: proof.batchProofDigest,
        draftImpactDigest: request.draftImpactDigest ?? undefined, invocation: createUserInvocation(reviewer),
        traceId: "erasure-batch-approve", refusalSink: createTrustedRefusalAuditSink(db) }));
    expect(applied.status).toBe("approved");
    const surviving = applied.targets.find(target => target.definitionId === RETAINED)!;
    expect(surviving).toMatchObject({ action: "delete", appliedValueId: expect.any(String), appliedHistoryEventId: expect.any(String), appliedSourcePinId: expect.any(String) });

    const readSurviving = async () => ({
      binding: (await db.query<Record<string, unknown>>("select * from parameter_catalog.project_parameter_bindings where id=$1", [surviving.bindingId])).rows,
      values: (await db.query<Record<string, unknown>>("select * from parameter_catalog.project_parameter_values where binding_id=$1 order by id", [surviving.bindingId])).rows,
      history: (await db.query<Record<string, unknown>>("select * from parameter_catalog.binding_history_events where binding_id=$1 order by id", [surviving.bindingId])).rows,
      pins: (await db.query<Record<string, unknown>>("select * from parameter_catalog.project_value_source_pins where binding_id=$1 order by id", [surviving.bindingId])).rows,
    });
    const before = await readSurviving();
    expect(before.pins.find(pin => pin.id === surviving.appliedSourcePinId)).toMatchObject({ value_state: "deleted", delete_request_id: request.id });
    const files = (await db.query<{ storage_key: string }>("select storage_key from project_parameter_file_versions where file_id=$1 order by id", [upload.file.id])).rows;
    const fileBytes = await Promise.all(files.map(file => storage.get(file.storage_key)));
    await db.transaction(async tx => {
      await tx.query("select parameter_catalog.lock_parameter_definition_purge($1)", [ERASED]);
      const plan = await prepareCatalogDefinitionErasure(tx, ERASED);
      await tx.query("select parameter_catalog.purge_parameter_definition($1,$2::jsonb,$3,$4)",
        [ERASED, JSON.stringify(plan), ADMIN, "audit-erasure-batch"]);
      await tx.query("set constraints all immediate");
    });
    const after = await readSurviving();
    expect(after.binding).toEqual(before.binding);
    expect(after.values).toEqual(before.values);
    expect.soft(after.history).toEqual(before.history.map(row => row.applied_request_id === request.id ? { ...row, applied_request_id: null } : row));
    expect.soft(after.pins).toEqual(before.pins.map(row => row.delete_request_id === request.id ? {
      ...row, delete_request_id: null, erased_request_audit_id: "audit-erasure-batch",
      delete_proof: { kind: "definition-erasure", auditEventId: "audit-erasure-batch" },
    } : row));
    expect(await Promise.all(files.map(file => storage.get(file.storage_key)))).toEqual(fileBytes);
    expect((await db.query("select id from public.project_parameter_value_change_requests where id=$1", [request.id])).rows).toEqual([]);
    expect((await db.query("select id from parameter_catalog.parameter_definitions where id=$1", [ERASED])).rows).toEqual([]);
  }, 120_000);
});
