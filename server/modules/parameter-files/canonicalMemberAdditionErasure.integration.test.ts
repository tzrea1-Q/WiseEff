import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createPostgresDatabase, getRootPostgresPool } from "../../shared/database/client";
import { createHttpServer } from "../../shared/http/server";
import { createRouter } from "../../shared/http/router";
import { requestJson } from "../../test/testClient";
import { makeTestAuthContext } from "../../testing/authContext";
import { createEphemeralTestDatabase } from "../../testing/testDatabase";
import { createTrustedRefusalAuditSink } from "../audit/trustedRefusalSink";
import { validCatalogReleaseBundle, refreshAuthoritativeSource } from "../catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import { compileCatalogRelease } from "../catalog-kernel/compiler";
import { jsonCatalogReleaseSource } from "../catalog-kernel/interface";
import { installPublishedRelease } from "../catalog-kernel/install/installer";
import { prepareCatalogDefinitionErasure } from "../catalog-publication/definitionErasure";
import { encodeBundleBytes, sha256Digest } from "../catalog-publication/builder/bundleCodec";
import { provisionPublicationRuntimeLogins, dropLabRuntimeLogins } from "../catalog-publication/runtime/provisionRuntimeLogins";
import { createLocalObjectStore } from "../logs/objectStore";
import { asValueClient, listCatalogBindingRowsForProject, loadPublishedCatalog, syncPublishedCatalogProjectValuesInTransaction } from "../parameter-bindings/catalogProjectValueSync";
import { loadOwnedProjectValueSourcePin } from "../parameter-bindings/values";
import { CatalogSubjectId } from "../parameter-catalog-contract";
import { executeRegistration } from "../parameter-governance/registration";
import { createParameterModule } from "../parameters/parameterModuleRepository";
import { createParameterModuleForAuth } from "../parameters/service";
import { ingestConfigRevision } from "../parameter-topology/ingestService";
import { addConfigSetFile, createConfigSet } from "./configSetService";
import { registerParameterFileRoutes } from "./routes";
import { uploadProjectParameterFile } from "./service";
import type { MemberAdditionPreview } from "./canonicalMemberAddition";
import type { SourceRevisionPreview } from "./sourceRevisionService";

const ORG = "org-add-erasure", PROJECT = "project-add-erasure", ADMIN = "admin-add-erasure";
const ERASED = "pdef_acme_power_iin_max", RETAINED = "pdef_acme_power_retained";
const auth = makeTestAuthContext({ organizationId: ORG, userId: ADMIN, roles: [{ roleId: "admin", projectId: null }] });
let lane: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
let db: ReturnType<typeof createPostgresDatabase>, api: ReturnType<typeof createPostgresDatabase>;
let storage: ReturnType<typeof createLocalObjectStore>, directory: string, configSetId: string;
const token = `add_erasure_${process.pid}`;
function server() {
  const router = createRouter(); registerParameterFileRoutes(router, { db: api, objectStore: storage,
    getCurrentAuthContext: () => auth, refusalAuditSink: createTrustedRefusalAuditSink(db) }); return createHttpServer(router);
}
const post = <T,>(path: string, body: unknown) => requestJson<T>(server(), path, { method: "POST", body: JSON.stringify(body) });

beforeAll(async () => {
  lane = await createEphemeralTestDatabase("add-erasure"); db = createPostgresDatabase(lane.url);
  directory = await mkdtemp(join(tmpdir(), "wiseeff-add-erasure-")); storage = createLocalObjectStore(directory);
  await db.query("insert into organizations(id,name) values ($1,'Addition erasure')", [ORG]);
  await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'Admin','Admin',true)", [ADMIN, ORG]);
  await db.query("insert into projects(id,organization_id,name,code,status) values ($1,$2,'Addition erasure','ADDERASE','initialized')", [PROJECT, ORG]);
  await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ('add-erasure-role',$1,$2,'admin')", [ADMIN, ORG]);
  const full = validCatalogReleaseBundle(), release = structuredClone(full.releases[0]!) as Parameters<typeof refreshAuthoritativeSource>[0];
  const definition = release.documents.find(document => document.kind === "definition");
  if (!definition || definition.kind !== "definition") throw new Error("Missing Definition fixture");
  const retained = structuredClone(definition); retained.content.id = RETAINED; retained.content.propertyKey = "retained";
  retained.content.revision.id = "drev_acme_power_retained_1"; retained.content.revision.matching.sourceProperty = "retained";
  release.documents.push(retained); refreshAuthoritativeSource(release);
  const bundle = { schemaVersion: full.schemaVersion, targetReleaseId: release.manifest.release.id, releases: [release] };
  const compiled = compileCatalogRelease(bundle); if (!compiled.ok) throw new Error(JSON.stringify(compiled.error));
  const installed = await installPublishedRelease(getRootPostgresPool(db)!, { mode: "bootstrap", source: jsonCatalogReleaseSource(bundle), expectedTargetDigest: compiled.value.aggregateDigest });
  if (!installed.ok) throw new Error(JSON.stringify(installed.error));
  const bytes = encodeBundleBytes(bundle);
  await db.query(`insert into catalog_publication.release_artifacts(id,artifact_digest,bytes_checksum,artifact_bytes,
    source_kind,target_release_id,target_release_digest,toolchain) values ('cart_add_erasure',$1,$2,$3,'repository-bundle',$4,$1,$5)`,
  [compiled.value.aggregateDigest, sha256Digest(bytes), Buffer.from(bytes), release.manifest.release.id, release.manifest.toolchain]);
  const business = await createParameterModuleForAuth(db, auth, { name: "Erasure", kind: "business" });
  const driver = await createParameterModule(db, { organizationId: ORG, name: "Erasure driver", kind: "driver-group", parentId: business.id, sourceKey: "compatible:acme,power" });
  const registration = await executeRegistration(getRootPostgresPool(db)!, { kind: "register", organizationId: ORG,
    subjectId: CatalogSubjectId("csub_acme_power"), subjectKind: "driver", expectedRelease: compiled.value.release,
    destinationModuleId: driver.id, placement: { mode: "use-default" }, method: "explicit", proof: { reason: "Addition erasure regression" },
    idempotencyKey: "add-erasure-register", context: { actorKind: "org-admin", principalId: ADMIN } });
  if (!registration.ok) throw new Error(JSON.stringify(registration.error));
  configSetId = (await createConfigSet(db, auth, { projectId: PROJECT, name: "Erasure" })).id;
  const source = '/dts-v1/; / { compatible = "test,board"; model = "Erasure"; charger: charger { compatible = "acme,power"; retained = <20>; }; };';
  const upload = await uploadProjectParameterFile(db, storage, auth, { projectId: PROJECT, fileName: "board.dts", bytes: Buffer.from(source) });
  await addConfigSetFile(db, auth, { configSetId, fileId: upload.file.id, role: "base", sortOrder: 0 });
  const revision = await ingestConfigRevision(db, { organizationId: ORG, projectId: PROJECT, configSetId, entryFile: "board.dts", includeSearchPaths: ["."], overlayOrder: [],
    members: [{ fileId: upload.file.id, fileVersionId: upload.version.id, fileName: "board.dts", sourceName: "board.dts", role: "base", sortOrder: 0, content: source }] }, auth);
  const snapshot = await loadPublishedCatalog(getRootPostgresPool(db)!); if (!snapshot) throw new Error("Missing Catalog");
  await db.transaction(tx => syncPublishedCatalogProjectValuesInTransaction(asValueClient(tx), snapshot, { organizationId: ORG, projectId: PROJECT, configSetId, configRevisionId: revision.id }));
  const logins = await provisionPublicationRuntimeLogins(lane.url, { mode: "lab", runToken: token }); api = createPostgresDatabase(logins.apiUrl);
}, 120_000);
afterAll(async () => { await api?.close(); if (lane) await dropLabRuntimeLogins(lane.url, token); await db?.close(); await lane?.drop(); if (directory) await rm(directory, { recursive: true, force: true }); });

it("erases one Definition from an addition proof while another transferred parameter remains readable, editable and exportable", async () => {
  const overlay = '/dts-v1/; /plugin/; &charger { iin_max = <30>; retained = <40>; }; / { extra { compatible = "acme,power"; iin_max = <50>; retained = <60>; }; };';
  const staged = await post<{ item: { id: string } }>(`/api/v1/projects/${PROJECT}/parameter-file-candidates`, { fileName: "limits.dts", contentBase64: Buffer.from(overlay).toString("base64") });
  expect(staged.status, staged.bodyText).toBe(201);
  const path = `/api/v1/projects/${PROJECT}/config-sets/${configSetId}/member-addition`;
  const body = { candidateId: staged.body.item.id, role: "overlay", sortOrder: 1 };
  const preview = await post<{ item: MemberAdditionPreview }>(`${path}/preview`, body); expect(preview.status, preview.bodyText).toBe(200);
  const applied = await post<{ item: { requestId: string; fileId: string; fileVersionId: string; configRevisionId: string } }>(`${path}/apply`, { ...body,
    proofToken: preview.body.item.proofToken, reason: "Add multi-parameter overlay", clientMutationId: "erasure-overlay-add" });
  expect(applied.status, applied.bodyText).toBe(200);
  const before = (await listCatalogBindingRowsForProject(api, auth, { projectId: PROJECT })).filter(row => row.definitionId === RETAINED);
  expect(before.map(row => row.rawValue).sort()).toEqual(["<40>", "<60>"]);
  const pins = await Promise.all(before.map(row => loadOwnedProjectValueSourcePin(api, { organizationId: ORG, projectId: PROJECT, bindingId: row.id, projectValueId: row.currentValueId })));
  await expect(db.query("update parameter_catalog.project_value_source_pins set erased_request_audit_id='forged-erasure' where id=$1", [pins[0]!.sourcePinId])).rejects.toMatchObject({ code: "55000" });
  const historicalIds = (await db.query<{ bindingId: string; projectValueId: string }>(`select binding_id as "bindingId",project_value_id as "projectValueId"
    from parameter_catalog.project_value_source_pins where definition_id=$1 order by id`, [RETAINED])).rows;
  const readHistorical = () => Promise.all(historicalIds.map(row => loadOwnedProjectValueSourcePin(api, { organizationId: ORG, projectId: PROJECT, ...row })));
  const historical = await readHistorical(); expect(historical.every(Boolean)).toBe(true);
  const originals = (await db.query<{ storage_key: string }>("select storage_key from project_parameter_file_versions order by id")).rows;
  const originalBytes = await Promise.all(originals.map(row => storage.get(row.storage_key)));
  await api.transaction(async tx => {
    await tx.query("select parameter_catalog.lock_parameter_definition_purge($1)", [ERASED]);
    const plan = await prepareCatalogDefinitionErasure(tx, ERASED);
    await tx.query("select parameter_catalog.purge_parameter_definition($1,$2::jsonb,$3,$4)", [ERASED, JSON.stringify(plan), ADMIN, "audit-addition-definition-erasure"]);
    await tx.query("set constraints all immediate");
  });
  expect(await listCatalogBindingRowsForProject(api, auth, { projectId: PROJECT })).toEqual(before);
  expect(await Promise.all(before.map(row => loadOwnedProjectValueSourcePin(api, { organizationId: ORG, projectId: PROJECT, bindingId: row.id, projectValueId: row.currentValueId })))).toEqual(pins);
  expect(await readHistorical()).toEqual(historical);
  expect((await db.query("select id from project_parameter_value_change_requests where id=$1", [applied.body.item.requestId])).rows).toEqual([]);
  expect((await db.query("select id from parameter_catalog.parameter_definitions where id=$1", [ERASED])).rows).toEqual([]);
  const residue = await db.query<{ retained: boolean }>(`select exists(select 1 from project_parameter_value_change_requests
    where source_revision_context::text like '%'||$1||'%' or member_frozen_proof::text like '%'||$1||'%') retained`, [ERASED]);
  expect(residue.rows[0]?.retained).toBe(false);
  expect(await Promise.all(originals.map(row => storage.get(row.storage_key)))).toEqual(originalBytes);
  const edited = await post<{ item: { id: string } }>(`/api/v1/projects/${PROJECT}/parameter-file-candidates`, { fileId: applied.body.item.fileId, fileName: "limits.dts", intent: "source_revision",
    expectedCurrentVersionId: applied.body.item.fileVersionId, expectedConfigRevisionId: applied.body.item.configRevisionId, clientMutationId: "erasure-follow-on-edit",
    contentBase64: Buffer.from(overlay.replace("retained = <40>", "retained = <41>")).toString("base64") });
  expect(edited.status, edited.bodyText).toBe(201);
  const next = await requestJson<{ item: SourceRevisionPreview }>(server(), `/api/v1/projects/${PROJECT}/parameter-file-candidates/${edited.body.item.id}/source-preview`);
  expect(next.status, next.bodyText).toBe(200);
  const committed = await post(`/api/v1/projects/${PROJECT}/parameter-file-candidates/${edited.body.item.id}/source-apply`, { expectedCurrentVersionId: next.body.item.baseVersionId,
    expectedProofToken: next.body.item.proofToken, reason: "Edit surviving transferred parameter", clientMutationId: "erasure-follow-on-apply" });
  expect(committed.status, committed.bodyText).toBe(200);
  expect((await listCatalogBindingRowsForProject(api, auth, { projectId: PROJECT })).map(row => row.rawValue).sort()).toEqual(["<41>", "<60>"]);
  const exported = await requestJson(server(), `/api/v1/projects/${PROJECT}/config-sets/${configSetId}/export`); expect(exported.status, exported.bodyText).toBe(200);
}, 120_000);
